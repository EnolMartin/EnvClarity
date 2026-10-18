import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { ProjectFiles, SCAN_LIMITS, ScanError } from "../src/io/discover.ts";
import { readEnv } from "../src/io/read-env.ts";

async function project(t: TestContext, example = "", environment = ""): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "envclarity-read-env-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, ".env.example"), example);
  await writeFile(join(root, "selected.env"), environment);
  return root;
}

async function read(t: TestContext, content: string) {
  const root = await project(t, content, content);
  return readEnv(await ProjectFiles.open(root), "selected.env");
}

test("returns only documented names and selected states, without manufacturing absent entries", async (t) => {
  const root = await project(t, "DOCUMENTED=synthetic-example\nMISSING=\n", "EXTRA=synthetic-selected\nDOCUMENTED=\n");
  const result = await readEnv(await ProjectFiles.open(root), "selected.env");
  assert.deepEqual(result, {
    documentedNames: ["DOCUMENTED", "MISSING"],
    environment: [{ name: "DOCUMENTED", state: "empty" }, { name: "EXTRA", state: "present" }],
  });
  assert.ok(!JSON.stringify(result).includes("synthetic-"));
});

test("handles blank files and comment-only files", async (t) => {
  const root = await project(t, "", "# Synthetic comment\n\n  # Another comment\n");
  assert.deepEqual(await readEnv(await ProjectFiles.open(root), "selected.env"), {
    documentedNames: [], environment: [],
  });
});

test("handles comments and preserves hashes inside single, double and backtick quotes", async (t) => {
  const result = await read(t, [
    "# IGNORED=synthetic", "BARE=synthetic# comment", "EMPTY= # comment",
    "SINGLE='#'", 'DOUBLE="#"', "BACKTICK=`#`", "INLINE=synthetic # OTHER=synthetic",
  ].join("\n"));
  assert.deepEqual(result.environment, [
    { name: "BACKTICK", state: "present" }, { name: "BARE", state: "present" },
    { name: "DOUBLE", state: "present" }, { name: "EMPTY", state: "empty" },
    { name: "INLINE", state: "present" }, { name: "SINGLE", state: "present" },
  ]);
  assert.deepEqual(result.documentedNames, result.environment.map(({ name }) => name));
});

test("distinguishes empty values from quoted whitespace and trims surrounding spaces", async (t) => {
  const result = await read(t, [
    "  A \t= \t synthetic \t", 'B=""', "C=''", "D=``", 'E=" "', "F='\t'", "G=", "H=  ",
  ].join("\n"));
  assert.deepEqual(result.environment, [
    { name: "A", state: "present" }, { name: "B", state: "empty" },
    { name: "C", state: "empty" }, { name: "D", state: "empty" },
    { name: "E", state: "present" }, { name: "F", state: "present" },
    { name: "G", state: "empty" }, { name: "H", state: "empty" },
  ]);
});

test("supports LF and CRLF, quoted multiline content and literal escape sequences", async (t) => {
  for (const newline of ["\n", "\r\n"]) {
    const content = [
      'A="', "INNER=synthetic", '"', "B='", "'", "C=`", "`",
      'D="\\n"', "E='\\n'", 'F="\\t"', "G=synthetic", "bare continuation",
    ].join(newline);
    const result = await read(t, content);
    assert.deepEqual(result.documentedNames, ["A", "B", "C", "D", "E", "F", "G"]);
    assert.ok(result.environment.every(({ state }) => state === "present"));
  }
});

test("uses the last duplicate, including replacement with or from an empty value", async (t) => {
  const result = await read(t, "B=\nA=synthetic-first\nB=synthetic-last\nA=\nB=synthetic-final");
  assert.deepEqual(result, {
    documentedNames: ["A", "B"],
    environment: [{ name: "A", state: "empty" }, { name: "B", state: "present" }],
  });
});

test("preserves special names including __proto__ without modifying prototypes", async (t) => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const names = ["__proto__", "constructor", "toString", "hasOwnProperty", "_", "lower_1"];
  const result = await read(t, names.map(name => `${name}=synthetic`).join("\n"));
  const expected = names.sort();
  assert.deepEqual(result.documentedNames, expected);
  assert.deepEqual(result.environment, expected.map(name => ({ name, state: "present" })));
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(Object.getPrototypeOf(result.environment[0]), Object.prototype);
  assert.deepEqual((await read(t, "__proto__=synthetic\nexport __proto__=  \nB=synthetic")).environment, [
    { name: "B", state: "present" }, { name: "__proto__", state: "empty" },
  ]);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});

