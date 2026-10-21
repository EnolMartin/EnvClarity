import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { audit } from "../src/audit.ts";
import { SCAN_LIMITS } from "../src/io/discover.ts";
import { formatJson } from "../src/reporters/json.ts";
import { formatText } from "../src/reporters/text.ts";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const canary = "ENVCLARITY_SYNTHETIC_SECRET";
const argumentError = "Invalid arguments. Use --help for usage.\n";

function runCli(args: string[], root?: string) {
  // Read-only permissions also prevent writes, subprocesses and worker execution.
  const result = spawnSync(process.execPath, [
    "--permission", `--allow-fs-read=${packageRoot}`,
    ...(root ? [`--allow-fs-read=${root}`, `--allow-fs-read=${realpathSync(root)}`] : []), cliPath, ...args,
  ], { cwd: root ?? packageRoot, encoding: "utf8", timeout: 10_000 });

  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.ok(!result.stdout.includes(canary));
  assert.ok(!result.stderr.includes(canary));
  return result;
}

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function project(t: TestContext, entries: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "envclarity cli with spaces "));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries({
    ".env.example": "CONFIGURED=\nMISSING=\nEMPTY=",
    "chosen env": `CONFIGURED=${canary}\nEMPTY=`,
    "src/app with spaces.ts": "process.env.CONFIGURED; process.env.MISSING; process.env.EMPTY;",
    ...entries,
  })) await put(root, path, content);
  return root;
}

for (const args of [[], ["--help"], ["-h"]]) {
  test(`displays implemented help for ${JSON.stringify(args)}`, () => {
    const result = runCli(args);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /check <root> --env <file>/);
    assert.match(result.stdout, /--example <file>/);
    assert.match(result.stdout, /--format text\|json/);
    assert.match(result.stdout, /default: \.env\.example/);
    assert.match(result.stdout, /default: text/);
    assert.match(result.stdout, /0  Audit completed without error-severity issues/);
    assert.match(result.stdout, /1  Audit completed with at least one error-severity issue/);
    assert.match(result.stdout, /2  Invalid arguments or an operational failure/);
    assert.match(result.stdout, /Help: stdout; stderr is empty/);
    assert.match(result.stdout, /Invalid syntax: stdout is empty; stderr contains a fixed usage diagnostic/);
    assert.match(result.stdout, /Audits in text or JSON: stdout contains the result; stderr is empty/);
    assert.doesNotMatch(result.stdout, /not implemented/);
  });
}

const invalidArgs = [
  ["unknown", canary], ["--unknown"], ["check"], ["check", "root"],
  ["check", "--env", "file"], ["check", "", "--env", "file"],
  ["check", "root", "extra", "--env", "file"],
  ["check", "root", "--env", "file", "check"],
  ["--help", canary], ["-h", "extra"], ["--help", "-h"],
  ["check", "root", "--help"],
  ["check", "root", "--env", "file", `--unknown=${canary}`],
  ["check", "root", "--env", "file", "-f", "json"],
  ["check", "root", "--env"], ["check", "root", "--env="],
  ["check", "root", "--env", ""],
  ["check", "root", "--env", "--format", "json"],
  ["check", "root", "--env", "file", "--example"],
  ["check", "root", "--env", "file", "--example="],
  ["check", "root", "--env", "file", "--format"],
  ["check", "root", "--env", "file", "--format="],
  ["check", "root", "--env", "file", "--format", canary],
  ["check", "root", "--env", "file", "--format", "JSON"],
  ["check", "root", "--env", "file", "--env", canary],
  ["check", "root", "--env=file", `--env=${canary}`],
  ["check", "root", "--env", "file", "--example", "one", "--example=two"],
  ["check", "root", "--env", "file", "--format=json", "--format=json"],
  ["check", "root", "--env", "file", "--format=json", "--format=text"],
  ["check", "root", "--env", "file", "--format=json", `--unknown=${canary}`],
  ["check", "root", "--env", "file", "--", `--format=${canary}`],
];

