import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/core/analyze.ts";
import { compare } from "../src/core/compare.ts";
import { buildReport } from "../src/core/report.ts";
import type {
  AnalysisResult, AuditIssue, DynamicReference, ReferenceOrigin, VariableReference,
} from "../src/core/types.ts";

function reference(name = "TOKEN", path = "src/config.ts", line = 1, column = 1,
  origin: ReferenceOrigin = "process.env"): VariableReference {
  return { name, origin, location: { path, line, column } };
}

function missing(name: string, references: readonly VariableReference[] = []): AuditIssue {
  return { code: "MISSING_VARIABLE", severity: "error", name, references };
}

const emptyAnalysis: AnalysisResult = { references: [], dynamicReferences: [] };

test("builds an empty versioned report with explicit syntax limits even without dynamic accesses", () => {
  assert.deepEqual(buildReport(emptyAnalysis, []), {
    schemaVersion: 1,
    summary: { errorCount: 0, warningCount: 0 },
    issues: [],
    references: [],
    coverage: {
      scope: "direct-references",
      limitations: ["ALIASES_NOT_RESOLVED", "DESTRUCTURING_NOT_RESOLVED",
        "WRAPPERS_NOT_RESOLVED", "DYNAMIC_REFERENCES_NOT_RESOLVED"],
    },
  });
});

test("orders references by path, numeric location, origin and name without locale collation", () => {
  const expected = [
    reference("Z", "A.ts"), reference("Z", "a.ts"),
    reference("B", "z.ts", 2, 2, "import.meta.env"),
    reference("A", "z.ts", 2, 2), reference("Z", "z.ts", 2, 2),
    reference("A", "z.ts", 2, 10), reference("A", "z.ts", 10, 1),
    reference("A", "á.ts"),
  ];
  assert.deepEqual(buildReport({ references: expected.toReversed(), dynamicReferences: [] }, []).references,
    expected);
});

test("removes exact reference duplicates but retains different names, paths, positions and origins", () => {
  const references = [reference(), reference("OTHER"), reference("TOKEN", "other.ts"),
    reference("TOKEN", "src/config.ts", 2), reference("TOKEN", "src/config.ts", 1, 2),
    reference("TOKEN", "src/config.ts", 1, 1, "import.meta.env")];
  const baseline = buildReport({ references, dynamicReferences: [] }, [missing("TOKEN", references)]);
  const duplicated = buildReport({ references: [...references, ...structuredClone(references)], dynamicReferences: [] },
    [missing("TOKEN", [...references, ...structuredClone(references)])]);
  assert.deepEqual(duplicated, baseline);
  assert.equal(duplicated.references.length, 6);
  const issue = duplicated.issues[0]!;
  assert.notEqual(issue.code, "DYNAMIC_REFERENCE");
  if (issue.code !== "DYNAMIC_REFERENCE") assert.equal(issue.references.length, 6);
});

test("orders issues by their first sorted location, then code; unlocated issues sort last by code and name", () => {
  const first = reference("A", "a.ts");
  const later = reference("A", "z.ts");
  const dynamic: AuditIssue = {
    code: "DYNAMIC_REFERENCE", severity: "warning",
    reference: { origin: first.origin, location: first.location },
  };
  const empty: AuditIssue = { code: "EMPTY_VARIABLE", severity: "warning", name: "A", references: [first] };
  const unused: AuditIssue = { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "A", references: [] };
  const expected = [dynamic, empty, missing("A", [first, later]),
    missing("LATER", [reference("LATER", "a.ts", 2)]),
    missing("COLUMN", [reference("COLUMN", "a.ts", 2, 10)]),
    missing("LINE", [reference("LINE", "a.ts", 10)]), missing("Z", [later]),
    missing("A"), missing("B"), unused];
  const input = expected.toReversed().map(issue => issue.code === "MISSING_VARIABLE" && issue.name === "A"
    ? missing("A", issue.references.toReversed()) : issue);
  assert.deepEqual(buildReport(emptyAnalysis, input).issues, expected);
});

test("deduplicates normalized issues exactly, retaining different codes, names and reference sets", () => {
  const first = reference();
  const second = reference("TOKEN", "b.ts");
  const issues: AuditIssue[] = [missing("TOKEN", [first, second]),
    missing("TOKEN", [second, first, structuredClone(first)]),
    missing("TOKEN", [first]), missing("OTHER", [first]),
    { code: "EMPTY_VARIABLE", severity: "warning", name: "TOKEN", references: [first] },
    missing("UNUSED"), missing("UNUSED")];
  const report = buildReport(emptyAnalysis, issues);
  assert.equal(report.issues.length, 5);
  assert.deepEqual(report.summary, { errorCount: 4, warningCount: 1 });
  assert.deepEqual(buildReport(emptyAnalysis, issues.toReversed()), report);
});

