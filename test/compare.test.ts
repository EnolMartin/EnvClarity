import assert from "node:assert/strict";
import { test } from "node:test";
import { compare } from "../src/core/compare.ts";
import type { ComparisonInput, ReferenceOrigin, VariableReference } from "../src/core/types.ts";

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

test("reports missing documented names with no references and ignores extra configured names", () => {
  assert.deepEqual(compare({ references: [], dynamicReferences: [],
    documentedNames: ["NOT_LISTED", "EXPLICITLY_ABSENT", "PRESENT", "EMPTY"], environment: [
      { name: "EXPLICITLY_ABSENT", state: "absent" },
      { name: "PRESENT", state: "present" },
      { name: "EMPTY", state: "empty" },
      { name: "EXTRA", state: "present" },
    ] }), [
    { code: "MISSING_VARIABLE", severity: "error", name: "NOT_LISTED", references: [] },
    { code: "MISSING_VARIABLE", severity: "error", name: "EXPLICITLY_ABSENT", references: [] },
  ]);
});

test("treats empty as existing even for a documented name used in code", () => {
  assert.deepEqual(compare({ references: [reference("DATABASE_URL")], dynamicReferences: [],
    documentedNames: ["DATABASE_URL"], environment: [{ name: "DATABASE_URL", state: "empty" }] }), []);
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
  ] }), []);
  assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
});

test("does not normalize names or match case-insensitively", () => {
  const references = [reference("TOKEN")];
  assert.deepEqual(compare({ references, dynamicReferences: [], documentedNames: ["token"],
    environment: [{ name: "TOKEN", state: "present" }] }), [
    { code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: "TOKEN", references },
    { code: "MISSING_VARIABLE", severity: "error", name: "token", references: [] },
  ]);
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
    documentedNames: Object.freeze(["DATABASE_URL"]),
    environment: Object.freeze([Object.freeze({ name: "DATABASE_URL", state: "absent" as const })]),
  });
  const before = structuredClone(input);
  const first = compare(input);

  assert.deepEqual(first, [
    { code: "MISSING_VARIABLE", severity: "error", name: "DATABASE_URL", references: [ref] },
  ]);
  assert.deepEqual(compare(input), first);
  assert.deepEqual(input, before);
});
