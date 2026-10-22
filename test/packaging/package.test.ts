import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));
const packedFiles = [
  "README.md",
  "dist/audit.js", "dist/cli-args.js", "dist/cli.js",
  "dist/core/analyze.js", "dist/core/compare.js", "dist/core/report.js",
  "dist/io/discover.js", "dist/io/read-env.js",
  "dist/reporters/json.js", "dist/reporters/text.js", "package.json",
];
const canary = "ENVCLARITY_PACKAGE_SYNTHETIC_VALUE";

function command(executable: string, args: string[], cwd: string) {
  const result = spawnSync(executable, args, { cwd, encoding: "utf8", timeout: 120_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${executable} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("local package contains only runtime files and README and works as an isolated production installation", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "envclarity-package-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = join(root, "envclarity.tgz");
  command("pnpm", ["pack", "--out", archive], repository);

  const entries = command("tar", ["-tzf", archive], root).trim().split("\n").sort();
  assert.deepEqual(entries, packedFiles.map(path => `package/${path}`));
  command("tar", ["-xzf", archive], root);
  const manifest = JSON.parse(await readFile(join(root, "package/package.json"), "utf8"));
  assert.equal(manifest.private, true);
  assert.deepEqual(manifest.bin, { envclarity: "dist/cli.js" });
  assert.deepEqual([...manifest.files].sort(), packedFiles.filter(path => path !== "package.json" && path !== "README.md"));
  assert.deepEqual(Object.keys(manifest.dependencies), ["typescript"]);
  assert.equal(typeof manifest.dependencies.typescript, "string");
  const packedCli = join(root, "package/dist/cli.js");
  assert.ok((await readFile(packedCli, "utf8")).startsWith("#!/usr/bin/env node\n"));
  assert.equal((await stat(packedCli)).mode & 0o777, 0o755);
  t.diagnostic(`Packed files: ${packedFiles.join(", ")}`);
  t.diagnostic(`Archive SHA-256: ${createHash("sha256").update(await readFile(archive)).digest("hex")}`);

  const consumer = join(root, "consumer");
  await mkdir(consumer);
  await writeFile(join(consumer, "package.json"), JSON.stringify({
    name: "envclarity-package-consumer", private: true,
    dependencies: { envclarity: "file:../envclarity.tgz" },
  }));
  // Uses the pnpm store populated by pnpm install; no network or repository links.
  command("pnpm", ["install", "--prod", "--offline", "--ignore-scripts", "--package-import-method=copy"], consumer);
  const installed = await realpath(join(consumer, "node_modules/envclarity"));
  assert.ok(installed.startsWith(`${root}${sep}`));
  const typescript = await realpath(createRequire(join(installed, "package.json")).resolve("typescript"));
  assert.ok(typescript.startsWith(`${root}${sep}`));
  const dependencies = await readdir(join(consumer, "node_modules/.pnpm"));
  assert.ok(dependencies.some(name => name.startsWith("typescript@")));
  assert.ok(!dependencies.some(name => name.startsWith("@types+") || name.startsWith("undici-types@")));
  const executable = join(consumer, "node_modules/.bin/envclarity");
  await access(executable, constants.X_OK);
  await access(join(installed, "dist/cli.js"), constants.X_OK);

  const project = join(root, "synthetic project");
  await mkdir(project);
  await writeFile(join(project, "app.ts"), "process.env.CONFIGURED; import.meta.env.VITE_TITLE;\n");
  await writeFile(join(project, ".env.example"), `CONFIGURED=${canary}\nVITE_TITLE=\n`);

  function run(args: string[], exitCode: number, stderr = "") {
    const result = spawnSync(executable, args, {
      cwd: consumer, encoding: "utf8", timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_PATH: "",
        // Denies reads of the original repository, its dev dependencies and the shared store.
        NODE_OPTIONS: `--permission --allow-fs-read=${root}`,
      },
    });
    assert.ok(!result.stdout?.includes(canary), "stdout must not expose a decoy value");
    assert.ok(!result.stderr?.includes(canary), "stderr must not expose a decoy value");
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, exitCode);
    assert.equal(result.stderr, stderr);
    return result.stdout;
  }

  assert.match(run(["--help"], 0), /Usage: envclarity/);
  for (const state of ["configured", "missing", "unreadable"] as const) {
    const selected = join(project, "selected env");
    if (state === "unreadable") await rm(selected);
    else await writeFile(selected, `CONFIGURED=${canary}\n${state === "configured" ? `VITE_TITLE=${canary}\n` : ""}`);
    for (const format of ["text", "json"]) {
      const output = run(["check", project, "--env", "selected env", "--format", format],
        state === "configured" ? 0 : state === "missing" ? 1 : 2);
      if (format === "json") {
        const result = JSON.parse(output);
        if (state === "unreadable") assert.deepEqual(result, { status: "failed", code: "READ_ERROR" });
        else {
          assert.equal(result.status, "completed");
          assert.deepEqual(result.report.summary, { errorCount: state === "missing" ? 1 : 0, warningCount: 0 });
          assert.deepEqual(result.report.issues.map((issue: { code: string }) => issue.code),
            state === "missing" ? ["MISSING_VARIABLE"] : []);
        }
      } else if (state === "unreadable") assert.match(output, /^Audit failed: READ_ERROR\n/);
      else {
        assert.ok(output.startsWith(`Audit completed.\nSummary: ${state === "missing" ? 1 : 0} error(s), 0 warning(s).\n`));
        if (state === "missing") assert.match(output, /ERROR MISSING_VARIABLE "VITE_TITLE"/);
      }
    }
  }
  assert.equal(run(["--unknown", canary], 2, "Invalid arguments. Use --help for usage.\n"), "");
  t.diagnostic(`Installed executable verified with ${process.version}; exit codes 0/1/2 in text/JSON.`);
});
