import assert from "node:assert/strict";
import { test } from "node:test";
import { analyze } from "../src/core/analyze.ts";
import { buildReport } from "../src/core/report.ts";
import type { AuditIssue, AuditResult, VariableReference } from "../src/core/types.ts";
import { REPORT_LIMITS, validateReportJson } from "../viewer/src/report/validate.ts";

const reference: VariableReference = {
  name: "TOKEN", origin: "process.env", location: { path: "src/config.ts", line: 1, column: 2 },
};

function fixture() {
  return { status: "completed", report: buildReport({ references: [reference], dynamicReferences: [] }, []) };
}

function parse(value: unknown) {
  return validateReportJson(JSON.stringify(value));
}

function invalid(value: unknown, error = "INVALID_REPORT") {
  assert.deepEqual(parse(value), { valid: false, error });
}

test("viewer validates a generated CLI contract with all issue codes and both origins", () => {
  const analysis = analyze({ path: "src/config.ts", content:
    "process.env.TOKEN; import.meta.env.VITE_URL; process.env[key];" });
  const issues: AuditIssue[] = [
    { code: "MISSING_VARIABLE", severity: "error", name: "TOKEN", references: analysis.references },
    { code: "EMPTY_VARIABLE", severity: "warning", name: "TOKEN", references: [] },
    { code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: "VITE_URL", references: [] },
    { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "OLD", references: [] },
  ];
  const result: AuditResult = { status: "completed", report: buildReport(analysis, issues) };
  assert.deepEqual(parse(result), { valid: true, result });
  assert.equal(result.report.issues.length, 5);
});

test("viewer accepts empty completed reports and all operational failures separately", () => {
  const result = { status: "completed", report: buildReport({ references: [], dynamicReferences: [] }, []) };
  assert.deepEqual(parse(result), { valid: true, result });
  for (const code of ["INVALID_INPUT", "READ_ERROR", "FORMAT_ERROR", "LIMIT_EXCEEDED"]) {
    assert.deepEqual(parse({ status: "failed", code }), { valid: true, result: { status: "failed", code } });
  }
  invalid({ status: "failed", code: "UNKNOWN" });
  invalid({ status: "failed", code: "READ_ERROR", report: result.report });
});

test("viewer rejects malformed JSON without returning input or parser exceptions", () => {
  for (const input of ["", "{", "{secret-value", "{} trailing", "NaN"]) {
    assert.deepEqual(validateReportJson(input), { valid: false, error: "INVALID_JSON" });
  }
});

test("viewer rejects bare reports, primitives and incomplete envelopes", () => {
  for (const value of [null, true, 1, "text", [], {}, fixture().report,
    { status: "completed" }, { status: "unknown", report: fixture().report }]) invalid(value);
});

