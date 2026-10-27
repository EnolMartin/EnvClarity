import { parseArgs } from "node:util";

type CliArguments =
  | { command: "help" }
  | { command: "invalid" }
  | { command: "viewer" }
  | { command: "check"; root: string; environment: string; example: string; format: "text" | "json" };

/** Parse syntax only; the audit I/O layer owns path validation and safety budgets. */
export function parseCliArguments(args: string[]): CliArguments {
  if (args.length === 0 || (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))) {
    return { command: "help" };
  }
  if (args.length === 1 && args[0] === "viewer") return { command: "viewer" };
  if (args[0] !== "check") return { command: "invalid" };

  try {
    const { values, positionals, tokens } = parseArgs({
      args: args.slice(1),
      options: {
        env: { type: "string" },
        example: { type: "string" },
        format: { type: "string" },
      },
      strict: true,
      allowPositionals: true,
      tokens: true,
    });
    const seen = new Set<string>();
    for (const token of tokens) {
      if (token.kind !== "option") continue;
      if (seen.has(token.name)) return { command: "invalid" };
      seen.add(token.name);
    }
    const root = positionals[0];
    const example = values.example ?? ".env.example";
    const format = values.format ?? "text";
    if (positionals.length !== 1 || !root || !values.env || !example ||
      (format !== "text" && format !== "json")) {
      return { command: "invalid" };
    }
    return { command: "check", root, environment: values.env, example, format };
  } catch {
    // Native argument errors may contain sensitive argument values.
    return { command: "invalid" };
  }
}
