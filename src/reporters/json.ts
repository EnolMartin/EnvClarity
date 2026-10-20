import type {
  AuditIssue,
  AuditResult,
  DynamicReference,
  SourceLocation,
  VariableReference,
} from "../core/types.js";

function copyLocation(location: SourceLocation): SourceLocation {
  return { path: location.path, line: location.line, column: location.column };
}

function copyReference(reference: VariableReference): VariableReference {
  return { name: reference.name, origin: reference.origin, location: copyLocation(reference.location) };
}

function copyDynamicReference(reference: DynamicReference): DynamicReference {
  return { origin: reference.origin, location: copyLocation(reference.location) };
}

function copyIssue(issue: AuditIssue): AuditIssue {
  if (issue.code === "DYNAMIC_REFERENCE") {
    return { code: issue.code, severity: issue.severity, reference: copyDynamicReference(issue.reference) };
  }
  const name = issue.name;
  const references = Array.from(issue.references, copyReference);
  if (issue.code === "MISSING_VARIABLE") {
    return { code: issue.code, severity: issue.severity, name, references };
  }
  return {
    code: issue.code,
    severity: issue.severity,
    name,
    references,
  };
}

/** Serialize contract fields only, preserving report order and counts without I/O or mutation. */
export function formatJson(result: AuditResult): string {
  if (result.status === "failed") {
    return JSON.stringify({ status: result.status, code: result.code });
  }

  const { report } = result;
  return JSON.stringify({
    status: result.status,
    report: {
      schemaVersion: report.schemaVersion,
      summary: { errorCount: report.summary.errorCount, warningCount: report.summary.warningCount },
      issues: Array.from(report.issues, copyIssue),
      references: Array.from(report.references, copyReference),
      coverage: { scope: report.coverage.scope, limitations: Array.from(report.coverage.limitations) },
    },
  });
}
