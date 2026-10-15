import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const expectedHelp = `EnvClarity

Local environment variable auditor for TypeScript, Node and Vite projects.
Auditing is not implemented yet. This entry point only displays help.

Usage: node dist/cli.js [--help | -h]

Options:
  -h, --help  Show this help message.
`;

function runCli(args: string[]) {
  // Only the entry point may be read; audited projects need no access.
  const result = spawnSync(
    process.execPath,
    ["--permission", `--allow-fs-read=${cliPath}`, cliPath, ...args],
    { encoding: "utf8", timeout: 5_000 },
  );

  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

for (const args of [[], ["--help"], ["-h"]]) {
  test(`displays help for ${JSON.stringify(args)}`, () => {
    const result = runCli(args);

    assert.equal(result.status, 0);
    assert.equal(result.stdout, expectedHelp);
    assert.equal(result.stderr, "");
  });
}

const unsupportedArgs = [
  ["check"],
  ["--unknown"],
  ["--help", "extra"],
  ["-h", "extra"],
  ["--help", "-h"],
  ["--token=ENVCLARITY_SYNTHETIC_SECRET"],
];

for (const args of unsupportedArgs) {
  test(`rejects unsupported arguments ${JSON.stringify(args)}`, () => {
    const result = runCli(args);

    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "Unsupported arguments. Use --help for usage.\n");
  });
}
