import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { inspect } from "node:util";
import { audit } from "../src/audit.ts";
import type { AuditFailureCode, AuditResult } from "../src/core/types.ts";
import { ProjectFiles, SCAN_LIMITS } from "../src/io/discover.ts";

const canary = "synthetic-audit-value-canary";

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}

async function project(t: TestContext, entries: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "envclarity-audit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries({ ".env.example": "", "selected.env": "", ...entries })) {
    await put(root, path, content);
  }
  return root;
}

function completed(result: AuditResult) {
  assert.equal(result.status, "completed");
  return result.report;
}

function failed(result: AuditResult, code: AuditFailureCode): void {
  assert.deepEqual(result, { status: "failed", code });
  assert.ok(!inspect(result, { showHidden: true }).includes(canary));
  assert.ok(!JSON.stringify(result).includes(canary));
}

test("audits Node, Vite, JSX and TSX with all five issues and deterministic locations", async (t) => {
  const root = await project(t, {
    ".env.example": `NODE=${canary}\nJS=\nMISSING=\nEMPTY=\nUNUSED=\nMODE=\nVITE=`,
    "selected.env": `NODE=${canary}\nJS=${canary}\nEMPTY=\nUNUSED=${canary}\nMODE=${canary}\nVITE=${canary}`,
    "src/node.ts": `process.env.NODE;\nprocess.env.UNDOCUMENTED;\n// process.env.COMMENT\n"process.env.STRING";`,
    "src/script.js": 'process.env["JS"];\nprocess.env.MODE;',
    "src/view.jsx": 'export const view = <div>{import.meta.env.VITE}{import.meta.env.MODE}{import.meta.env.BASE_URL}</div>;',
    "src/view.tsx": 'export const view = <div>{process.env.MISSING}{process.env.EMPTY}{import.meta.env[key]}{import.meta.env.DEV}{import.meta.env.PROD}{import.meta.env.SSR}</div>;',
  });
  const result = await audit(root, "selected.env");
  const report = completed(result);
  assert.deepEqual(report.summary, { errorCount: 1, warningCount: 4 });
  assert.deepEqual(report.issues.map(issue => [issue.code, "name" in issue ? issue.name : undefined]), [
    ["UNDOCUMENTED_VARIABLE", "UNDOCUMENTED"],
    ["MISSING_VARIABLE", "MISSING"],
    ["EMPTY_VARIABLE", "EMPTY"],
    ["DYNAMIC_REFERENCE", undefined],
    ["POSSIBLY_UNUSED_VARIABLE", "UNUSED"],
  ]);
  assert.deepEqual(report.references.map(({ name, origin, location }) => [name, origin, location.path]), [
    ["NODE", "process.env", "src/node.ts"],
    ["UNDOCUMENTED", "process.env", "src/node.ts"],
    ["JS", "process.env", "src/script.js"],
    ["MODE", "process.env", "src/script.js"],
    ["VITE", "import.meta.env", "src/view.jsx"],
    ["MISSING", "process.env", "src/view.tsx"],
    ["EMPTY", "process.env", "src/view.tsx"],
  ]);
  assert.deepEqual(report.references[1]?.location, { path: "src/node.ts", line: 2, column: 1 });
  const dynamic = report.issues.find(issue => issue.code === "DYNAMIC_REFERENCE");
  assert.deepEqual(dynamic, {
    code: "DYNAMIC_REFERENCE", severity: "warning",
    reference: { origin: "import.meta.env", location: { path: "src/view.tsx", line: 1, column: 67 } },
  });
  assert.ok(!JSON.stringify(result).includes(canary));
  assert.equal(JSON.stringify(await audit(root, "selected.env")), JSON.stringify(result));

  await put(root, ".env.example", "NODE=\nJS=\nMISSING=\nEMPTY=\nUNUSED=\nMODE=\nVITE=\nUNDOCUMENTED=");
  await put(root, "selected.env", ["NODE", "JS", "MISSING", "EMPTY", "UNUSED", "MODE", "VITE", "UNDOCUMENTED"]
    .map(name => `${name}=${canary}`).join("\n"));
  await put(root, "src/view.tsx", 'export const view = <div>{process.env.MISSING}{process.env.EMPTY}{import.meta.env["UNUSED"]}</div>;');
  assert.deepEqual(completed(await audit(root, "selected.env")).issues, []);
});

test("documents an undocumented variable, reports its absence, then clears it when configured", async (t) => {
  const root = await project(t, { "app.ts": "process.env.DATABASE_URL;" });
  assert.deepEqual(completed(await audit(root, "selected.env")).issues.map(issue => issue.code), ["UNDOCUMENTED_VARIABLE"]);
  await put(root, ".env.example", "DATABASE_URL=");
  assert.deepEqual(completed(await audit(root, "selected.env")).issues.map(issue => issue.code), ["MISSING_VARIABLE"]);
  await put(root, "selected.env", `DATABASE_URL=${canary}`);
  assert.deepEqual(completed(await audit(root, "selected.env")).issues, []);
});