for (const [index, args] of invalidArgs.entries()) {
  test(`rejects invalid command syntax safely (${index + 1})`, () => {
    const result = runCli(args);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, argumentError);
  });
}

for (const format of ["text", "json"]) {
  test(`invalid syntax keeps stdout empty even with --format=${format}`, () => {
    const result = runCli(["check", canary, "--env", canary, `--format=${format}`, `--unknown=${canary}`]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, argumentError);
  });
}

const completedCases = [
  {
    name: "clean report", example: "CONFIGURED=", environment: `CONFIGURED=${canary}`,
    source: "process.env.CONFIGURED;", errors: 0, warnings: 0, exitCode: 0, codes: [],
  },
  {
    name: "warnings only", example: "EMPTY=\nUNUSED=", environment: `EMPTY=\nUNUSED=${canary}`,
    source: "process.env.EMPTY; process.env.UNDOCUMENTED; process.env[key];",
    errors: 0, warnings: 4, exitCode: 0,
    codes: ["DYNAMIC_REFERENCE", "EMPTY_VARIABLE", "POSSIBLY_UNUSED_VARIABLE", "UNDOCUMENTED_VARIABLE"],
  },
  {
    name: "errors only", example: "MISSING=", environment: "",
    source: "process.env.MISSING;", errors: 1, warnings: 0, exitCode: 1, codes: ["MISSING_VARIABLE"],
  },
  {
    name: "errors and warnings", example: "MISSING=\nEMPTY=\nUNUSED=",
    environment: `EMPTY=\nUNUSED=${canary}`,
    source: "process.env.MISSING; process.env.EMPTY; process.env.UNDOCUMENTED; process.env[key];",
    errors: 1, warnings: 4, exitCode: 1,
    codes: ["DYNAMIC_REFERENCE", "EMPTY_VARIABLE", "MISSING_VARIABLE", "POSSIBLY_UNUSED_VARIABLE", "UNDOCUMENTED_VARIABLE"],
  },
];

for (const selected of completedCases) {
  for (const format of ["text", "json"]) {
    test(`returns ${selected.exitCode} with the full ${format} result for ${selected.name}`, async (t) => {
      const root = await project(t, {
        ".env.example": selected.example, "chosen env": selected.environment,
        "src/app with spaces.ts": selected.source,
      });
      const expected = await audit(root, "chosen env");
      assert.equal(expected.status, "completed");
      if (expected.status !== "completed") assert.fail("Expected a completed audit");
      assert.deepEqual(expected.report.summary, { errorCount: selected.errors, warningCount: selected.warnings });
      assert.deepEqual(expected.report.issues.map(issue => issue.code).sort(), selected.codes);

      const result = runCli(["check", root, "--env", "chosen env", "--format", format], root);
      assert.equal(result.status, selected.exitCode);
      assert.equal(result.stderr, "");
      assert.equal(result.stdout, format === "json" ? `${formatJson(expected)}\n` : formatText(expected));
      if (format === "json") assert.deepEqual(JSON.parse(result.stdout), expected);
    });
  }
}

test("uses default example and text, or explicit text/JSON, with spaced paths", async (t) => {
  const root = await project(t);
  const expected = await audit(root, "chosen env");
  assert.equal(expected.status, "completed");
  for (const format of [undefined, "text", "json"]) {
    const result = runCli(["check", root, "--env", "chosen env",
      ...(format ? ["--format", format] : [])], root);
    assert.equal(result.status, 1);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, format === "json" ? `${formatJson(expected)}\n` : formatText(expected));
    if (format === "json") assert.deepEqual(JSON.parse(result.stdout), expected);
  }
});

test("accepts equals options, reordered options and an alternative example relative to root", async (t) => {
  const root = await project(t, {
    ".env.example": `invalid ${canary}`,
    "config/other example": `CONFIGURED=${canary}`,
  });
  const expected = await audit(root, "chosen env", "config/other example");
  assert.equal(expected.status, "completed");
  for (const format of ["text", "json"]) {
    const result = runCli(["check", `--format=${format}`, "--example=config/other example",
      root, "--env=chosen env"], root);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(result.stdout, format === "json" ? `${formatJson(expected)}\n` : formatText(expected));
  }
});