test("viewer distinguishes unsupported numeric versions from invalid schema values", () => {
  for (const version of [2, 99]) {
    const value = fixture();
    invalid({ ...value, report: { ...value.report, schemaVersion: version, futureField: {} } }, "UNSUPPORTED_SCHEMA");
  }
  for (const version of [0, -1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
    const value = fixture();
    invalid({ ...value, report: { ...value.report, schemaVersion: version } });
  }
});

test("viewer rejects extra fields at every contract level, including prototype-like keys", () => {
  const value = fixture();
  const issue = { code: "MISSING_VARIABLE", severity: "error", name: "TOKEN", references: [reference] };
  const withIssue = { ...value, report: { ...value.report, issues: [issue], summary: { errorCount: 1, warningCount: 0 } } };
  const targets = [
    value, value.report, value.report.summary, value.report.coverage,
    value.report.references[0]!, value.report.references[0]!.location,
  ];
  for (const target of targets) {
    Object.defineProperty(target, "secret", { value: "CANARY_VALUE", configurable: true, enumerable: true });
    invalid(value);
    Reflect.deleteProperty(target, "secret");
  }
  invalid({ ...withIssue, report: { ...withIssue.report, issues: [{ ...issue, secret: "CANARY_VALUE" }] } });
  const raw = JSON.stringify(fixture()).replace('"status":', '"__proto__":{"secret":"CANARY_VALUE"},"status":');
  assert.deepEqual(validateReportJson(raw), { valid: false, error: "INVALID_REPORT" });
});

test("viewer rejects invalid locations and origins", () => {
  for (const patch of [{ line: 0 }, { column: -1 }, { line: 1.5 }, { column: "2" },
    { line: Number.MAX_SAFE_INTEGER + 1 }, { path: "" }, { path: null }, { extra: true }]) {
    const value = fixture();
    invalid({ ...value, report: { ...value.report, references: [{ ...reference, location: { ...reference.location, ...patch } }] } });
  }
  const value = fixture();
  invalid({ ...value, report: { ...value.report, references: [{ ...reference, origin: "custom.env" }] } });
});

test("viewer enforces issue discriminants and does not infer dynamic names", () => {
  const value = fixture();
  const dynamic = { code: "DYNAMIC_REFERENCE", severity: "warning", reference: {
    origin: "process.env", location: reference.location,
  } };
  const report = { ...value.report, summary: { errorCount: 0, warningCount: 1 } };
  for (const issue of [
    { code: "MISSING_VARIABLE", severity: "warning", name: "TOKEN", references: [] },
    { code: "EMPTY_VARIABLE", severity: "error", name: "TOKEN", references: [] },
    { code: "UNKNOWN", severity: "warning", name: "TOKEN", references: [] },
    { code: "EMPTY_VARIABLE", severity: "warning", name: "", references: [] },
    { ...dynamic, name: "INFERRED" }, { ...dynamic, severity: "error" },
    { ...dynamic, reference: { ...dynamic.reference, name: "INFERRED" } },
  ]) invalid({ ...value, report: { ...report, issues: [issue] } });
});

test("viewer checks summary counts against issues and validates integers", () => {
  const value = fixture();
  for (const summary of [{ errorCount: 1, warningCount: 0 }, { errorCount: 0, warningCount: -1 },
    { errorCount: 0.5, warningCount: 0 }, { errorCount: "0", warningCount: 0 },
    { errorCount: 0, warningCount: null }]) invalid({ ...value, report: { ...value.report, summary } });
});

test("viewer requires the complete known coverage without duplicates or invented limits", () => {
  const value = fixture();
  for (const coverage of [{ scope: "all", limitations: value.report.coverage.limitations },
    { scope: "direct-references", limitations: [] },
    { scope: "direct-references", limitations: Array(4).fill("ALIASES_NOT_RESOLVED") },
    { scope: "direct-references", limitations: ["UNKNOWN", ...value.report.coverage.limitations.slice(1)] }]) {
    invalid({ ...value, report: { ...value.report, coverage } });
  }
});

test("viewer bounds names and paths without interpreting HTML, URLs or control characters", () => {
  const value = fixture();
  const name = "N".repeat(REPORT_LIMITS.nameLength);
  const path = "p".repeat(REPORT_LIMITS.pathLength);
  const make = (name: string, path: string) => ({ ...value, report: { ...value.report,
    references: [{ ...reference, name, location: { ...reference.location, path } }] } });
  assert.equal(parse(make(name, path)).valid, true);
  invalid(make(name + "N", path), "LIMIT_EXCEEDED");
  invalid(make(name, path + "p"), "LIMIT_EXCEEDED");
  const hostile = make("<script>CANARY</script>\u001b[31m", "https://example.test/\u202e.ts");
  assert.deepEqual(parse(hostile), { valid: true, result: hostile });
});

test("viewer accepts the issue limit and rejects one more without truncating", () => {
  const value = fixture();
  const issue = { code: "EMPTY_VARIABLE", severity: "warning", name: "TOKEN", references: [] };
  const make = (count: number) => ({ ...value, report: { ...value.report,
    issues: Array(count).fill(issue), summary: { errorCount: 0, warningCount: count } } });
  const result = parse(make(REPORT_LIMITS.issues));
  assert.equal(result.valid, true);
  if (result.valid && result.result.status === "completed") assert.equal(result.result.report.issues.length, REPORT_LIMITS.issues);
  invalid(make(REPORT_LIMITS.issues + 1), "LIMIT_EXCEEDED");
});

test("viewer shares the reference/location budget across lists and counts duplicates", () => {
  const value = fixture();
  const references = Array(REPORT_LIMITS.referenceObjects / 2).fill(reference);
  const report = { ...value.report, references };
  assert.equal(parse({ ...value, report }).valid, true);
  invalid({ ...value, report: { ...report, references: [...references, reference] } }, "LIMIT_EXCEEDED");
  const issue = { code: "DYNAMIC_REFERENCE", severity: "warning", reference: {
    origin: "process.env", location: reference.location,
  } };
  invalid({ ...value, report: { ...report, issues: [issue], summary: { errorCount: 0, warningCount: 1 } } }, "LIMIT_EXCEEDED");
  const named = { code: "EMPTY_VARIABLE", severity: "warning", name: "TOKEN", references: [reference] };
  invalid({ ...value, report: { ...report, issues: [named], summary: { errorCount: 0, warningCount: 1 } } }, "LIMIT_EXCEEDED");
});

test("viewer checks UTF-8 bytes before parsing, including multi-byte text", () => {
  const json = JSON.stringify(fixture());
  const exact = json + " ".repeat(REPORT_LIMITS.bytes - new TextEncoder().encode(json).length);
  assert.equal(validateReportJson(exact).valid, true);
  assert.deepEqual(validateReportJson(exact + " "), { valid: false, error: "LIMIT_EXCEEDED" });
  assert.deepEqual(validateReportJson("é".repeat(REPORT_LIMITS.bytes / 2 + 1)), { valid: false, error: "LIMIT_EXCEEDED" });
});

test("viewer returns detached objects and preserves report order without deduplication", () => {
  const value = fixture();
  const second = { ...reference, name: "SECOND" };
  const input = { ...value, report: { ...value.report, references: [second, reference, reference] } };
  const result = parse(input);
  assert.deepEqual(result, { valid: true, result: input });
  if (!result.valid || result.result.status !== "completed") assert.fail("Expected report");
  assert.notEqual(result.result.report, input.report);
  assert.notEqual(result.result.report.references[0], second);
});


test("viewer rejects non-array lists and malformed nested objects", () => {
  const value = fixture();
  for (const patch of [{ issues: {} }, { references: null }, { summary: [] }, { coverage: null },
    { issues: [null] }, { references: [null] }, { references: [{ ...reference, location: [] }] }]) {
    invalid({ ...value, report: { ...value.report, ...patch } });
  }
  invalid({ ...value, report: { ...value.report, coverage: { scope: "direct-references", limitations: {} } } });
});