test("adds dynamic warnings with only origin and location and deduplicates them across both inputs", () => {
  const dynamicReferences: DynamicReference[] = [
    reference("IGNORED"), reference("IGNORED", "src/config.ts", 1, 1, "import.meta.env"),
    reference("IGNORED", "src/config.ts", 2), reference("IGNORED", "src/config.ts", 1, 2),
    reference("IGNORED", "other.ts"),
  ];
  const report = buildReport({ references: [], dynamicReferences: [...dynamicReferences, ...dynamicReferences] }, [
    { code: "DYNAMIC_REFERENCE", severity: "warning", reference: dynamicReferences[0]! },
  ]);
  assert.equal(report.issues.length, 5);
  assert.deepEqual(report.summary, { errorCount: 0, warningCount: 5 });
  assert.deepEqual(report.references, []);
  for (const issue of report.issues) {
    assert.equal(issue.code, "DYNAMIC_REFERENCE");
    assert.deepEqual(Object.keys(issue), ["code", "severity", "reference"]);
    if (issue.code === "DYNAMIC_REFERENCE") {
      assert.deepEqual(Object.keys(issue.reference), ["origin", "location"]);
    }
  }
  assert.deepEqual(buildReport({ references: [], dynamicReferences: dynamicReferences.toReversed() }, []), report);
});

test("produces identical serialized reports for reordered analysis, issues and nested references", () => {
  const analysis = analyze({ path: "src/config.ts", content: [
    "process.env.USED;", "import.meta.env.USED;", "process.env.EMPTY;",
    "process.env.EXTRA;", "process.env[key];", "import.meta.env[key];",
  ].join("\n") });
  const input = { ...analysis, documentedNames: ["USED", "EMPTY", "UNUSED", "MISSING"],
    environment: [{ name: "USED", state: "present" }, { name: "EMPTY", state: "empty" },
      { name: "UNUSED", state: "present" }] as const };
  const baseline = buildReport(analysis, compare(input));
  assert.deepEqual(baseline.summary, { errorCount: 1, warningCount: 6 });
  assert.deepEqual(new Set(baseline.issues.map(issue => issue.code)), new Set([
    "UNDOCUMENTED_VARIABLE", "MISSING_VARIABLE", "EMPTY_VARIABLE", "POSSIBLY_UNUSED_VARIABLE", "DYNAMIC_REFERENCE",
  ]));
  for (let offset = 0; offset < input.references.length; offset++) {
    const reordered = { ...input,
      references: [...input.references.slice(offset), ...input.references.slice(0, offset)].toReversed(),
      dynamicReferences: input.dynamicReferences.toReversed(),
      documentedNames: input.documentedNames.toReversed(), environment: input.environment.toReversed(),
    };
    const issues = compare(reordered).toReversed().map(issue => issue.code === "DYNAMIC_REFERENCE"
      ? issue : { ...issue, references: issue.references.toReversed() });
    assert.equal(JSON.stringify(buildReport(reordered, issues)), JSON.stringify(baseline));
  }
});

test("counts final deduplicated issues, including multiple rules for one name", () => {
  const issues: AuditIssue[] = [missing("TOKEN"), missing("TOKEN"),
    { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "TOKEN", references: [] },
    { code: "EMPTY_VARIABLE", severity: "warning", name: "EMPTY", references: [] }];
  const dynamic = reference();
  const report = buildReport({ references: [], dynamicReferences: [dynamic, dynamic] }, issues);
  assert.deepEqual(report.summary, { errorCount: 1, warningCount: 3 });
  assert.equal(report.summary.errorCount + report.summary.warningCount, report.issues.length);
});

test("projects only allowed fields at every level, excluding values, source, raw errors and timestamps", () => {
  const extras = { value: "synthetic-private-value", content: "synthetic-source-content",
    error: new Error("synthetic-original-error"), timestamp: "synthetic-timestamp" };
  const ref = Object.assign(reference(), extras, { location: Object.assign(reference().location, extras) });
  const issue = Object.assign(missing("TOKEN", [ref]), extras);
  const analysis = Object.assign({ references: [ref], dynamicReferences: [ref] }, extras);
  const report = buildReport(analysis, [issue,
    Object.assign({ code: "DYNAMIC_REFERENCE" as const, severity: "warning" as const, reference: ref }, extras)]);
  assert.deepEqual(report, buildReport({ references: [reference()], dynamicReferences: [reference()] },
    [missing("TOKEN", [reference()])]));
  assert.doesNotMatch(JSON.stringify(report), /synthetic-/);
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("accepts deeply frozen inputs without mutations and returns detached results", () => {
  const ref = reference();
  const analysis = deepFreeze({ references: [ref, ref], dynamicReferences: [ref] });
  const issues = deepFreeze([missing("TOKEN", [ref, ref])]);
  const before = structuredClone({ analysis, issues });
  const report = buildReport(analysis, issues);
  assert.deepEqual({ analysis, issues }, before);
  assert.deepEqual(buildReport(analysis, issues), report);
  assert.notStrictEqual(report.references, analysis.references);
  assert.notStrictEqual(report.references[0], ref);
  assert.notStrictEqual(report.references[0]!.location, ref.location);
  for (const issue of report.issues) {
    const copied = issue.code === "DYNAMIC_REFERENCE" ? issue.reference : issue.references[0]!;
    assert.notStrictEqual(copied, ref);
    assert.notStrictEqual(copied.location, ref.location);
  }
});