test("preserves permissive names without claiming identifier validation", async (t) => {
  const names = ["1NAME", "WITH-DASH", "WITH.DOT", "WITH SPACE", "ñ"];
  const result = await read(t, names.map(name => `${name}=synthetic`).join("\n"));
  assert.deepEqual(result.documentedNames, names.sort());
  assert.ok(result.environment.every(({ state }) => state === "present"));
});

test("records permissive handling of bare lines, colon assignments and unclosed quotes", async (t) => {
  const result = await read(t, 'BARE\nCOLON: synthetic\n=synthetic\nA="unterminated\nB=synthetic');
  assert.deepEqual(result.environment, [
    { name: "A", state: "present" }, { name: "B", state: "present" },
  ]);
  assert.deepEqual(result.documentedNames, ["A", "B"]);
  assert.deepEqual((await read(t, 'C="" trailing\nD=synthetic')).environment, [
    { name: "C", state: "empty" }, { name: "D", state: "present" },
  ]);
  // A later quote can instead close the multiline value and swallow intervening declarations.
  assert.deepEqual((await read(t, 'A="unterminated\nB=synthetic\nC="" trailing')).environment, [
    { name: "A", state: "present" },
  ]);
});

test("removes export before nonempty, empty and tab-separated declarations", async (t) => {
  const result = await read(t, "export A=\nexport B=synthetic\nexport\tC=\nexport \tD=  \nexport E=''\nexport F=\"\"\nexport G=``");
  assert.deepEqual(result.environment, [
    { name: "A", state: "empty" }, { name: "B", state: "present" },
    { name: "C", state: "empty" }, { name: "D", state: "empty" },
    { name: "E", state: "empty" }, { name: "F", state: "empty" }, { name: "G", state: "empty" },
  ]);
  assert.deepEqual(result.documentedNames, ["A", "B", "C", "D", "E", "F", "G"]);
  assert.deepEqual((await read(t, "export A=")).environment, [{ name: "A", state: "empty" }]);
});

test("keeps whitespace-only values empty without consuming the next declaration", async (t) => {
  for (const newline of ["\n", "\r\n"]) {
    for (const space of [" ", "\t", " \t "]) {
      const result = await read(t, `A=${space}${newline}B=synthetic${newline}C=${newline}`);
      assert.deepEqual(result, {
        documentedNames: ["A", "B", "C"],
        environment: [
          { name: "A", state: "empty" }, { name: "B", state: "present" }, { name: "C", state: "empty" },
        ],
      });
    }
  }
});

test("applies all three regressions in both files with comments, multiline content and duplicates", async (t) => {
  const result = await read(t, [
    "__proto__=synthetic-first", "A= \t ", "B=synthetic", "export __proto__=",
    'MULTILINE="', "export A=synthetic-not-a-declaration", "__proto__=synthetic-not-a-declaration", '"',
    "export A=  # synthetic comment", "export B=synthetic-last",
  ].join("\n"));
  assert.deepEqual(result, {
    documentedNames: ["A", "B", "MULTILINE", "__proto__"],
    environment: [
      { name: "A", state: "empty" }, { name: "B", state: "present" },
      { name: "MULTILINE", state: "present" }, { name: "__proto__", state: "empty" },
    ],
  });
  assert.ok(!JSON.stringify(result).includes("synthetic"));
});

