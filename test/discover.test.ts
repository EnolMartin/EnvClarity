import assert from "node:assert/strict";
import { appendFile, lstat, mkdir, mkdtemp, open, opendir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { discover, ProjectFiles, SCAN_LIMITS, ScanError } from "../src/io/discover.ts";

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

function failure(code: ScanError["code"]): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof ScanError);
    assert.equal(error.code, code);
    assert.equal("cause" in error, false);
    assert.equal(JSON.stringify(error).includes("SYNTHETIC_SECRET"), false);
    assert.equal(String(error).includes("SYNTHETIC_SECRET"), false);
    return true;
  };
}

async function sizedFile(root: string, path: string, bytes: number): Promise<void> {
  const handle = await open(join(root, path), "w");
  try {
    await handle.truncate(bytes);
  } finally {
    await handle.close();
  }
}

/** Intercept native reads to change fixtures deterministically between stat and read. */
async function observeReads(t: TestContext, root: string, beforeRead: (call: number, length: number) => Promise<void>) {
  const probe = await open(join(root, "probe"), "w+");
  const prototype = Object.getPrototypeOf(probe);
  const read: FileHandle["read"] = probe.read;
  await probe.close();
  let calls = 0;
  let bytes = 0;
  let handle: FileHandle | undefined;
  t.mock.method(prototype, "read", async function (
    this: FileHandle, buffer: Buffer, offset: number, length: number, position: number | null,
  ) {
    assert.ok(length <= 64 * 1024);
    handle = this;
    await beforeRead(++calls, length);
    const result = await Reflect.apply(read, this, [buffer, offset, length, position]);
    bytes += result.bytesRead;
    return result;
  });
  return { calls: () => calls, bytes: () => bytes, handle: () => handle };
}

test("validates roots and rejects missing roots, files, empty input and NUL", async (t) => {
  const root = await project(t, ["file.ts"]);
  await assert.rejects(ProjectFiles.open(""), failure("INVALID_INPUT"));
  await assert.rejects(ProjectFiles.open("bad\0root"), failure("INVALID_INPUT"));
  await assert.rejects(ProjectFiles.open(join(root, "file.ts")), failure("INVALID_INPUT"));
  await assert.rejects(ProjectFiles.open(join(root, "missing")), failure("READ_ERROR"));
});

test("pins the canonical root and accepts relative and absolute paths inside the explicitly chosen root", async (t) => {
  const root = await project(t, ["src/keep.ts", ".env"]);
  const parent = await project(t);
  const alias = join(parent, "root-alias");
  await symlink(root, alias, "dir");
  const files = await ProjectFiles.open(alias);
  assert.deepEqual(await files.discover(), ["src/keep.ts"]);
  assert.equal(await files.readSource("src/../src/keep.ts"), "// Synthetic fixture.\n");
  assert.equal(await files.readEnvironment(join(alias, ".env")), "// Synthetic fixture.\n");
  assert.equal(await files.readEnvironment(join(await realpath(root), ".env")), "// Synthetic fixture.\n");
});

test("rejects dot-dot escapes, absolute outside paths and root-prefix siblings", async (t) => {
  const parent = await project(t);
  const root = join(parent, "app");
  const sibling = join(parent, "app-other");
  await mkdir(root);
  await mkdir(sibling);
  await writeFile(join(parent, "SYNTHETIC_SECRET.env"), "SYNTHETIC_SECRET=value");
  await writeFile(join(sibling, "outside.ts"), "// Synthetic outside source");
  for (const path of ["../SYNTHETIC_SECRET.env", "nested/../../SYNTHETIC_SECRET.env", join(parent, "SYNTHETIC_SECRET.env")]) {
    const files = await ProjectFiles.open(root);
    await assert.rejects(files.readEnvironment(path), failure("INVALID_INPUT"));
  }
  await assert.rejects((await ProjectFiles.open(root)).readSource(join(sibling, "outside.ts")), failure("INVALID_INPUT"));
  await assert.rejects((await ProjectFiles.open(root)).readSource("../app-other/outside.ts"), failure("INVALID_INPUT"));
});

