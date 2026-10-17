import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/core/analyze.ts";

function reference(name: string, line: number, column: number, path = "src/config.ts") {
  return { name, origin: "process.env", location: { path, line, column } };
}

function viteReference(name: string, line: number, column: number, path = "src/config.ts") {
  return { name, origin: "import.meta.env", location: { path, line, column } };
}

test("extracts dotted and quoted Node references with exact source locations", () => {
  const result = analyze({
    path: "src/config.ts",
    content: 'const port = process.env.PORT;\n  process.env["DATABASE_URL"];\nprocess.env[\'TOKEN\'];',
  });

  assert.deepEqual(result, {
    references: [reference("PORT", 1, 14), reference("DATABASE_URL", 2, 3), reference("TOKEN", 3, 1)],
    dynamicReferences: [],
  });
});

test("keeps repeated references in source order", () => {
  assert.deepEqual(analyze({ path: "src/config.ts", content: "process.env.PORT; process.env.PORT;" }).references,
    [reference("PORT", 1, 1), reference("PORT", 1, 19)]);
});

test("ignores comments, strings, regular expressions and template text", () => {
  const content = [
    "// process.env.COMMENT",
    "/* process.env.BLOCK */",
    '\'process.env.STRING\';',
    '"process.env.DOUBLE_STRING";',
    "`process.env.TEMPLATE`;",
    "/process.env.REGEX/;",
  ].join("\n");

  assert.deepEqual(analyze({ path: "src/config.ts", content }), { references: [], dynamicReferences: [] });
});

test("finds real expressions inside template interpolations and nested calls", () => {
  const content = '`text ${process.env.PORT}`;\nconsume(process.env.TOKEN.trim());';
  assert.deepEqual(analyze({ path: "src/config.ts", content }).references,
    [reference("PORT", 1, 9), reference("TOKEN", 2, 9)]);
});

test("does not mistake similar objects or bare environment objects for references", () => {
  const content = [
    "other.env.PORT;",
    "globalThis.process.env.PORT;",
    "process.environment.PORT;",
    "process.env;",
    "env.PORT;",
    "const { PORT } = process.env;",
  ].join("\n");

  assert.deepEqual(analyze({ path: "src/config.ts", content }).references, []);
});

test("retains normal Node names that happen to be Vite built-ins", () => {
  assert.deepEqual(analyze({ path: "src/config.ts", content: "process.env.MODE;" }).references,
    [reference("MODE", 1, 1)]);
});

test("handles CRLF, indentation and decoded string literal names", () => {
  const content = '\r\n\tprocess.env["API\\u005fKEY"];';
  assert.deepEqual(analyze({ path: "src/config.ts", content }).references,
    [reference("API_KEY", 2, 2)]);
});

test("parses JavaScript text without loading imports or executing statements", () => {
  const path = "src/config.js";
  const content = 'import "./does-not-exist.js";\nthrow new Error("must not execute");\nprocess.env.PORT;';
  assert.deepEqual(analyze({ path, content }).references, [reference("PORT", 3, 1, path)]);
});

test("returns an empty result for empty source text", () => {
  assert.deepEqual(analyze({ path: "src/config.ts", content: "" }), { references: [], dynamicReferences: [] });
});

for (const extension of ["ts", "tsx", "js", "jsx"]) {
  test(`extracts Node and Vite references from .${extension} with exact locations`, () => {
    const path = `src/config.${extension}`;
    const content = [
      "import.meta.env.VITE_API_URL;",
      '  import.meta.env["VITE_TOKEN"];',
      "import.meta.env['VITE_NAME'];",
      "process.env.PORT;",
      'process.env["HOST"];',
      'import.meta.env["VITE_API\\u005fURL"];',
    ].join("\n");

    assert.deepEqual(analyze({ path, content }), {
      references: [
        viteReference("VITE_API_URL", 1, 1, path),
        viteReference("VITE_TOKEN", 2, 3, path),
        viteReference("VITE_NAME", 3, 1, path),
        reference("PORT", 4, 1, path),
        reference("HOST", 5, 1, path),
        viteReference("VITE_API_URL", 6, 1, path),
      ],
      dynamicReferences: [],
    });
  });
}

test("excludes all five Vite built-ins only for import.meta.env", () => {
  const names = ["MODE", "BASE_URL", "DEV", "PROD", "SSR"];
  const content = names.map((name) => [
    `import.meta.env.${name};`,
    `import.meta.env["${name}"];`,
    `process.env.${name};`,
    `process.env["${name}"];`,
  ].join("\n")).join("\n");

  assert.deepEqual(analyze({ path: "src/config.ts", content }).references,
    names.flatMap((name, index) => [reference(name, index * 4 + 3, 1), reference(name, index * 4 + 4, 1)]));
});

test("retains custom Vite names without requiring a prefix or normalizing case", () => {
  const content = "import.meta.env.CUSTOM;\nimport.meta.env.mode;\nimport.meta.env.VITE_MODE;";
  assert.deepEqual(analyze({ path: "src/config.ts", content }).references,
    [viteReference("CUSTOM", 1, 1), viteReference("mode", 2, 1), viteReference("VITE_MODE", 3, 1)]);
});

test("ignores Vite text and similar objects while visiting real interpolations", () => {
  const content = [
    "// import.meta.env.COMMENT",
    "/* import.meta.env.BLOCK */",
    '\'import.meta.env.STRING\';',
    "`import.meta.env.TEMPLATE`;",
    "/import.meta.env.REGEX/;",
    "other.meta.env.OTHER;",
    "import.meta.environment.OTHER;",
    "import.meta.env;",
    "const { ALIAS } = import.meta.env;",
    '`text ${import.meta.env.VITE_REAL}`;',
    'consume(import.meta.env["VITE_REAL"].trim());',
  ].join("\n");

  assert.deepEqual(analyze({ path: "src/config.ts", content }).references,
    [viteReference("VITE_REAL", 10, 9), viteReference("VITE_REAL", 11, 9)]);
});

for (const extension of ["jsx", "tsx"]) {
  test(`finds expressions in .${extension} without treating JSX text or attributes as code`, () => {
    const path = `src/View.${extension}`;
    const content = [
      "const view = <section>",
      '  import.meta.env.TEXT process.env.TEXT <span title="import.meta.env.ATTRIBUTE process.env.ATTRIBUTE" />',
      '  <a href={import.meta.env["VITE_URL"]}>',
      "    {import.meta.env.VITE_LABEL}",
      "    {process.env.LABEL}",
      "    {/* import.meta.env.COMMENT process.env.COMMENT */}",
      "  </a>",
      "</section>;",
    ].join("\n");

    assert.deepEqual(analyze({ path, content }), {
      references: [viteReference("VITE_URL", 3, 12, path), viteReference("VITE_LABEL", 4, 6, path),
        reference("LABEL", 5, 6, path)],
      dynamicReferences: [],
    });
  });
}

test("parses TypeScript assertions in .ts rather than JSX elements", () => {
  const content = "const label = <string>import.meta.env.VITE_LABEL;\nprocess.env.PORT;";
  assert.deepEqual(analyze({ path: "src/config.ts", content }).references,
    [viteReference("VITE_LABEL", 1, 23), reference("PORT", 2, 1)]);
});
