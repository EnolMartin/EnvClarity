import { createServer } from "node:http";
import type { Server } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname } from "node:path";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "connect-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'none'",
].join("; ");

async function loadAssets(directory: URL) {
  const assets = new Map<string, { body: Buffer; type: string }>();
  const index = { body: await readFile(new URL("index.html", directory)), type: contentTypes[".html"]! };
  assets.set("/", index);
  assets.set("/index.html", index);

  async function collect(prefix: string): Promise<void> {
    for (const entry of await readdir(new URL(prefix, directory), { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) await collect(`${name}/`);
      else if (entry.isFile()) {
        const type = contentTypes[extname(entry.name)];
        if (type) assets.set(`/${name}`, { body: await readFile(new URL(name, directory)), type });
      }
    }
  }
  await collect("assets/");
  await collect("fonts/");

  return assets;
}

// Requests only look up bundled assets in memory; they never select files on disk.
export async function startViewer(directory = new URL("../viewer/dist/", import.meta.url)): Promise<Server> {
  const assets = await loadAssets(directory);
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 10_000, maxHeaderSize: 8_192 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Content-Security-Policy", contentSecurityPolicy);
    const address = server.address();
    const host = address !== null && typeof address !== "string" ? `127.0.0.1:${address.port}` : "";
    const origin = request.headers.origin;
    if (request.headers.host !== host || (origin !== undefined && origin !== `http://${host}`)) {
      response.writeHead(403).end();
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    const asset = assets.get(request.url ?? "");
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "Content-Type": asset.type, "Content-Length": asset.body.length });
    response.end(request.method === "HEAD" ? undefined : asset.body);
  });
  server.maxConnections = 32;
  server.maxRequestsPerSocket = 100;
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
