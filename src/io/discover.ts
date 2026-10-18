import { constants } from "node:fs";
import type { Stats } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AuditFailureCode } from "../core/types.js";

/** Inclusive raw-byte caps; entries include links, excluded directories and unsupported files. */
export const SCAN_LIMITS = Object.freeze({
  sourceBytes: 2 * 1024 * 1024,
  environmentBytes: 256 * 1024,
  entries: 20_000,
  totalSourceBytes: 50 * 1024 * 1024,
});

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const excludedDirectories = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", ".cache",
]);

type ScanFailureCode = AuditFailureCode;
const failureMessages: Record<ScanFailureCode, string> = {
  INVALID_INPUT: "Invalid project root or selected path.",
  READ_ERROR: "Project file access could not be completed safely.",
  FORMAT_ERROR: "Environment file format is not supported.",
  LIMIT_EXCEEDED: "Project scanning limit exceeded.",
};

/** Safe operational failure: no paths, contents or original filesystem/parser errors. */
export class ScanError extends Error {
  readonly code: ScanFailureCode;

  constructor(code: ScanFailureCode) {
    super(failureMessages[code]);
    this.name = "ScanError";
    this.code = code;
  }
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function within(root: string, path: string): boolean {
  const remainder = relative(root, path);
  return remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder);
}

/** One analysis budget. Operations are sequential; any failure invalidates the session. */
export class ProjectFiles {
  private sourceBytes = 0;
  private entries = 0;
  private busy = false;
  private failure: ScanError | undefined;
  private readonly root: string;
  private readonly rootStat: Stats;
  private readonly selectedRoot: string;

  private constructor(root: string, rootStat: Stats, selectedRoot: string) {
    this.root = root;
    this.rootStat = rootStat;
    this.selectedRoot = selectedRoot;
  }

  /** Resolve an explicitly chosen root once, including platform aliases such as /tmp. */
  static async open(root: string): Promise<ProjectFiles> {
    if (!root || root.includes("\0")) throw new ScanError("INVALID_INPUT");
    try {
      const canonical = await realpath(root);
      const stat = await lstat(canonical);
      if (!stat.isDirectory()) throw new ScanError("INVALID_INPUT");
      const files = new ProjectFiles(canonical, stat, resolve(root));
      await files.validateRoot();
      return files;
    } catch (error) {
      throw error instanceof ScanError ? error : new ScanError("READ_ERROR");
    }
  }