test("rejects selected environment links, including internal, external, broken and ancestor links", async (t) => {
  const root = await project(t, ["config/.env", "src/keep.ts"]);
  const external = await project(t, [".env"]);
  await symlink(join(root, "config/.env"), join(root, "internal.env"));
  await symlink(join(external, ".env"), join(root, "external.env"));
  await symlink(join(root, "missing"), join(root, "broken.env"));
  await symlink(join(root, "config"), join(root, "internal-dir"), "dir");
  await symlink(external, join(root, "external-dir"), "dir");
  await symlink(join(root, "src/keep.ts"), join(root, "linked.ts"));
  for (const path of ["internal.env", "external.env", "broken.env", "internal-dir/.env", "external-dir/.env"]) {
    await assert.rejects((await ProjectFiles.open(root)).readEnvironment(path), failure("INVALID_INPUT"));
  }
  await assert.rejects((await ProjectFiles.open(root)).readSource("linked.ts"), failure("INVALID_INPUT"));
  assert.deepEqual(await discover(root), ["src/keep.ts"]);
});

test("rejects non-regular selections, missing files, unsupported source paths and empty paths", async (t) => {
  const root = await project(t, ["config.json"]);
  await mkdir(join(root, "folder.env"));
  for (const path of ["", "bad\0path", ".", "folder.env"]) {
    await assert.rejects((await ProjectFiles.open(root)).readEnvironment(path), failure("INVALID_INPUT"));
  }
  await assert.rejects((await ProjectFiles.open(root)).readSource("config.json"), failure("INVALID_INPUT"));
  await assert.rejects((await ProjectFiles.open(root)).readEnvironment("missing"), failure("READ_ERROR"));
});

test("accepts exact individual byte limits and rejects a single extra byte before content reads", async (t) => {
  const root = await project(t);
  await sizedFile(root, "exact.ts", SCAN_LIMITS.sourceBytes);
  await sizedFile(root, ".env", SCAN_LIMITS.environmentBytes);
  assert.deepEqual(await discover(root), ["exact.ts"]);
  const files = await ProjectFiles.open(root);
  assert.equal(Buffer.byteLength(await files.readSource("exact.ts")), SCAN_LIMITS.sourceBytes);
  assert.equal(Buffer.byteLength(await files.readEnvironment(".env")), SCAN_LIMITS.environmentBytes);

  await sizedFile(root, "large.ts", SCAN_LIMITS.sourceBytes + 1);
  await sizedFile(root, "large.env", SCAN_LIMITS.environmentBytes + 1);
  const observed = await observeReads(t, root, async () => {});
  await assert.rejects(discover(root), failure("LIMIT_EXCEEDED"));
  await assert.rejects((await ProjectFiles.open(root)).readSource("large.ts"), failure("LIMIT_EXCEEDED"));
  await assert.rejects((await ProjectFiles.open(root)).readEnvironment("large.env"), failure("LIMIT_EXCEEDED"));
  assert.equal(observed.calls(), 0);
});

test("measures bytes instead of UTF-16 characters and preserves UTF-8 across read blocks", async (t) => {
  const root = await project(t);
  const content = "a".repeat(64 * 1024 - 1) + "€" + "😀";
  await writeFile(join(root, "utf8.ts"), content);
  assert.equal(await (await ProjectFiles.open(root)).readSource("utf8.ts"), content);
  await writeFile(join(root, ".env"), "é".repeat(SCAN_LIMITS.environmentBytes / 2 + 1));
  await assert.rejects((await ProjectFiles.open(root)).readEnvironment(".env"), failure("LIMIT_EXCEEDED"));
});

test("enforces the 50 MiB discovery and actual-read budgets across individually valid sources", async (t) => {
  const root = await project(t);
  const paths = Array.from({ length: 25 }, (_, index) => `${index.toString().padStart(2, "0")}.ts`);
  for (const path of paths) await sizedFile(root, path, SCAN_LIMITS.sourceBytes);
  const files = await ProjectFiles.open(root);
  assert.deepEqual(await files.discover(), paths);
  for (const path of paths) assert.equal((await files.readSource(path)).length, SCAN_LIMITS.sourceBytes);
  await sizedFile(root, "empty.ts", 0);
  assert.equal(await files.readSource("empty.ts"), "");
  await writeFile(join(root, ".env"), "SYNTHETIC_SECRET=value");
  assert.equal(await files.readEnvironment(".env"), "SYNTHETIC_SECRET=value");
  await writeFile(join(root, "overflow.ts"), "x");
  await assert.rejects(files.readSource("overflow.ts"), failure("LIMIT_EXCEEDED"));
  await assert.rejects(discover(root), failure("LIMIT_EXCEEDED"));
  // Earlier results cannot turn a failed session into a completed analysis.
  await assert.rejects(files.discover(), failure("LIMIT_EXCEEDED"));
});

