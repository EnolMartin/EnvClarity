// Invented data only; environment files are materialized under the OS temporary directory.
export const canaries = {
  example: "ENVCLARITY_E2E_EXAMPLE_DECOY",
  selected: "ENVCLARITY_E2E_SELECTED_DECOY",
  implicit: "ENVCLARITY_E2E_IMPLICIT_DECOY",
  source: "ENVCLARITY_E2E_SOURCE_DECOY",
  command: "ENVCLARITY_E2E_COMMAND_DECOY",
} as const;

export const sourceFiles: Record<string, string> = {
  "src/server.js": "process.env.NODE_URL;\n",
  "src/server.ts": [
    "process.env.NODE_URL;",
    'process.env["NODE_URL"];',
    "process.env.NEW_VALUE;",
    "process.env[serverKey];",
    'import "../execute.js";',
  ].join("\n"),
  "src/widget.jsx": [
    "export const widget = (",
    "  <span>",
    '    {import.meta.env["VITE_TITLE"]}',
    "  </span>",
    ");",
  ].join("\n"),
  "src/widget.tsx": [
    "export const view = (",
    "  <div>",
    "    {import.meta.env.VITE_TITLE}",
    "    {process.env.NEW_VALUE}",
    "    {import.meta.env[clientKey]}",
    "    {import.meta.env.MODE}",
    "  </div>",
    ");",
  ].join("\n"),
  "package.json": JSON.stringify({ type: "module", scripts: {
    preinstall: "node execute.js", build: "node execute.js", start: "node execute.js",
  } }),
  "execute.js": [
    'import { writeFileSync } from "node:fs";',
    'writeFileSync(new URL("executed-marker", import.meta.url), "executed");',
    `throw new Error("${canaries.source}");`,
  ].join("\n"),
  "vite.config.ts": `import "./execute.js";\nthrow new Error("${canaries.source}");`,
  ".env": `NODE_URL=${canaries.implicit}\nNEW_VALUE=${canaries.implicit}\nVITE_TITLE=${canaries.implicit}`,
  ".env.local": `NODE_URL=${canaries.implicit}\nNEW_VALUE=${canaries.implicit}`,
};

const command = `COMMAND=$(touch ${canaries.command})`;
const initialEnvironment = `VITE_TITLE=\nUNUSED=${canaries.selected}\n${command}`;
const correctedExample = `NODE_URL=${canaries.example}\nVITE_TITLE=\nNEW_VALUE=`;

export const stages = [
  {
    name: "initial configuration",
    example: `NODE_URL=${canaries.example}\nVITE_TITLE=\nUNUSED=`,
    environment: initialEnvironment,
    exitCode: 1,
  },
  {
    name: "corrected documentation",
    example: correctedExample,
    environment: initialEnvironment,
    exitCode: 1,
  },
  {
    name: "corrected explicit environment",
    example: correctedExample,
    environment: `NODE_URL=${canaries.selected}\nVITE_TITLE=${canaries.selected}\nNEW_VALUE=${canaries.selected}\n${command}`,
    exitCode: 0,
  },
] as const;
