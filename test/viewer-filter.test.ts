import assert from "node:assert/strict";
import { test } from "node:test";
import type { AuditIssue, VariableReference } from "../src/core/types.ts";
import { displayLabel, EMPTY_FILTERS, filterIssues } from "../viewer/src/report/filter.ts";

const reference: VariableReference = { name: "TOKEN", origin: "process.env", location: { path: "src/Config.ts", line: 2, column: 3 } };
const other: VariableReference = { ...reference, location: { ...reference.location, path: "server/Other.ts" } };
const issues: readonly AuditIssue[] = [
  { code: "MISSING_VARIABLE", severity: "error", name: "TOKEN", references: [reference, other] },
  { code: "EMPTY_VARIABLE", severity: "warning", name: "EMPTY", references: [other] },
  { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "OLD", references: [] },
  { code: "DYNAMIC_REFERENCE", severity: "warning", reference: { origin: "import.meta.env", location: reference.location } },
  { code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: "VITE_URL", references: [reference] },
];

test("finding filters preserve report order, original identities and indices without mutation", () => {
  const before = structuredClone(issues);
  const all = filterIssues(issues, EMPTY_FILTERS);
  assert.deepEqual(all.map(match => match.index), [0, 1, 2, 3, 4]);
  assert.equal(all[0]!.issue, issues[0]);
  assert.deepEqual(issues, before);
  assert.deepEqual(filterIssues([], EMPTY_FILTERS), []);
});

test("finding filters combine severity, code and case-insensitive name substring", () => {
  assert.deepEqual(filterIssues(issues, { severity: "warning", code: "EMPTY_VARIABLE", query: "mPt" }).map(match => match.index), [1]);
  assert.deepEqual(filterIssues(issues, { severity: "error", code: "EMPTY_VARIABLE", query: "" }), []);
  assert.deepEqual(filterIssues(issues, { ...EMPTY_FILTERS, query: "token" }).map(match => match.index), [0]);
  assert.deepEqual(filterIssues(issues, { ...EMPTY_FILTERS, query: "missing" }), []);
});

test("a path match includes all original locations and does not infer a dynamic name", () => {
  const matches = filterIssues(issues, { ...EMPTY_FILTERS, query: "CONFIG.TS" });
  assert.deepEqual(matches.map(match => match.index), [0, 3, 4]);
  assert.equal(matches[0]!.issue, issues[0]);
  assert.deepEqual(filterIssues(issues, { ...EMPTY_FILTERS, query: "server/other" }).map(match => match.index), [0, 1]);
  assert.deepEqual(filterIssues(issues, { ...EMPTY_FILTERS, query: "dynamic" }), []);
  assert.deepEqual(filterIssues(issues, { ...EMPTY_FILTERS, query: "old" }).map(match => match.index), [2]);
});

test("finding search uses literal substrings without regex, normalization or markup interpretation", () => {
  const issue: AuditIssue = { code: "EMPTY_VARIABLE", severity: "warning", name: "<script> [a.*] é A B", references: [] };
  for (const query of ["<SCRIPT>", "[a.*]", " A B"]) assert.equal(filterIssues([issue], { ...EMPTY_FILTERS, query }).length, 1);
  assert.equal(filterIssues([issue], { ...EMPTY_FILTERS, query: "e\u0301" }).length, 0);
  assert.equal(filterIssues([issue], { ...EMPTY_FILTERS, query: "^.*$" }).length, 0);
});

test("reset restores all findings and duplicate occurrences retain distinct indices", () => {
  const duplicated = [...issues, issues[0]!];
  assert.equal(filterIssues(duplicated, { ...EMPTY_FILTERS, severity: "error" }).length, 2);
  assert.deepEqual(filterIssues(duplicated, EMPTY_FILTERS).map(match => match.index), [0, 1, 2, 3, 4, 5]);
});

test("report labels expose invisible controls and bidi formatting without interpreting text", () => {
  assert.equal(displayLabel("a\n\t\u001b[31m\u202e\u2066\u200b\u2028.ts"), "a\\u{A}\\u{9}\\u{1B}[31m\\u{202E}\\u{2066}\\u{200B}\\u{2028}.ts");
  assert.equal(displayLabel("<script> & https://example.test/é😀.ts"), "<script> & https://example.test/é😀.ts");
  assert.equal(displayLabel(""), "");
});