test("counts every encountered entry, including unsupported files, excluded directories and links", async (t) => {
  const root = await project(t);
  await mkdir(join(root, "node_modules"));
  await writeFile(join(root, "node_modules/not-counted.ts"), "// Excluded descendant");
  await symlink("missing", join(root, "broken"));
  // Avoid holding thousands of open descriptors at once.
  for (let index = 0; index < SCAN_LIMITS.entries - 2; index += 100) {
    await Promise.all(Array.from({ length: Math.min(100, SCAN_LIMITS.entries - 2 - index) }, (_, offset) =>
      writeFile(join(root, `${index + offset}.txt`), "")));
  }
  assert.deepEqual(await discover(root), []);
  await writeFile(join(root, "overflow.txt"), "");
  await assert.rejects(discover(root), failure("LIMIT_EXCEEDED"));
});

for (const kind of ["source", "environment"] as const) {
  test(`detects ${kind} growth during reading and closes the descriptor on failure`, async (t) => {
    const root = await project(t);
    const path = kind === "source" ? "grow.ts" : ".env";
    const limit = kind === "source" ? SCAN_LIMITS.sourceBytes : SCAN_LIMITS.environmentBytes;
    await sizedFile(root, path, limit);
    const observed = await observeReads(t, root, async (call) => {
      if (call === 1) await appendFile(join(root, path), "SYNTHETIC_SECRET");
    });
    const files = await ProjectFiles.open(root);
    await assert.rejects(kind === "source" ? files.readSource(path) : files.readEnvironment(path), failure("LIMIT_EXCEEDED"));
    assert.equal(observed.calls(), 1);
    assert.equal(observed.bytes(), 64 * 1024);
    const handle = observed.handle();
    assert.ok(handle);
    await assert.rejects(handle.stat(), { code: "EBADF" });
  });

  test(`detects ${kind} growth at the exact EOF boundary with a bounded overflow probe`, async (t) => {
    const root = await project(t);
    const path = kind === "source" ? "grow.ts" : ".env";
    const limit = kind === "source" ? SCAN_LIMITS.sourceBytes : SCAN_LIMITS.environmentBytes;
    await sizedFile(root, path, limit);
    const observed = await observeReads(t, root, async (_call, length) => {
      if (length === 1) await appendFile(join(root, path), "x");
    });
    const files = await ProjectFiles.open(root);
    await assert.rejects(kind === "source" ? files.readSource(path) : files.readEnvironment(path), failure("LIMIT_EXCEEDED"));
    assert.equal(observed.bytes(), limit + 1);
  });
}

test("rechecks discovered source sizes before reading after a file grows", async (t) => {
  const root = await project(t, ["grow.ts"]);
  const files = await ProjectFiles.open(root);
  assert.deepEqual(await files.discover(), ["grow.ts"]);
  await sizedFile(root, "grow.ts", SCAN_LIMITS.sourceBytes + 1);
  const observed = await observeReads(t, root, async () => {});
  await assert.rejects(files.readSource("grow.ts"), failure("LIMIT_EXCEEDED"));
  assert.equal(observed.calls(), 0);
});

test("enforces the remaining cumulative byte budget when a source grows during its read", async (t) => {
  const root = await project(t);
  await sizedFile(root, "repeat.ts", SCAN_LIMITS.sourceBytes);
  const files = await ProjectFiles.open(root);
  for (let index = 0; index < 24; index++) await files.readSource("repeat.ts");
  await sizedFile(root, "last.ts", SCAN_LIMITS.sourceBytes - 1);
  await writeFile(join(root, "grow.ts"), "x");
  await files.readSource("last.ts");
  const observed = await observeReads(t, root, async (call) => {
    if (call === 1) await appendFile(join(root, "grow.ts"), "y");
  });
  await assert.rejects(files.readSource("grow.ts"), failure("LIMIT_EXCEEDED"));
  assert.equal(observed.bytes(), 2);
});