test("accepts a relative root and a dash-prefixed root after the option terminator", async (t) => {
  const root = await project(t);
  for (const selected of [".", "-project"]) {
    if (selected !== ".") {
      await put(root, "-project/.env.example", "");
      await put(root, "-project/chosen env", "");
    }
    const result = runCli(["check", "--env", "chosen env", "--format=json", "--", selected], root);
    assert.equal(result.status, selected === "." ? 1 : 0);
    assert.equal(result.stderr, "");
    assert.equal(JSON.parse(result.stdout).status, "completed");
  }
});

test("requires --env even when an implicit environment exists", async (t) => {
  const root = await project(t, { ".env": `CONFIGURED=${canary}` });
  const result = runCli(["check", root, "--format=json"], root);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, argumentError);
});

test("preserves safe operational failures and existing path and size validation", async (t) => {
  const root = await project(t, {
    "invalid env": `BAD="${canary}`,
    "large env": `VALUE=${canary}`.padEnd(SCAN_LIMITS.environmentBytes + 1, "x"),
  });
  await symlink("chosen env", join(root, "linked env"));
  const cases = [
    { root: join(root, canary), env: "chosen env", code: "READ_ERROR" },
    { root, env: canary, code: "READ_ERROR" },
    { root, env: `../${canary}`, code: "INVALID_INPUT" },
    { root, env: "linked env", code: "INVALID_INPUT" },
    { root, env: "invalid env", code: "FORMAT_ERROR" },
    { root, env: "large env", code: "LIMIT_EXCEEDED" },
  ] as const;
  for (const [index, selected] of cases.entries()) {
    const expected = { status: "failed", code: selected.code } as const;
    for (const format of ["text", "json"]) {
      await t.test(`${selected.code} in ${format} (case ${index + 1})`, () => {
        const result = runCli(["check", selected.root, "--env", selected.env, "--format", format], root);
        assert.equal(result.status, 2);
        assert.equal(result.stderr, "");
        assert.equal(result.stdout, format === "json" ? `${formatJson(expected)}\n` : formatText(expected));
        if (format === "json") assert.deepEqual(JSON.parse(result.stdout), expected);
        assert.doesNotMatch(result.stdout, /Audit completed|No issues detected|"report"|"summary"/);
      });
    }
  }
});

async function snapshot(root: string): Promise<unknown[]> {
  const entries: unknown[] = [];
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name);
    const stat = await lstat(path);
    entries.push({ name, mode: stat.mode, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs,
      content: stat.isDirectory() ? await snapshot(path) : await readFile(path, "utf8") });
  }
  return entries;
}

test("neither executes nor modifies the audited project and never outputs canary values", async (t) => {
  const root = await project(t, {
    "package.json": JSON.stringify({ type: "module", scripts: {
      preinstall: "touch script-marker", build: "touch script-marker",
    } }),
    "vite.config.ts": `throw new Error('${canary}');`,
    "execute.js": 'import { writeFileSync } from "node:fs"; writeFileSync(new URL("executed-marker", import.meta.url), "executed");',
    "chosen env": `CONFIGURED=${canary}\nEMPTY=\nCOMMAND=$(touch command-marker)`,
  });
  const before = await snapshot(root);
  for (const format of ["text", "json"]) {
    const args = ["check", root, "--env", "chosen env", "--format", format];
    const guarded = runCli(args, root);
    assert.equal(guarded.status, 1);
    assert.equal(guarded.stderr, "");
    // Also observe the real executable without the permission guard masking a write attempt.
    const plain = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: root, encoding: "utf8", timeout: 10_000,
    });
    assert.ifError(plain.error);
    assert.equal(plain.signal, null);
    assert.equal(plain.status, 1);
    assert.equal(plain.stderr, "");
    assert.equal(plain.stdout, guarded.stdout);
    assert.deepEqual(await snapshot(root), before);
  }
});
