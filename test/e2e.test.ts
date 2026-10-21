import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { AuditIssue, AuditResult, VariableReference } from "../src/core/types.ts";
import { canaries, sourceFiles, stages } from "./fixtures/complete-audit.ts";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const environmentPath = "config/selected env";

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function project(t: TestContext, reverse = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "envclarity e2e "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const entries = Object.entries(sourceFiles);
  for (const [path, content] of reverse ? entries.reverse() : entries) await put(root, path, content);
  return root;
}

// Hash contents so a failed snapshot assertion cannot print environment or source values.
async function snapshot(root: string): Promise<unknown[]> {
  const entries: unknown[] = [];
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name);
    const stat = await lstat(path);
    entries.push({ name, mode: stat.mode, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs,
      content: stat.isDirectory() ? await snapshot(path)
        : createHash("sha256").update(await readFile(path)).digest("hex") });
  }
  return entries;
}

function runCli(root: string, format: "text" | "json", absolute = false) {
  // Deliberately unguarded: permission restrictions must not mask attempted execution or writes.
  const result = spawnSync(process.execPath, [cliPath, "check", ...(absolute
    ? [`--format=${format}`, "--example", join(root, ".env.example"), "--env", join(root, environmentPath), root]
    : [".", "--env", environmentPath, "--format", format])], {
    cwd: root, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, NODE_URL: canaries.implicit, NEW_VALUE: canaries.implicit, VITE_TITLE: canaries.implicit },
  });
  // Inspect both channels before parsing or comparing them, keeping decoys out of assertion diagnostics.
  for (const canary of Object.values(canaries)) {
    assert.ok(!result.stdout?.includes(canary), "stdout must not expose a decoy value");
    assert.ok(!result.stderr?.includes(canary), "stderr must not expose a decoy value");
  }
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  return result;
}

function reference(name: string, origin: VariableReference["origin"], path: string, line: number, column: number): VariableReference {
  return { name, origin, location: { path, line, column } };
}

const nodeReferences = [
  reference("NODE_URL", "process.env", "src/server.js", 1, 1),
  reference("NODE_URL", "process.env", "src/server.ts", 1, 1),
  reference("NODE_URL", "process.env", "src/server.ts", 2, 1),
];
const newReferences = [
  reference("NEW_VALUE", "process.env", "src/server.ts", 3, 1),
  reference("NEW_VALUE", "process.env", "src/widget.tsx", 4, 6),
];
const viteReferences = [
  reference("VITE_TITLE", "import.meta.env", "src/widget.jsx", 3, 6),
  reference("VITE_TITLE", "import.meta.env", "src/widget.tsx", 3, 6),
];
const nodeDynamic: AuditIssue = {
  code: "DYNAMIC_REFERENCE", severity: "warning",
  reference: { origin: "process.env", location: { path: "src/server.ts", line: 4, column: 1 } },
};
const viteDynamic: AuditIssue = {
  code: "DYNAMIC_REFERENCE", severity: "warning",
  reference: { origin: "import.meta.env", location: { path: "src/widget.tsx", line: 5, column: 6 } },
};

// Independent expectations: do not call audit, the comparator or either production reporter.
function expectedResult(stage: number): AuditResult {
  const issues: AuditIssue[] = stage === 2 ? [nodeDynamic, viteDynamic] : [
    { code: "MISSING_VARIABLE", severity: "error", name: "NODE_URL", references: nodeReferences },
    ...(stage === 0
      ? [{ code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: "NEW_VALUE", references: newReferences } as const]
      : [{ code: "MISSING_VARIABLE", severity: "error", name: "NEW_VALUE", references: newReferences } as const]),
    nodeDynamic,
    { code: "EMPTY_VARIABLE", severity: "warning", name: "VITE_TITLE", references: viteReferences },
    viteDynamic,
    ...(stage === 0
      ? [{ code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "UNUSED", references: [] } as const] : []),
  ];
  return { status: "completed", report: {
    schemaVersion: 1,
    summary: stage === 0 ? { errorCount: 1, warningCount: 5 }
      : stage === 1 ? { errorCount: 2, warningCount: 3 } : { errorCount: 0, warningCount: 2 },
    issues,
    references: [...nodeReferences, newReferences[0]!, ...viteReferences, newReferences[1]!],
    coverage: { scope: "direct-references", limitations: [
      "ALIASES_NOT_RESOLVED", "DESTRUCTURING_NOT_RESOLVED", "WRAPPERS_NOT_RESOLVED", "DYNAMIC_REFERENCES_NOT_RESOLVED",
    ] },
  } };
}