  private async validateRoot(): Promise<void> {
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || !sameFile(stat, this.rootStat)
      || await realpath(this.root) !== this.root) {
      throw new ScanError("READ_ERROR");
    }
  }

  private async validate(path: string, kind: "file" | "directory"): Promise<{ path: string; stat: Stats }> {
    if (!path || path.includes("\0")) throw new ScanError("INVALID_INPUT");
    let absolute = resolve(this.root, path);
    if (isAbsolute(path) && within(this.selectedRoot, absolute)) {
      absolute = resolve(this.root, relative(this.selectedRoot, absolute));
    }
    if (!within(this.root, absolute)) throw new ScanError("INVALID_INPUT");
    await this.validateRoot();

    const parts = relative(this.root, absolute).split(sep).filter(Boolean);
    let current = this.root;
    let stat = this.rootStat;
    for (const [index, part] of parts.entries()) {
      current = resolve(current, part);
      stat = await lstat(current);
      if (stat.isSymbolicLink()) throw new ScanError("INVALID_INPUT");
      if (index < parts.length - 1 && !stat.isDirectory()) throw new ScanError("INVALID_INPUT");
    }
    if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
      throw new ScanError("INVALID_INPUT");
    }
    if (await realpath(absolute) !== absolute) throw new ScanError("READ_ERROR");
    return { path: absolute, stat };
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.failure) throw this.failure;
    if (this.busy) {
      this.failure = new ScanError("INVALID_INPUT");
      throw this.failure;
    }
    this.busy = true;
    try {
      const result = await operation();
      if (this.failure) throw this.failure;
      return result;
    } catch (error) {
      this.failure ??= error instanceof ScanError ? error : new ScanError("READ_ERROR");
      throw this.failure;
    } finally {
      this.busy = false;
    }
  }

  /** Stream directory entries; return a sorted list only after the whole traversal succeeds. */
  async discover(): Promise<string[]> {
    return this.run(async () => {
      const paths: string[] = [];
      const pending = ["."];
      let sourceBytes = 0;
      while (pending.length > 0) {
        const path = pending.pop()!;
        const before = await this.validate(path, "directory");
        const directory = await opendir(before.path);
        try {
          const opened = await this.validate(path, "directory");
          if (!sameFile(before.stat, opened.stat)) throw new ScanError("READ_ERROR");
          for (let entry = await directory.read(); entry !== null; entry = await directory.read()) {
            if (++this.entries > SCAN_LIMITS.entries) throw new ScanError("LIMIT_EXCEEDED");
            if (entry.isSymbolicLink()) continue;
            const selected = path === "." ? entry.name : `${path}/${entry.name}`;
            if (entry.isDirectory()) {
              if (!excludedDirectories.has(entry.name)) pending.push(selected);
            } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
              const file = await this.validate(selected, "file");
              sourceBytes += file.stat.size;
              if (file.stat.size > SCAN_LIMITS.sourceBytes || sourceBytes > SCAN_LIMITS.totalSourceBytes) {
                throw new ScanError("LIMIT_EXCEEDED");
              }
              paths.push(selected);
            }
          }
          const after = await this.validate(path, "directory");
          if (!sameFile(before.stat, after.stat)) throw new ScanError("READ_ERROR");
        } finally {
          await directory.close();
        }
      }
      return paths.sort();
    });
  }

  /** Raw bounded input for the source analyzer; every read consumes this session's budget. */
  async readSource(path: string): Promise<string> {
    return this.run(async () => {
      if (!sourceExtensions.has(extname(path))) throw new ScanError("INVALID_INPUT");
      return this.read(path, SCAN_LIMITS.sourceBytes, true);
    });
  }

  /** Parse inside the protected operation so format failures also invalidate the session. */
  async readEnvironment(path: string): Promise<string>;
  async readEnvironment<T>(path: string, parse: (content: string) => T): Promise<T>;
  async readEnvironment<T>(path: string, parse?: (content: string) => T): Promise<string | T> {
    return this.run(async () => {
      const content = await this.read(path, SCAN_LIMITS.environmentBytes, false);
      return parse ? parse(content) : content;
    });
  }

  private async read(path: string, limit: number, source: boolean): Promise<string> {
    const before = await this.validate(path, "file");
    const available = source ? Math.min(limit, SCAN_LIMITS.totalSourceBytes - this.sourceBytes) : limit;
    const checkSize = (stat: Stats): void => {
      if (!stat.isFile() || !sameFile(before.stat, stat)) throw new ScanError("READ_ERROR");
      if (stat.size > available) throw new ScanError("LIMIT_EXCEEDED");
    };
    checkSize(before.stat);
    // NOFOLLOW protects the final component; NONBLOCK prevents a replacement FIFO from hanging open.
    const handle = await open(before.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      checkSize(await handle.stat());
      const opened = await this.validate(path, "file");
      if (!sameFile(before.stat, opened.stat)) throw new ScanError("READ_ERROR");
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (true) {
        checkSize(await handle.stat());
        // A single overflow byte distinguishes EOF at the inclusive limit from a growing file.
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, available - bytes + 1));
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
        if (bytesRead > available - bytes) throw new ScanError("LIMIT_EXCEEDED");
        if (source) this.sourceBytes += bytesRead;
        bytes += bytesRead;
        if (bytesRead === 0) break;
        chunks.push(buffer.subarray(0, bytesRead));
      }
      checkSize(await handle.stat());
      const after = await this.validate(path, "file");
      if (!sameFile(before.stat, after.stat)) throw new ScanError("READ_ERROR");
      return Buffer.concat(chunks, bytes).toString("utf8");
    } finally {
      await handle.close();
    }
  }
}

/** List source paths relative to root using forward slashes, without reading file contents. */
export async function discover(root: string): Promise<string[]> {
  return (await ProjectFiles.open(root)).discover();
}
