import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { startViewer } from "../src/viewer-server.ts";
import { parseCliArguments } from "../src/cli-args.ts";

test("viewer accepts only its standalone command", () => {
  assert.deepEqual(parseCliArguments(["viewer"]), { command: "viewer" });
  for (const args of [["viewer", "--help"], ["viewer", "project"], ["viewer", "--port", "8080"]]) {
    assert.deepEqual(parseCliArguments(args), { command: "invalid" });
  }
});

test("local server serves only bundled assets and rejects unsafe requests", async t => {
  const root = await mkdtemp(join(tmpdir(), "envclarity-viewer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "assets"));
  await mkdir(join(root, "fonts"));
  await writeFile(join(root, "index.html"), '<div id="root"></div>');
  await writeFile(join(root, "assets/app.js"), "console.log('bundle');");
  await writeFile(join(root, "assets/app.css"), "body{color:white}");
  await writeFile(join(root, "fonts/font.woff2"), "synthetic font bytes");
  await writeFile(join(root, "fonts/OFL.txt"), "synthetic license");
  await writeFile(join(root, ".env"), "PRIVATE_VALUE");
  await symlink(join(root, ".env"), join(root, "assets/linked.txt"));
  const server = await startViewer(pathToFileURL(root + "/"));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const address = server.address();
  assert(address !== null && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  const origin = `http://127.0.0.1:${address.port}`;

  function get(path: string, method = "GET", headers: Record<string, string> = {}) {
    return new Promise<{ status: number | undefined; headers: import("node:http").IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const req = request(origin, { path, method, headers, timeout: 5_000 }, res => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("Test request timed out")));
      req.end();
    });
  }

  const home = await get("/");
  assert.equal(home.status, 200);
  assert.equal(home.body, '<div id="root"></div>');
  assert.equal(home.headers["cache-control"], "no-store");
  assert.equal(home.headers["x-content-type-options"], "nosniff");
  assert.equal(home.headers["referrer-policy"], "no-referrer");
  assert.match(String(home.headers["content-security-policy"]), /connect-src 'none'/);
  assert.match(String(home.headers["content-security-policy"]), /frame-ancestors 'none'/);
  assert.equal(home.headers["access-control-allow-origin"], undefined);
  for (const [path, type] of [["/assets/app.js", "text/javascript"], ["/assets/app.css", "text/css"], ["/fonts/font.woff2", "font/woff2"], ["/fonts/OFL.txt", "text/plain"]]) {
    const result = await get(path!);
    assert.equal(result.status, 200);
    assert.ok(String(result.headers["content-type"]).startsWith(type!));
  }
  const head = await get("/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.headers["content-length"], String(Buffer.byteLength(home.body)));
  for (const path of ["/.env", "/../.env", "/%2e%2e/.env", "/assets/linked.txt", "/assets/", "/src/cli.ts", "/?report=private", "//example.com/"]) {
    const result = await get(path);
    assert.equal(result.status, 404, path);
    assert.equal(result.body, "");
  }
  assert.equal((await get("/", "GET", { Host: "example.com" })).status, 403);
  assert.equal((await get("/", "GET", { Origin: "https://example.com" })).status, 403);
  assert.equal((await get("/", "GET", { Origin: origin })).status, 200);
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const result = await get("/", method);
    assert.equal(result.status, 405);
    assert.equal(result.headers.allow, "GET, HEAD");
  }
});

test("missing viewer bundle fails before a server is started", async t => {
  const root = await mkdtemp(join(tmpdir(), "envclarity-missing-viewer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(startViewer(pathToFileURL(root + "/")));
});
