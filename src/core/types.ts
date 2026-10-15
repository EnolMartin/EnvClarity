export type ReferenceOrigin = "process.env" | "import.meta.env";

export interface SourceLocation {
  /** Path relative to the audited project root. */
  readonly path: string;
  /** One-based line and column. */
  readonly line: number;
  readonly column: number;
}

export interface VariableReference {
  readonly name: string;
  readonly origin: ReferenceOrigin;
  readonly location: SourceLocation;
}

/** An unresolved access has a location, but no inferred name or source text. */
export interface DynamicReference {
  readonly origin: ReferenceOrigin;
  readonly location: SourceLocation;
}

export interface AnalysisInput {
  /** Relative source path; contents stay outside the report. */
  readonly path: string;
  readonly content: string;
}

export interface AnalysisResult {
  readonly references: readonly VariableReference[];
  readonly dynamicReferences: readonly DynamicReference[];
}

/** Values are reduced to these states before entering the core model. */
export type VariableState = "absent" | "present" | "empty";

export interface EnvironmentVariable {
  readonly name: string;
  readonly state: VariableState;
}

export interface ComparisonInput extends AnalysisResult {
  /** Names declared in .env.example; declaration does not imply required usage. */
  readonly documentedNames: readonly string[];
  /** States from the explicitly selected environment file only. */
  readonly environment: readonly EnvironmentVariable[];
}

/** Each code has exactly one severity; mismatched pairs are not valid issues. */
export interface IssueSeverityByCode {
  readonly UNDOCUMENTED_VARIABLE: "warning";
  readonly MISSING_VARIABLE: "error";
  readonly EMPTY_VARIABLE: "warning";
  readonly POSSIBLY_UNUSED_VARIABLE: "warning";
  readonly DYNAMIC_REFERENCE: "warning";
}

export type IssueCode = keyof IssueSeverityByCode;
export type IssueSeverity = IssueSeverityByCode[IssueCode];

export type AuditIssue = {
  [Code in IssueCode]: {
    readonly code: Code;
    readonly severity: IssueSeverityByCode[Code];
  } & (Code extends "DYNAMIC_REFERENCE"
    ? { readonly reference: DynamicReference }
    : { readonly name: string; readonly references: readonly VariableReference[] });
}[IssueCode];

export type CoverageLimitation =
  | "ALIASES_NOT_RESOLVED"
  | "DESTRUCTURING_NOT_RESOLVED"
  | "WRAPPERS_NOT_RESOLVED"
  | "DYNAMIC_REFERENCES_NOT_RESOLVED";

export interface AuditCoverage {
  readonly scope: "direct-references";
  /** Coverage limitations do not represent an operational failure. */
  readonly limitations: readonly CoverageLimitation[];
}

export interface AuditSummary {
  readonly errorCount: number;
  readonly warningCount: number;
}

/** Serializable report: no source contents, environment values or raw errors. */
export interface AuditReport {
  readonly schemaVersion: 1;
  readonly summary: AuditSummary;
  readonly issues: readonly AuditIssue[];
  readonly references: readonly VariableReference[];
  readonly coverage: AuditCoverage;
}

export type AuditFailureCode =
  | "INVALID_INPUT"
  | "READ_ERROR"
  | "FORMAT_ERROR"
  | "LIMIT_EXCEEDED";

/** A failed run cannot masquerade as a completed, limited-coverage report. */
export type AuditResult =
  | { readonly status: "completed"; readonly report: AuditReport }
  | { readonly status: "failed"; readonly code: AuditFailureCode };
