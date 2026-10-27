#!/usr/bin/env node
import { audit } from "./audit.ts";
import { parseCliArguments } from "./cli-args.ts";
import { formatJson } from "./reporters/json.ts";
import { formatText } from "./reporters/text.ts";

const help = `EnvClarity

Local environment variable auditor for TypeScript, Node and Vite projects.
Audits direct references without executing or modifying the project or printing values.

Usage: envclarity [--help | -h]
       envclarity viewer
       envclarity check <root> --env <file> [--example <file>] [--format text|json]

Options:
  --env <file>      Required environment file; no implicit environment is loaded.
  --example <file>  Example file (default: .env.example).
  --format <name>   Output format: text or json (default: text).
  -h, --help        Show this help message (used alone).

viewer starts a local report viewer. Open the printed URL; stop with Ctrl+C.

Selected files must be inside <root>; relative file paths are resolved from <root>.

Exit codes:
  0  Audit completed without error-severity issues (warnings are allowed), or help.
  1  Audit completed with at least one error-severity issue; the full report is printed.
  2  Invalid arguments or an operational failure (input, reading, format or limits).

Output channels:
  Help: stdout; stderr is empty.
  Invalid syntax: stdout is empty; stderr contains a fixed usage diagnostic.
  Audits in text or JSON: stdout contains the result; stderr is empty.
  Operational failures use the selected format, with a safe code and no partial report.
  JSON audits write one JSON object and a newline, including operational failures.
Diagnostics never echo arguments, environment values or original errors.
`;

const args = parseCliArguments(process.argv.slice(2));

if (args.command === "help") {
  process.stdout.write(help);
} else if (args.command === "invalid") {
  process.stderr.write("Invalid arguments. Use --help for usage.\n");
  process.exitCode = 2;
} else if (args.command === "viewer") {
  try {
    const { startViewer } = await import("./viewer-server.ts");
    const server = await startViewer();
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Viewer unavailable");
    process.stdout.write(`Open http://127.0.0.1:${address.port}/ in your browser.\nStop the viewer with Ctrl+C.\n`);
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      server.close();
      server.closeAllConnections();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch {
    process.stderr.write("Could not start the local viewer. Reinstall the package or rebuild the viewer.\n");
    process.exitCode = 2;
  }
} else {
  const result = await audit(args.root, args.environment, args.example);
  process.stdout.write(args.format === "json" ? `${formatJson(result)}\n` : formatText(result));
  process.exitCode = result.status === "failed" ? 2 : result.report.summary.errorCount > 0 ? 1 : 0;
}
