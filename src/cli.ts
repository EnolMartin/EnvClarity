import { audit } from "./audit.ts";
import { parseCliArguments } from "./cli-args.ts";
import { formatJson } from "./reporters/json.ts";
import { formatText } from "./reporters/text.ts";

const help = `EnvClarity

Local environment variable auditor for TypeScript, Node and Vite projects.
Audits direct references without executing or modifying the project or printing values.

Usage: node dist/cli.js [--help | -h]
       node dist/cli.js check <root> --env <file> [--example <file>] [--format text|json]

Options:
  --env <file>      Required environment file; no implicit environment is loaded.
  --example <file>  Example file (default: .env.example).
  --format <name>   Output format: text or json (default: text).
  -h, --help        Show this help message (used alone).

Selected files must be inside <root>; relative file paths are resolved from <root>.
JSON audits write only the result to stdout, including safe operational failures.
`;

const args = parseCliArguments(process.argv.slice(2));

if (args.command === "help") {
  process.stdout.write(help);
} else if (args.command === "invalid") {
  process.stderr.write("Invalid arguments. Use --help for usage.\n");
  process.exitCode = 2;
} else {
  const result = await audit(args.root, args.environment, args.example);
  process.stdout.write(args.format === "json" ? `${formatJson(result)}\n` : formatText(result));
  // Provisional until the separate exit-code review: all completed audits return 0.
  process.exitCode = result.status === "failed" ? 2 : 0;
}