test("accepts an explicit alternative example and validates even a source-free project", async (t) => {
  const root = await project(t, {
    ".env.example": "invalid default example", "config/custom.example": "CUSTOM=",
    "config/chosen.env": `CUSTOM=${canary}`,
  });
  const report = completed(await audit(root, "config/chosen.env", "config/custom.example"));
  assert.deepEqual(report.references, []);
  assert.deepEqual(report.issues.map(issue => issue.code), ["POSSIBLY_UNUSED_VARIABLE"]);
  failed(await audit(root, "selected.env"), "FORMAT_ERROR");
  await put(root, ".env.example", "");
  assert.deepEqual(completed(await audit(root, "selected.env")).summary, { errorCount: 0, warningCount: 0 });
  failed(await audit(root, "missing.env"), "READ_ERROR");
});

test("requires an explicitly selected environment, including calls from JavaScript", async (t) => {
  const root = await project(t, { ".env": `DEFAULT=${canary}` });
  // @ts-expect-error Exercise JavaScript callers that omit the required selection.
  failed(await audit(root), "INVALID_INPUT");
  failed(await audit(root, ""), "INVALID_INPUT");
});

test("reuses one ProjectFiles session and awaits each real operation", async (t) => {
  const root = await project(t, { "a.ts": "process.env.A;", "b.tsx": "<div>{process.env.B}</div>" });
  const originalOpen = ProjectFiles.open;
  const calls: string[] = [];
  let active = false;
  t.mock.method(ProjectFiles, "open", async (selected: string) => {
    calls.push("open");
    const files = await originalOpen(selected);
    for (const method of ["discover", "readEnvironment", "readSource"] as const) {
      const original = files[method];
      t.mock.method(files, method, async function (this: ProjectFiles, ...args: unknown[]) {
        assert.equal(this, files);
        assert.equal(active, false);
        active = true;
        calls.push(`${method}:${args[0] ?? ""}`);
        try {
          return await Reflect.apply(original, this, args);
        } finally {
          active = false;
        }
      });
    }
    return files;
  });
  completed(await audit(root, "selected.env"));
  assert.deepEqual(calls, ["open", "discover:", "readEnvironment:.env.example",
    "readEnvironment:selected.env", "readSource:a.ts", "readSource:b.tsx"]);
});

test("discards earlier references if a later candidate becomes unreadable", async (t) => {
  const root = await project(t, { "a.ts": "process.env.EARLY;", "z.ts": "process.env.LATE;" });
  const original = ProjectFiles.prototype.readSource;
  t.mock.method(ProjectFiles.prototype, "readSource", async function (this: ProjectFiles, path: string) {
    if (path === "z.ts") await rm(join(root, path));
    return original.call(this, path);
  });
  failed(await audit(root, "selected.env"), "READ_ERROR");
});

test("returns safe failures for invalid roots, selected paths, symlinks and environment formats", async (t) => {
  const root = await project(t, { "app.ts": "process.env.EARLY;" });
  failed(await audit("", "selected.env"), "INVALID_INPUT");
  failed(await audit(join(root, canary), "selected.env"), "READ_ERROR");
  failed(await audit(root, `../${canary}`), "INVALID_INPUT");
  failed(await audit(root, "selected.env", canary), "READ_ERROR");
  await symlink("selected.env", join(root, "link.env"));
  failed(await audit(root, "link.env"), "INVALID_INPUT");
  failed(await audit(root, "selected.env", "link.env"), "INVALID_INPUT");
  for (const path of [".env.example", "selected.env"]) {
    await put(root, path, `BAD="${canary}`);
    failed(await audit(root, "selected.env"), "FORMAT_ERROR");
    await put(root, path, "");
  }
});

