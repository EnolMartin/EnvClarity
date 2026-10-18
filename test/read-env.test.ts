import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { inspect } from "node:util";
import type { AuditFailureCode } from "../src/core/types.ts";
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

function safeFailure(code: AuditFailureCode, canaries: readonly string[]) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof ScanError);
    assert.equal(error.code, code);
    assert.equal(error.cause, undefined);
    const diagnostics = [String(error), error.message, error.stack, JSON.stringify(error),
      inspect(error, { showHidden: true }), JSON.stringify(Object.getOwnPropertyDescriptors(error))].join("\n");
    for (const canary of canaries) assert.ok(!diagnostics.includes(canary));
    assert.deepEqual(Object.keys(error).sort(), ["code", "name"]);
    return true;
  };
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
      'D="\\n"', "E='\\n'", 'F="\\t"', "G=synthetic", "# ignored continuation",
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
  const names = ["1NAME", "WITH-DASH", "WITH.DOT", "WITH SPACE", "WITH:COLON", "ñ"];
  const result = await read(t, names.map(name => `${name}=synthetic`).join("\n"));
  assert.deepEqual(result.documentedNames, names.sort());
  assert.ok(result.environment.every(({ state }) => state === "present"));
});

test("accepts quoted tails containing only whitespace or comments and closes at the first matching quote", async (t) => {
  assert.deepEqual((await read(t, 'A="" \t # synthetic\nB=\'\'\t\nC=``# synthetic')).environment, [
    { name: "A", state: "empty" }, { name: "B", state: "empty" }, { name: "C", state: "empty" },
  ]);
  // A later matching quote closes a multiline value, even across apparent declarations.
  assert.deepEqual((await read(t, 'A="multiline\nB=synthetic\nC=" # synthetic')).environment, [
    { name: "A", state: "present" },
  ]);
  // Backslashes are literal, including directly before the closing quote.
  assert.deepEqual((await read(t, 'A="synthetic\\" # comment\nB=unquoted"quote')).environment, [
    { name: "A", state: "present" }, { name: "B", state: "present" },
  ]);
});

const formatCanary = "synthetic-format-value-canary";
for (const [label, invalid] of [
  ["bare lines", formatCanary],
  ["colon-only assignments", `A: ${formatCanary}`],
  ["empty names", ` =${formatCanary}`],
  ["empty exported names", `export \t =${formatCanary}`],
  ["hashes inside names", `A#B=${formatCanary}`],
  ["unclosed single quotes", `A='${formatCanary}`],
  ["unclosed double quotes", `A="${formatCanary}`],
  ["unclosed backticks", `A=\`${formatCanary}`],
  ["text after single quotes", `A='' ${formatCanary}`],
  ["text after double quotes", `A=""${formatCanary}`],
  ["text after backticks", `A=\`\` ${formatCanary}`],
  ["NUL in content", `A=${formatCanary}\0`],
  ["NUL in quotes", `A='${formatCanary}\0'`],
  ["NUL in comments", `# ${formatCanary}\0`],
] as const) {
  test(`rejects ${label} safely in either file and persistently fails the session`, async (t) => {
    for (const path of [".env.example", "selected.env"]) {
      for (const newline of ["\n", "\r\n"]) {
        const root = await project(t, "VALID=synthetic-example", "VALID=synthetic-selected");
        await writeFile(join(root, path), `VALID=synthetic-prefix${newline}${invalid}${newline}AFTER=synthetic-tail`);
        await writeFile(join(root, "source.ts"), "// Synthetic source");
        const files = await ProjectFiles.open(root);
        let failure: unknown;
        let result: unknown;
        await assert.rejects(async () => { result = await readEnv(files, "selected.env"); }, (error: unknown) => {
          failure = error;
          return safeFailure("FORMAT_ERROR", [formatCanary, invalid, "synthetic-prefix", "synthetic-tail"])(error);
        });
        assert.equal(result, undefined);
        // Repairing the file must not revive an analysis that has already failed.
        await writeFile(join(root, path), "VALID=");
        for (const operation of [
          () => readEnv(files, "selected.env"), () => files.discover(),
          () => files.readSource("source.ts"), () => files.readEnvironment(path),
        ]) {
          await assert.rejects(operation, (error: unknown) => error === failure);
        }
      }
    }
  });
}

test("stops before the selected file when the example format fails", async (t) => {
  const root = await project(t, `BROKEN='${formatCanary}`, "A=synthetic-selected");
  const files = await ProjectFiles.open(root);
  const reader = t.mock.method(files, "readEnvironment");
  await assert.rejects(readEnv(files, "selected.env"), safeFailure("FORMAT_ERROR", [formatCanary]));
  assert.equal(reader.mock.callCount(), 1);
  assert.equal(reader.mock.calls[0]!.arguments[0], ".env.example");
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
    await assert.rejects(readEnv(files, selected, example), safeFailure(code, [
      "synthetic-canary", "missing-synthetic-canary.env", "ENOENT", root,
    ]));
    await assert.rejects(files.discover(), { code });
  }
});

