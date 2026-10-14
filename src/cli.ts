const help = `EnvClarity

Local environment variable auditor for TypeScript, Node and Vite projects.
Auditing is not implemented yet. This entry point only displays help.

Usage: node dist/cli.js [--help | -h]

Options:
  -h, --help  Show this help message.
`;

const args = process.argv.slice(2);

if (args.length === 0 || (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))) {
  process.stdout.write(help);
} else {
  process.stderr.write("Unsupported arguments. Use --help for usage.\n");
  process.exitCode = 2;
}