async function sized(root: string, path: string, bytes: number): Promise<void> {
  const handle = await open(join(root, path), "w");
  try {
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
}

test("rejects per-file and aggregate limits instead of producing an empty report", async (t) => {
  for (const [path, bytes] of [
    ["selected.env", SCAN_LIMITS.environmentBytes + 1],
    [".env.example", SCAN_LIMITS.environmentBytes + 1],
    ["large.ts", SCAN_LIMITS.sourceBytes + 1],
  ] as const) {
    const root = await project(t);
    await sized(root, path, bytes);
    failed(await audit(root, "selected.env"), "LIMIT_EXCEEDED");
  }
  const root = await project(t);
  for (let index = 0; index <= SCAN_LIMITS.totalSourceBytes / SCAN_LIMITS.sourceBytes; index++) {
    await sized(root, `${index}.ts`, SCAN_LIMITS.sourceBytes);
  }
  failed(await audit(root, "selected.env"), "LIMIT_EXCEEDED");
});

test("keeps the source budget shared across reads even when files grow after discovery", async (t) => {
  const entries: Record<string, string> = { "z.ts": "process.env.LATE;" };
  for (let index = 0; index < SCAN_LIMITS.totalSourceBytes / SCAN_LIMITS.sourceBytes; index++) {
    entries[`a${index}.ts`] = "";
  }
  const root = await project(t, entries);
  const original = ProjectFiles.prototype.discover;
  t.mock.method(ProjectFiles.prototype, "discover", async function (this: ProjectFiles) {
    const paths = await original.call(this);
    for (const path of paths.filter(path => path !== "z.ts")) {
      await put(root, path, "process.env.EARLY;".padEnd(SCAN_LIMITS.sourceBytes, " "));
    }
    return paths;
  });
  failed(await audit(root, "selected.env"), "LIMIT_EXCEEDED");
});

test("sanitizes unexpected exceptions without retaining messages, causes or partial reports", async (t) => {
  const root = await project(t);
  t.mock.method(ProjectFiles.prototype, "discover", async () => {
    throw new Error(canary, { cause: new Error(canary) });
  });
  failed(await audit(root, "selected.env"), "READ_ERROR");
});

test("honors traversal exclusions and omits linked and unsupported sources", async (t) => {
  const entries: Record<string, string> = { "src/keep.ts": "process.env.KEEP;" };
  for (const name of ["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".cache"]) {
    entries[`${name}/hidden.ts`] = `process.env.HIDDEN; throw new Error('${canary}');`;
    entries[`src/${name}/hidden.tsx`] = "<div>{process.env.HIDDEN}</div>";
  }
  entries["unsupported.mjs"] = "process.env.HIDDEN;";
  const root = await project(t, entries);
  const external = await project(t, { "outside.ts": "process.env.OUTSIDE;" });
  await symlink(external, join(root, "linked-directory"), "dir");
  await symlink(join(external, "outside.ts"), join(root, "linked.ts"));
  await symlink("missing", join(root, "broken.ts"));
  assert.deepEqual(completed(await audit(root, "selected.env")).references.map(({ name }) => name), ["KEEP"]);
});

async function snapshot(root: string): Promise<unknown[]> {
  const entries: unknown[] = [];
  for (const name of (await readdir(root)).sort()) {
    const path = join(root, name);
    const stat = await lstat(path);
    const content = stat.isSymbolicLink() ? await readlink(path)
      : stat.isDirectory() ? await snapshot(path) : await readFile(path, "utf8");
    entries.push({ name, mode: stat.mode, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs, content });
  }
  return entries;
}

test("emits nothing, never executes or modifies the project, and ignores process and implicit environments", async (t) => {
  const root = await project(t, {
    ".env.example": "PROCESS_ONLY=\nIMPLICIT=\nSELECTED=",
    "selected.env": `SELECTED=${canary}\nCOMMAND=$(touch command-marker)\nEXPANSION=\${PROCESS_ONLY}`,
    ".env": `IMPLICIT=${canary}`, ".env.local": `PROCESS_ONLY=${canary}`,
    "package.json": JSON.stringify({ type: "module", scripts: { preinstall: "touch script-marker", build: "touch script-marker" } }),
    "vite.config.ts": `throw new Error('${canary}');`,
    "execute.js": 'import { writeFileSync } from "node:fs"; writeFileSync(new URL("executed-marker", import.meta.url), "executed");',
    "app.tsx": '<div>{process.env.PROCESS_ONLY}{process.env.IMPLICIT}{import.meta.env.SELECTED}</div>;',
  });
  const before = await snapshot(root);
  for (const moduleUrl of [new URL("../src/audit.ts", import.meta.url), new URL("../dist/audit.js", import.meta.url)]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { audit } from ${JSON.stringify(moduleUrl.href)};
      const before = { ...process.env };
      const result = await audit(process.argv[1], 'selected.env');
      assert.equal(result.status, 'completed');
      assert.deepEqual(result.report.issues.map(issue => [issue.code, issue.name]).sort(),
        [['MISSING_VARIABLE', 'IMPLICIT'], ['MISSING_VARIABLE', 'PROCESS_ONLY']]);
      assert.ok(!JSON.stringify(result).includes(${JSON.stringify(canary)}));
      const failure = await audit(process.argv[1], ${JSON.stringify(canary)});
      assert.deepEqual(failure, { status: 'failed', code: 'READ_ERROR' });
      assert.deepEqual({ ...process.env }, before);
    `, root], { cwd: root, encoding: "utf8", env: { ...process.env, PROCESS_ONLY: canary } });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "");
  }
  assert.deepEqual(await snapshot(root), before);
});