test("normalizes unreadable example and selected files without returning partial results", async (t) => {
  if (process.getuid?.() === 0) {
    t.skip("Root can bypass filesystem read permissions; native read failures are also tested deterministically.");
    return;
  }
  for (const selected of [".env.example", "selected.env"]) {
    const root = await project(t, "A=synthetic-unreadable-canary", "A=synthetic-unreadable-canary");
    const path = join(root, selected);
    const files = await ProjectFiles.open(root);
    await chmod(path, 0);
    try {
      await assert.rejects(readEnv(files, "selected.env"), safeFailure("READ_ERROR", [
        "synthetic-unreadable-canary", root, "EACCES", "permission denied",
      ]));
    } finally {
      await chmod(path, 0o600);
    }
    await assert.rejects(readEnv(files, "selected.env"), { code: "READ_ERROR" });
    await assert.rejects(files.discover(), { code: "READ_ERROR" });
  }
});

test("sanitizes native read errors in either file, closes handles and keeps failure identity", async (t) => {
  const root = await project(t, "A=synthetic-read-canary", "A=synthetic-read-canary");
  const probe = await open(join(root, ".env.example"));
  const prototype = Object.getPrototypeOf(probe);
  const originalRead: FileHandle["read"] = probe.read;
  await probe.close();
  for (const failedRead of [1, 3]) {
    // Each small file needs a content read and an EOF read: call 3 is the selected file.
    let calls = 0;
    let failedHandle: FileHandle | undefined;
    const mocked = t.mock.method(prototype, "read", async function (
      this: FileHandle, ...args: Parameters<FileHandle["read"]>
    ) {
      if (++calls === failedRead) {
        failedHandle = this;
        throw Object.assign(new Error("synthetic-native-message-canary"), {
          code: "EACCES", path: root, content: "synthetic-read-canary",
        });
      }
      return Reflect.apply(originalRead, this, args);
    });
    try {
      const files = await ProjectFiles.open(root);
      let failure: unknown;
      await assert.rejects(readEnv(files, "selected.env"), (error: unknown) => {
        failure = error;
        return safeFailure("READ_ERROR", [
          "synthetic-read-canary", "synthetic-native-message-canary", "EACCES", root,
        ])(error);
      });
      assert.ok(failedHandle);
      await assert.rejects(failedHandle.stat(), { code: "EBADF" });
      await assert.rejects(files.discover(), (error: unknown) => error === failure);
    } finally {
      mocked.mock.restore();
    }
  }
});

test("failure diagnostics stay safe in stdout, stderr and JSON without executing file content", async (t) => {
  const canary = "synthetic-diagnostic-value-canary";
  const root = await project(t, "A=synthetic-example", `A=\`$(touch marker) ${canary}`);
  const moduleUrl = new URL("../dist/io/read-env.js", import.meta.url).href;
  const filesUrl = new URL("../dist/io/discover.js", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    import { inspect } from 'node:util';
    import { readEnv } from ${JSON.stringify(moduleUrl)};
    import { ProjectFiles } from ${JSON.stringify(filesUrl)};
    for (const [selected, code] of [['selected.env', 'FORMAT_ERROR'], ['missing.env', 'READ_ERROR']]) {
      const files = await ProjectFiles.open(process.argv[1]);
      let failure;
      await assert.rejects(readEnv(files, selected), error => {
        assert.equal(error.code, code);
        failure = error;
        return true;
      });
      process.stdout.write(JSON.stringify(failure) + '\\n');
      process.stderr.write(String(failure) + '\\n' + inspect(failure, { showHidden: true }) + '\\n');
    }
  `, root], { cwd: root, encoding: "utf8" });
  assert.equal(child.status, 0);
  assert.equal(child.error, undefined);
  assert.ok(!child.stdout.includes(root));
  assert.deepEqual(child.stdout.trim().split("\n").map(line => JSON.parse(line).code), ["FORMAT_ERROR", "READ_ERROR"]);
  for (const output of [child.stdout, child.stderr]) {
    assert.ok(output.includes("FORMAT_ERROR"));
    assert.ok(output.includes("READ_ERROR"));
    // Native stacks may include the caller's cwd through the eval module URL.
    for (const forbidden of [canary, "$(touch marker)", "ENOENT"]) {
      assert.ok(!output.includes(forbidden));
    }
  }
  await assert.rejects(access(join(root, "marker")), { code: "ENOENT" });
});
