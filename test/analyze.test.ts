import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/core/analyze.ts";

function reference(name: string, line: number, column: number, path = "src/config.ts") {
  return { name, origin: "process.env", location: { path, line, column } };
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
