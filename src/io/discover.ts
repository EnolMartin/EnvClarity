import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const excludedDirectories = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".cache",
]);

/** List source paths relative to root using forward slashes, without reading file contents. */
export async function discover(root: string): Promise<string[]> {
  const paths: string[] = [];
  const pending = [""];

  while (pending.length > 0) {
    const directory = pending.pop()!;
    const entries = await readdir(join(root, directory), { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;

      const path = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) pending.push(path);
      } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
        paths.push(path);
      }
    }
  }

  return paths.sort();
}