function checkCompleted(stdout: string, format: "text" | "json", expected: AuditResult): void {
  assert.equal(expected.status, "completed");
  if (format === "json") {
    assert.deepEqual(JSON.parse(stdout), expected);
    assert.equal(stdout, `${stdout.trim()}\n`);
    return;
  }
  const { report } = expected;
  assert.ok(stdout.startsWith(`Audit completed.\nSummary: ${report.summary.errorCount} error(s), ${report.summary.warningCount} warning(s).\n`));
  const lines = report.issues.flatMap(issue => {
    const header = `${issue.severity.toUpperCase()} ${issue.code}${issue.code === "DYNAMIC_REFERENCE" ? "" : ` "${issue.name}"`}`;
    const locations = issue.code === "DYNAMIC_REFERENCE" ? [issue.reference.location] : issue.references.map(ref => ref.location);
    return [header, ...locations.map(location => `  at "${location.path}":${location.line}:${location.column}`)];
  });
  assert.deepEqual(stdout.split("\n").filter(line => /^(ERROR |WARNING |  at )/.test(line)), lines);
  assert.ok(stdout.includes("Coverage: direct references only (process.env and import.meta.env)."));
  assert.ok(stdout.includes("Dynamic reference names are not resolved."));
}

test("compiled CLI follows documentation and configuration repairs deterministically across equivalent projects", async (t) => {
  const roots = [await project(t), await project(t, true)];
  for (const [index, stage] of stages.entries()) {
    await t.test(stage.name, async () => {
      const outputs = new Map<string, string>();
      for (const root of roots) {
        await put(root, ".env.example", stage.example);
        await put(root, environmentPath, stage.environment);
        const before = await snapshot(root);
        for (const format of ["text", "json"] as const) {
          for (const absolute of [false, true]) {
            const result = runCli(root, format, absolute);
            assert.equal(result.status, stage.exitCode);
            checkCompleted(result.stdout, format, expectedResult(index));
            if (outputs.has(format)) assert.equal(result.stdout, outputs.get(format));
            else outputs.set(format, result.stdout);
            assert.deepEqual(await snapshot(root), before);
          }
        }
      }
    });
  }
});

test("compiled CLI leaves the project untouched on failures and recovers after the input is repaired", async (t) => {
  const root = await project(t);
  const corrected = stages[2];
  for (const selected of [
    { path: ".env.example", content: `BROKEN="${canaries.example}`, code: "FORMAT_ERROR" },
    { path: environmentPath, content: `BROKEN="${canaries.selected}`, code: "FORMAT_ERROR" },
    { path: environmentPath, content: null, code: "READ_ERROR" },
  ] as const) {
    await t.test(`${selected.code} in ${selected.path}`, async () => {
      await put(root, ".env.example", corrected.example);
      await put(root, environmentPath, corrected.environment);
      if (selected.content === null) await rm(join(root, selected.path));
      else await put(root, selected.path, selected.content);
      const before = await snapshot(root);
      for (const format of ["text", "json"] as const) {
        const result = runCli(root, format);
        assert.equal(result.status, 2);
        if (format === "json") assert.deepEqual(JSON.parse(result.stdout), { status: "failed", code: selected.code });
        else {
          assert.ok(result.stdout.startsWith(`Audit failed: ${selected.code}\n`));
          assert.ok(result.stdout.endsWith("No completed report is available.\n"));
        }
        assert.doesNotMatch(result.stdout, /Audit completed|"report"|"summary"|NODE_URL|VITE_TITLE|NEW_VALUE/);
        assert.deepEqual(await snapshot(root), before);
      }
      await put(root, ".env.example", corrected.example);
      await put(root, environmentPath, corrected.environment);
      const repaired = await snapshot(root);
      for (const format of ["text", "json"] as const) {
        const result = runCli(root, format);
        assert.equal(result.status, 0);
        checkCompleted(result.stdout, format, expectedResult(2));
        assert.deepEqual(await snapshot(root), repaired);
      }
    });
  }
});
