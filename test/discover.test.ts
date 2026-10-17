import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { discover } from "../src/io/discover.ts";

async function project(t: TestContext, paths: string[] = []): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "envclarity-discover-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of paths) {
    const absolutePath = join(root, path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, "// Synthetic fixture.\n");
  }
  return root;
}

test("discovers all supported extensions in nested directories in deterministic order", async (t) => {
  const root = await project(t, [
    "z.js", "src/view.tsx", "src/nested/component.jsx", "index.ts", "src/types.d.ts", "Z.ts",
    "components.ts/child.js",
  ]);
  const expected = [
    "Z.ts", "components.ts/child.js", "index.ts", "src/nested/component.jsx", "src/types.d.ts",
    "src/view.tsx", "z.js",
  ];

  assert.deepEqual(await discover(root), expected);
  assert.deepEqual(await discover(root), expected);
});

test("excludes dependency, version control and output directories at any depth", async (t) => {
  const excluded = ["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".cache"];
  const root = await project(t, [
    ...excluded.flatMap((name) => [`${name}/hidden.ts`, `src/${name}/nested/hidden.jsx`]),
    "src/keep.ts", "node_modules-extra/keep.js", "distribution/keep.tsx", "dist.ts",
  ]);

  assert.deepEqual(await discover(root), [
    "dist.ts", "distribution/keep.tsx", "node_modules-extra/keep.js", "src/keep.ts",
  ]);
});

test("ignores unsupported extensions and environment files", async (t) => {
  const root = await project(t, [
    "README.md", "config.json", "style.css", "script.mjs", "script.cjs", "module.mts", "module.cts",
    "source.ts.map", "source.TS", "no-extension", ".env", ".env.example", ".env.local", "keep.jsx",
  ]);

  assert.deepEqual(await discover(root), ["keep.jsx"]);
});

test("returns an empty list when there are no source files", async (t) => {
  const root = await project(t);
  await mkdir(join(root, "empty/nested"), { recursive: true });

  assert.deepEqual(await discover(root), []);
});

test("omits file, directory, broken and cyclic symbolic links without following them", async (t) => {
  const root = await project(t, ["src/keep.ts"]);
  const external = await project(t, ["outside.ts"]);
  await symlink(join(root, "src/keep.ts"), join(root, "internal.ts"), "file");
  await symlink(join(external, "outside.ts"), join(root, "external.ts"), "file");
  await symlink(join(root, "src"), join(root, "internal-directory"), "dir");
  await symlink(external, join(root, "external-directory"), "dir");
  await symlink(join(root, "missing.ts"), join(root, "broken.ts"), "file");
  await symlink(root, join(root, "src/cycle"), "dir");

  assert.deepEqual(await discover(root), ["src/keep.ts"]);
});

test("does not execute or modify the discovered project", async (t) => {
  const root = await project(t, ["config.ts", "execute.js"]);
  const executable = join(root, "execute.js");
  const content = 'import { writeFileSync } from "node:fs";\n'
    + 'writeFileSync(new URL("./executed.txt", import.meta.url), "unexpected execution");\n';
  await writeFile(executable, content);
  const before = await lstat(executable);

  assert.deepEqual(await discover(root), ["config.ts", "execute.js"]);

  assert.deepEqual((await readdir(root)).sort(), ["config.ts", "execute.js"]);
  assert.equal(await readFile(executable, "utf8"), content);
  const after = await lstat(executable);
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.ctimeMs, before.ctimeMs);
  assert.equal(after.mode, before.mode);
});