test("fails explicitly if traversal cannot be completed, without returning a partial list", async (t) => {
  const root = await project(t, ["readable.ts", "nested/keep.ts"]);
  const probe = await opendir(root);
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  const read = prototype.read;
  let calls = 0;
  t.mock.method(prototype, "read", async function (this: unknown) {
    if (++calls === 2) throw new Error("SYNTHETIC_SECRET in a native error");
    return Reflect.apply(read, this, []);
  });
  const files = await ProjectFiles.open(root);
  await assert.rejects(files.discover(), failure("READ_ERROR"));
  await assert.rejects(files.readSource("readable.ts"), failure("READ_ERROR"));
});

test("rejects root replacement and links inserted after discovery", async (t) => {
  const parent = await project(t);
  const root = join(parent, "root");
  await mkdir(root);
  await writeFile(join(root, "file.ts"), "// Synthetic source");
  const files = await ProjectFiles.open(root);
  assert.deepEqual(await files.discover(), ["file.ts"]);
  await rename(root, join(parent, "moved"));
  await mkdir(root);
  await writeFile(join(root, "file.ts"), "// Replacement source");
  await assert.rejects(files.readSource("file.ts"), failure("READ_ERROR"));

  const next = await ProjectFiles.open(root);
  assert.deepEqual(await next.discover(), ["file.ts"]);
  await rm(join(root, "file.ts"));
  await symlink(join(parent, "moved/file.ts"), join(root, "file.ts"));
  await assert.rejects(next.readSource("file.ts"), failure("INVALID_INPUT"));
});

test("sanitizes native read failures and closes the file without exposing content", async (t) => {
  const root = await project(t, ["file.ts"]);
  const probe = await open(join(root, "file.ts"));
  const prototype = Object.getPrototypeOf(probe);
  await probe.close();
  let failedHandle: FileHandle | undefined;
  t.mock.method(prototype, "read", async function (this: FileHandle) {
    failedHandle = this;
    throw new Error("SYNTHETIC_SECRET from filesystem");
  });
  const files = await ProjectFiles.open(root);
  await assert.rejects(files.readSource("file.ts"), failure("READ_ERROR"));
  assert.ok(failedHandle);
  await assert.rejects(failedHandle.stat(), { code: "EBADF" });
  await assert.rejects(files.discover(), failure("READ_ERROR"));
});

test("rechecks the opened descriptor size before reading any content", async (t) => {
  const root = await project(t, ["grow.ts"]);
  const probe = await open(join(root, "grow.ts"));
  const prototype = Object.getPrototypeOf(probe);
  const stat: FileHandle["stat"] = probe.stat;
  await probe.close();
  let calls = 0;
  t.mock.method(prototype, "stat", async function (this: FileHandle) {
    if (++calls === 1) await sizedFile(root, "grow.ts", SCAN_LIMITS.sourceBytes + 1);
    return Reflect.apply(stat, this, []);
  });
  const observed = await observeReads(t, root, async () => {});
  await assert.rejects((await ProjectFiles.open(root)).readSource("grow.ts"), failure("LIMIT_EXCEEDED"));
  assert.equal(observed.calls(), 0);
});

test("rejects a file replaced after open before reading its content", async (t) => {
  const root = await project(t, ["file.ts", "replacement.ts"]);
  const probe = await open(join(root, "file.ts"));
  const prototype = Object.getPrototypeOf(probe);
  const stat: FileHandle["stat"] = probe.stat;
  await probe.close();
  let calls = 0;
  t.mock.method(prototype, "stat", async function (this: FileHandle) {
    if (++calls === 1) await rename(join(root, "replacement.ts"), join(root, "file.ts"));
    return Reflect.apply(stat, this, []);
  });
  const observed = await observeReads(t, root, async () => {});
  await assert.rejects((await ProjectFiles.open(root)).readSource("file.ts"), failure("READ_ERROR"));
  assert.equal(observed.calls(), 0);
});

test("rejects overlapping operations on one analysis budget instead of racing its counters", async (t) => {
  const root = await project(t, ["file.ts"]);
  const files = await ProjectFiles.open(root);
  const results = await Promise.allSettled([files.readSource("file.ts"), files.readSource("file.ts")]);
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") failure("INVALID_INPUT")(result.reason);
  }
});