test("reads only explicit paths, keeps values out of JSON and emits nothing", async (t) => {
  const root = await project(t, "DOCUMENTED=synthetic-example-canary", [
    "EMPTY=", "EXPANSION=${ENVCLARITY_SYNTHETIC_PROCESS_ONLY}", "COMMAND=$(touch marker)",
    "LITERAL=synthetic-selected-canary", "CODE=throw new Error('synthetic-code-canary')",
  ].join("\n"));
  await writeFile(join(root, ".env"), "OTHER=synthetic-other-canary");
  await writeFile(join(root, ".env.local"), "LOCAL=synthetic-local-canary");
  const moduleUrl = new URL("../src/io/read-env.ts", import.meta.url).href;
  const filesUrl = new URL("../src/io/discover.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { readEnv } from ${JSON.stringify(moduleUrl)};
    import { ProjectFiles } from ${JSON.stringify(filesUrl)};
    const before = { ...process.env };
    const result = await readEnv(await ProjectFiles.open(process.argv[1]), 'selected.env');
    assert.deepEqual(result.environment, [
      { name: 'CODE', state: 'present' }, { name: 'COMMAND', state: 'present' },
      { name: 'EMPTY', state: 'empty' }, { name: 'EXPANSION', state: 'present' },
      { name: 'LITERAL', state: 'present' },
    ]);
    assert.deepEqual(result.documentedNames, ['DOCUMENTED']);
    assert.ok(!JSON.stringify(result).includes('canary'));
    assert.deepEqual({ ...process.env }, before);
  `, root], {
    cwd: root, encoding: "utf8",
    env: { ENVCLARITY_SYNTHETIC_PROCESS_ONLY: "", EMPTY: "synthetic-process-canary" },
  });
  assert.equal(child.status, 0);
  assert.equal(child.error, undefined);
  assert.equal(child.stdout, "");
  assert.equal(child.stderr, "");
  await assert.rejects(access(join(root, "marker")), { code: "ENOENT" });
});

test("honors custom example and selected paths without modifying either file", async (t) => {
  const root = await project(t, "IGNORED=synthetic", "IGNORED=synthetic");
  const paths = [join(root, "custom.example"), join(root, "custom.env")];
  await writeFile(paths[0]!, "CUSTOM=synthetic-example");
  await writeFile(paths[1]!, "CUSTOM=");
  const before = await Promise.all(paths.map(async path => ({ content: await readFile(path), stat: await stat(path) })));
  assert.deepEqual(await readEnv(await ProjectFiles.open(root), "custom.env", "custom.example"), {
    documentedNames: ["CUSTOM"], environment: [{ name: "CUSTOM", state: "empty" }],
  });
  const after = await Promise.all(paths.map(async path => ({ content: await readFile(path), stat: await stat(path) })));
  for (const [index, previous] of before.entries()) {
    const current = after[index]!;
    assert.deepEqual(current.content, previous.content);
    for (const key of ["size", "mode", "mtimeMs", "ctimeMs"] as const) {
      assert.equal(current.stat[key], previous.stat[key]);
    }
  }
});

test("uses bounded reads for both files and preserves a failed caller session", async (t) => {
  const atLimit = "#".repeat(SCAN_LIMITS.environmentBytes);
  const boundary = await project(t, atLimit, atLimit);
  assert.deepEqual(await readEnv(await ProjectFiles.open(boundary), "selected.env"), {
    documentedNames: [], environment: [],
  });
  for (const oversized of [".env.example", "selected.env"]) {
    const root = await project(t, "A=synthetic", "A=synthetic");
    await writeFile(join(root, oversized), "x".repeat(SCAN_LIMITS.environmentBytes + 1));
    const files = await ProjectFiles.open(root);
    await assert.rejects(readEnv(files, "selected.env"), { code: "LIMIT_EXCEEDED" });
    await assert.rejects(files.discover(), { code: "LIMIT_EXCEEDED" });
  }
  const root = await project(t, "A=synthetic", "A=synthetic");
  const files = await ProjectFiles.open(root);
  await assert.rejects(files.readSource("missing.ts"), { code: "READ_ERROR" });
  await assert.rejects(readEnv(files, "selected.env"), { code: "READ_ERROR" });
});

test("preserves the caller's accumulated source budget across environment reading", async (t) => {
  const root = await project(t, "A=synthetic", "A=");
  await writeFile(join(root, "source.ts"), " ".repeat(SCAN_LIMITS.sourceBytes));
  const files = await ProjectFiles.open(root);
  for (let index = 0; index < SCAN_LIMITS.totalSourceBytes / SCAN_LIMITS.sourceBytes; index++) {
    await files.readSource("source.ts");
  }
  await readEnv(files, "selected.env");
  await assert.rejects(files.readSource("source.ts"), { code: "LIMIT_EXCEEDED" });
  await assert.rejects(readEnv(files, "selected.env"), { code: "LIMIT_EXCEEDED" });
});

test("inherits path and symlink protection and safe access failures without returning partial data", async (t) => {
  const root = await project(t, "A=synthetic-canary", "A=synthetic-canary");
  await symlink(join(root, "selected.env"), join(root, "link.env"));
  for (const [selected, example, code] of [
    ["../synthetic-canary.env", ".env.example", "INVALID_INPUT"],
    ["link.env", ".env.example", "INVALID_INPUT"],
    ["selected.env", "link.env", "INVALID_INPUT"],
    ["missing-synthetic-canary.env", ".env.example", "READ_ERROR"],
    ["selected.env", "missing-synthetic-canary.env", "READ_ERROR"],
  ] as const) {
    const files = await ProjectFiles.open(root);
    await assert.rejects(readEnv(files, selected, example), (error: unknown) => {
      assert.ok(error instanceof ScanError);
      assert.equal(error.code, code);
      assert.ok(!JSON.stringify(error).includes("canary"));
      assert.ok(!String(error).includes("canary"));
      assert.equal(error.cause, undefined);
      return true;
    });
    await assert.rejects(files.discover(), { code });
  }
});
