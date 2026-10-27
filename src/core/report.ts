import type {
  AnalysisResult,
  AuditIssue,
  AuditReport,
  DynamicReference,
  SourceLocation,
  VariableReference,
} from "./types.js";

// Compare UTF-16 code units, independently of the host locale.
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareLocations(left: SourceLocation, right: SourceLocation): number {
  return compareText(left.path, right.path) || left.line - right.line || left.column - right.column;
}

function compareReferences(left: VariableReference, right: VariableReference): number {
  return compareLocations(left.location, right.location) ||
    compareText(left.origin, right.origin) || compareText(left.name, right.name);
}

function copyLocation(location: SourceLocation): SourceLocation {
  return { path: location.path, line: location.line, column: location.column };
}

function copyDynamicReference(reference: DynamicReference): DynamicReference {
  return { origin: reference.origin, location: copyLocation(reference.location) };
}

function normalizeReferences(references: readonly VariableReference[]): VariableReference[] {
  const copies = references.map(reference => ({
    name: reference.name,
    origin: reference.origin,
    location: copyLocation(reference.location),
  })).sort(compareReferences);
  return copies.filter((reference, index) =>
    index === 0 || compareReferences(copies[index - 1]!, reference) !== 0);
}

function normalizeIssue(issue: AuditIssue): AuditIssue {
  if (issue.code === "DYNAMIC_REFERENCE") {
    return { code: issue.code, severity: "warning", reference: copyDynamicReference(issue.reference) };
  }
  const name = issue.name;
  const references = normalizeReferences(issue.references);
  if (issue.code === "MISSING_VARIABLE") {
    return { code: issue.code, severity: "error", name, references };
  }
  return { code: issue.code, severity: "warning", name, references };
}

function issueLocation(issue: AuditIssue): SourceLocation | undefined {
  return issue.code === "DYNAMIC_REFERENCE" ? issue.reference.location : issue.references[0]?.location;
}

function compareIssues(left: AuditIssue, right: AuditIssue): number {
  const leftLocation = issueLocation(left);
  const rightLocation = issueLocation(right);
  if (leftLocation === undefined && rightLocation !== undefined) return 1;
  if (leftLocation !== undefined && rightLocation === undefined) return -1;
  if (leftLocation !== undefined && rightLocation !== undefined) {
    const locationOrder = compareLocations(leftLocation, rightLocation);
    if (locationOrder !== 0) return locationOrder;
  }
  // Canonical contract-only JSON breaks all remaining ties and identifies exact duplicates.
  return compareText(left.code, right.code) || compareText(JSON.stringify(left), JSON.stringify(right));
}

// Normalize before sorting so equivalent inputs produce identical reports.
// Copy only known fields: callers may carry source contents or values on extra properties.
export function buildReport(analysis: AnalysisResult, issues: readonly AuditIssue[]): AuditReport {
  const sortedIssues = [
    ...issues.map(normalizeIssue),
    ...analysis.dynamicReferences.map((reference): AuditIssue => ({
      code: "DYNAMIC_REFERENCE",
      severity: "warning",
      reference: copyDynamicReference(reference),
    })),
  ].sort(compareIssues);
  const finalIssues = sortedIssues.filter((issue, index) =>
    index === 0 || compareIssues(sortedIssues[index - 1]!, issue) !== 0);

  const errorCount = finalIssues.filter(issue => issue.severity === "error").length;

  return {
    schemaVersion: 1,
    summary: { errorCount, warningCount: finalIssues.length - errorCount },
    issues: finalIssues,
    references: normalizeReferences(analysis.references),
    coverage: {
      scope: "direct-references",
      limitations: [
        "ALIASES_NOT_RESOLVED",
        "DESTRUCTURING_NOT_RESOLVED",
        "WRAPPERS_NOT_RESOLVED",
        "DYNAMIC_REFERENCES_NOT_RESOLVED",
      ],
    },
  };
}
