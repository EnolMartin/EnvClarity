import type {
  AuditFailureCode, AuditIssue, AuditResult, CoverageLimitation,
  DynamicReference, SourceLocation, VariableReference,
} from "../../../src/core/types.js";

export const REPORT_LIMITS = {
  bytes: 10 * 1024 * 1024,
  issues: 20_000,
  referenceObjects: 100_000,
  nameLength: 1_024,
  pathLength: 4_096,
} as const;

export type ReportValidationError =
  | "INVALID_JSON" | "INVALID_REPORT" | "UNSUPPORTED_SCHEMA" | "LIMIT_EXCEEDED";

export type ReportValidationResult =
  | { readonly valid: true; readonly result: AuditResult }
  | { readonly valid: false; readonly error: ReportValidationError };

class InvalidReport extends Error {
  readonly code: ReportValidationError;

  constructor(code: ReportValidationError = "INVALID_REPORT") {
    super(code);
    this.code = code;
  }
}

function recordObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidReport();
  }
  return value as Record<string, unknown>;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const result = recordObject(value);
  const actual = Object.keys(result);
  if (actual.length !== keys.length || keys.some(key => !Object.hasOwn(result, key))) {
    throw new InvalidReport();
  }
  return result;
}

function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value)) throw new InvalidReport();
  if (value.length > maximum) throw new InvalidReport("LIMIT_EXCEEDED");
  return value;
}

function text(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0) throw new InvalidReport();
  if (value.length > maximum) throw new InvalidReport("LIMIT_EXCEEDED");
  return value;
}

function integer(value: unknown, minimum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new InvalidReport();
  }
  return value;
}

function failureCode(value: unknown): AuditFailureCode {
  switch (value) {
    case "INVALID_INPUT": case "READ_ERROR": case "FORMAT_ERROR": case "LIMIT_EXCEEDED":
      return value;
    default: throw new InvalidReport();
  }
}

function limitation(value: unknown): CoverageLimitation {
  switch (value) {
    case "ALIASES_NOT_RESOLVED": case "DESTRUCTURING_NOT_RESOLVED":
    case "WRAPPERS_NOT_RESOLVED": case "DYNAMIC_REFERENCES_NOT_RESOLVED":
      return value;
    default: throw new InvalidReport();
  }
}

/** Parse bounded JSON and return only validated contract fields, never raw input or errors. */
export function validateReportJson(json: string): ReportValidationResult {
  // Reject oversized text before parsing; the file picker must also check File.size before reading.
  if (json.length > REPORT_LIMITS.bytes || new TextEncoder().encode(json).length > REPORT_LIMITS.bytes) {
    return { valid: false, error: "LIMIT_EXCEEDED" };
  }
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return { valid: false, error: "INVALID_JSON" };
  }

  try {
    let referenceObjects = 0;
    function consumeObjects(): void {
      // Each reference and its nested location are two objects, including repeated occurrences.
      referenceObjects += 2;
      if (referenceObjects > REPORT_LIMITS.referenceObjects) {
        throw new InvalidReport("LIMIT_EXCEEDED");
      }
    }

    function location(value: unknown): SourceLocation {
      const object = record(value, ["path", "line", "column"]);
      return {
        path: text(object.path, REPORT_LIMITS.pathLength),
        line: integer(object.line, 1),
        column: integer(object.column, 1),
      };
    }

    function reference(value: unknown, named: true): VariableReference;
    function reference(value: unknown, named: false): DynamicReference;
    function reference(value: unknown, named: boolean): VariableReference | DynamicReference {
      consumeObjects();
      const object = record(value, named ? ["name", "origin", "location"] : ["origin", "location"]);
      const origin = object.origin;
      if (origin !== "process.env" && origin !== "import.meta.env") throw new InvalidReport();
      const base: DynamicReference = { origin, location: location(object.location) };
      return named ? { ...base, name: text(object.name, REPORT_LIMITS.nameLength) } : base;
    }

    function references(value: unknown): VariableReference[] {
      return list(value, REPORT_LIMITS.referenceObjects / 2).map(item => reference(item, true));
    }

    function issue(value: unknown): AuditIssue {
      const candidate = recordObject(value);
      if (candidate.code === "DYNAMIC_REFERENCE") {
        const object = record(value, ["code", "severity", "reference"]);
        if (object.severity !== "warning") throw new InvalidReport();
        return { code: "DYNAMIC_REFERENCE", severity: "warning", reference: reference(object.reference, false) };
      }
      const object = record(value, ["code", "severity", "name", "references"]);
      const name = text(object.name, REPORT_LIMITS.nameLength);
      const items = references(object.references);
      switch (object.code) {
        case "MISSING_VARIABLE":
          if (object.severity !== "error") throw new InvalidReport();
          return { code: object.code, severity: "error", name, references: items };
        case "UNDOCUMENTED_VARIABLE": case "EMPTY_VARIABLE": case "POSSIBLY_UNUSED_VARIABLE":
          if (object.severity !== "warning") throw new InvalidReport();
          return { code: object.code, severity: "warning", name, references: items };
        default: throw new InvalidReport();
      }
    }

    if (recordObject(input).status === "failed") {
      const object = record(input, ["status", "code"]);
      return { valid: true, result: { status: "failed", code: failureCode(object.code) } };
    }
    const envelope = record(input, ["status", "report"]);
    if (envelope.status !== "completed") throw new InvalidReport();
    const candidate = recordObject(envelope.report);
    if (candidate.schemaVersion !== 1) {
      integer(candidate.schemaVersion, 1);
      throw new InvalidReport("UNSUPPORTED_SCHEMA");
    }
    const report = record(candidate, ["schemaVersion", "summary", "issues", "references", "coverage"]);
    const summary = record(report.summary, ["errorCount", "warningCount"]);
    const errorCount = integer(summary.errorCount, 0);
    const warningCount = integer(summary.warningCount, 0);
    const issues = list(report.issues, REPORT_LIMITS.issues).map(issue);
    if (issues.filter(item => item.severity === "error").length !== errorCount ||
        issues.filter(item => item.severity === "warning").length !== warningCount) {
      throw new InvalidReport();
    }
    const items = references(report.references);
    const coverage = record(report.coverage, ["scope", "limitations"]);
    if (coverage.scope !== "direct-references") throw new InvalidReport();
    const limitations = list(coverage.limitations, 4).map(limitation);
    if (limitations.length !== 4 || new Set(limitations).size !== 4) throw new InvalidReport();
    return {
      valid: true,
      result: {
        status: "completed",
        report: { schemaVersion: 1, summary: { errorCount, warningCount }, issues, references: items,
          coverage: { scope: "direct-references", limitations } },
      },
    };
  } catch (error) {
    return { valid: false, error: error instanceof InvalidReport ? error.code : "INVALID_REPORT" };
  }
}
