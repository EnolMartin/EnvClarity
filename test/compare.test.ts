import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/core/analyze.ts";
import { compare } from "../src/core/compare.ts";
import type { ComparisonInput, ReferenceOrigin, VariableReference, VariableState } from "../src/core/types.ts";

function reference(name: string, path = "src/config.ts", line = 1,
  origin: ReferenceOrigin = "process.env"): VariableReference {
  return { name, origin, location: { path, line, column: 3 } };
}

test("resolves DATABASE_URL by documenting it and then configuring it", () => {
  const references = [reference("DATABASE_URL")];
  const input: ComparisonInput = {
    references, dynamicReferences: [], documentedNames: [], environment: [],
  };

  assert.deepEqual(compare(input), [
    { code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: "DATABASE_URL", references },
  ]);
  assert.deepEqual(compare({ ...input, documentedNames: ["DATABASE_URL"] }), [
    { code: "MISSING_VARIABLE", severity: "error", name: "DATABASE_URL", references },
  ]);
  assert.deepEqual(compare({ ...input, documentedNames: ["DATABASE_URL"],
    environment: [{ name: "DATABASE_URL", state: "present" }] }), []);
});

test("warns about undocumented usage even when configured, without inferring a requirement", () => {
  const names = ["ABSENT", "PRESENT", "EMPTY"];
  const references = names.map(name => reference(name));

  assert.deepEqual(compare({ references, dynamicReferences: [], documentedNames: [], environment: [
    { name: "ABSENT", state: "absent" },
    { name: "PRESENT", state: "present" },
    { name: "EMPTY", state: "empty" },
  ] }), names.map((name, index) => ({
    code: "UNDOCUMENTED_VARIABLE", severity: "warning", name, references: [references[index]],
  })));
});

for (const state of ["present", "empty", "absent", undefined] as const) {
  for (const used of [true, false]) {
    test(`compares a ${used ? "used" : "possibly unused"} documented name with state ${state ?? "omitted"}`, () => {
      const name = "DATABASE_URL";
      const references = used ? [reference(name), reference(name, "src/other.ts", 2)] : [];
      const issues = compare({ references, dynamicReferences: [], documentedNames: [name, name],
        environment: state === undefined ? [] : [{ name, state }],
      });
      const expected = [];
      if (state === "empty") {
        expected.push({ code: "EMPTY_VARIABLE", severity: "warning", name, references });
      } else if (state === "absent" || state === undefined) {
        expected.push({ code: "MISSING_VARIABLE", severity: "error", name, references });
      }
      if (!used) {
        expected.push({ code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name, references });
      }
      assert.deepEqual(issues, expected);
    });
  }
}

test("ignores extra configured names regardless of their state", () => {
  assert.deepEqual(compare({ references: [], dynamicReferences: [], documentedNames: [], environment: [
    { name: "EXTRA_PRESENT", state: "present" },
    { name: "EXTRA_EMPTY", state: "empty" },
    { name: "EXTRA_ABSENT", state: "absent" },
  ] }), []);
});

test("groups repeated uses across files and origins, retaining all reference locations", () => {
  const first = reference("DATABASE_URL", "src/server.ts", 5);
  const other = reference("OTHER", "src/server.ts", 6);
  const second = reference("DATABASE_URL", "src/client.tsx", 2, "import.meta.env");
  const third = reference("DATABASE_URL", "src/server.ts", 9);
  const references = [first, other, second, third];

  for (const documentedNames of [[], ["DATABASE_URL", "DATABASE_URL"]]) {
    const result = compare({ references, dynamicReferences: [], documentedNames, environment: [] });
    assert.deepEqual(result.filter(issue => issue.code !== "DYNAMIC_REFERENCE" && issue.name === "DATABASE_URL"), [
      { code: documentedNames.length === 0 ? "UNDOCUMENTED_VARIABLE" : "MISSING_VARIABLE",
        severity: documentedNames.length === 0 ? "warning" : "error", name: "DATABASE_URL",
        references: [first, second, third] },
    ]);
    assert.deepEqual(result.filter(issue => issue.code !== "DYNAMIC_REFERENCE" && issue.name === "OTHER"), [
      { code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: "OTHER", references: [other] },
    ]);
  }
});

test("compares special names literally without modifying prototypes", () => {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const names = ["__proto__", "constructor", "toString", "hasOwnProperty"];
  const references = names.map(name => reference(name));
  const input: ComparisonInput = {
    references, dynamicReferences: [], documentedNames: [], environment: [],
  };

  assert.deepEqual(compare(input), names.map((name, index) => ({
    code: "UNDOCUMENTED_VARIABLE", severity: "warning", name, references: [references[index]],
  })));
  assert.deepEqual(compare({ ...input, documentedNames: names }), names.map((name, index) => ({
    code: "MISSING_VARIABLE", severity: "error", name, references: [references[index]],
  })));
  assert.deepEqual(compare({ ...input, documentedNames: names, environment: [
    { name: "__proto__", state: "empty" },
    { name: "constructor", state: "present" },
    { name: "toString", state: "empty" },
    { name: "hasOwnProperty", state: "present" },
  ] }), ["__proto__", "toString"].map(name => ({
    code: "EMPTY_VARIABLE", severity: "warning", name,
    references: references.filter(ref => ref.name === name),
  })));
  for (const state of ["present", "empty", "absent"] as const) {
    assert.deepEqual(compare({ references: [], dynamicReferences: [], documentedNames: [...names, ...names],
      environment: names.map(name => ({ name, state })),
    }), names.flatMap(name => [
      ...(state === "present" ? [] : [{
        code: state === "empty" ? "EMPTY_VARIABLE" : "MISSING_VARIABLE",
        severity: state === "empty" ? "warning" : "error", name, references: [],
      }]),
      { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name, references: [] },
    ]));
  }
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});

test("does not normalize names or match case-insensitively", () => {
  const references = [reference("TOKEN")];
  assert.deepEqual(compare({ references, dynamicReferences: [], documentedNames: ["token"],
    environment: [{ name: "TOKEN", state: "present" }] }), [
    { code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: "TOKEN", references },
    { code: "MISSING_VARIABLE", severity: "error", name: "token", references: [] },
    { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "token", references: [] },
  ]);
});

test("keeps the last environment state for repeated names", () => {
  for (const state of ["present", "empty", "absent"] as const) {
    const priorStates: VariableState[] = ["present", "empty", "absent"];
    assert.deepEqual(compare({ references: [reference("TOKEN")], dynamicReferences: [],
      documentedNames: ["TOKEN", "TOKEN"],
      environment: [...priorStates, state].map(state => ({ name: "TOKEN", state })),
    }), state === "present" ? [] : [{
      code: state === "empty" ? "EMPTY_VARIABLE" : "MISSING_VARIABLE",
      severity: state === "empty" ? "warning" : "error", name: "TOKEN", references: [reference("TOKEN")],
    }]);
  }
});

test("dynamic accesses neither invent literal names nor prove that documented names are unused", () => {
  const analysis = analyze({ path: "src/config.ts", content: [
    'const key = "TOKEN";',
    "process.env[key];",
    "import.meta.env[key];",
    'process.env["PRE" + "FIX"];',
    "import.meta.env[`TEMPLATE`];",
    "process.env.USED;",
  ].join("\n") });
  assert.deepEqual(analysis.references.map(ref => ref.name), ["USED"]);
  assert.equal(analysis.dynamicReferences.length, 4);
  const input: ComparisonInput = { ...analysis, documentedNames: ["TOKEN", "key", "USED"], environment: [
    { name: "TOKEN", state: "empty" },
    { name: "key", state: "present" },
    { name: "USED", state: "present" },
  ] };
  assert.deepEqual(compare(input), [
    { code: "EMPTY_VARIABLE", severity: "warning", name: "TOKEN", references: [] },
    { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "TOKEN", references: [] },
    { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "key", references: [] },
  ]);
  assert.deepEqual(compare(input), compare({ ...input, dynamicReferences: [] }));
});

test("returns no issues for empty input and leaves dynamic references for a later step", () => {
  const input: ComparisonInput = { references: [], dynamicReferences: [], documentedNames: [], environment: [] };
  assert.deepEqual(compare(input), []);
  assert.deepEqual(compare({ ...input, dynamicReferences: [
    { origin: "process.env", location: { path: "src/config.ts", line: 1, column: 1 } },
  ] }), []);
});

test("accepts frozen inputs and returns repeatable results without modifying them", () => {
  const ref = reference("DATABASE_URL");
  Object.freeze(ref.location);
  Object.freeze(ref);
  const input: ComparisonInput = Object.freeze({
    references: Object.freeze([ref]), dynamicReferences: Object.freeze([]),
    documentedNames: Object.freeze(["DATABASE_URL", "EMPTY", "UNUSED"]),
    environment: Object.freeze([
      Object.freeze({ name: "DATABASE_URL", state: "absent" as const }),
      Object.freeze({ name: "EMPTY", state: "empty" as const }),
      Object.freeze({ name: "UNUSED", state: "present" as const }),
    ]),
  });
  const before = structuredClone(input);
  const first = compare(input);

  assert.deepEqual(first, [
    { code: "MISSING_VARIABLE", severity: "error", name: "DATABASE_URL", references: [ref] },
    { code: "EMPTY_VARIABLE", severity: "warning", name: "EMPTY", references: [] },
    { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "EMPTY", references: [] },
    { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "UNUSED", references: [] },
  ]);
  assert.deepEqual(compare(input), first);
  assert.deepEqual(input, before);
});
