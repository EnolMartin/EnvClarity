import type {
  AuditFailureCode, AuditResult, CoverageLimitation, IssueCode, SourceLocation,
} from "../core/types.js";

const explanations: Record<IssueCode, string> = {
  UNDOCUMENTED_VARIABLE: "A direct reference uses this name, but the selected example file does not document it. Review whether to document it; usage alone does not establish that it is required.",
  MISSING_VARIABLE: "This name is documented in the selected example file but absent from the selected environment file. Review the expected configuration and any optional usage or defaults.",
  EMPTY_VARIABLE: "This documented name is present but empty in the selected environment file. Review whether an empty value is intentional and accepted by the application; empty is not always invalid.",
  POSSIBLY_UNUSED_VARIABLE: "No direct references were detected for this documented name. Review indirect usage and the coverage limits before changing its documentation or configuration; it may still be used.",
  DYNAMIC_REFERENCE: "The variable name at this access could not be resolved. Review the access and its expected configuration manually; no name is inferred.",
};

const limitations: Record<CoverageLimitation, string> = {
  ALIASES_NOT_RESOLVED: "Aliases are not resolved.",
  DESTRUCTURING_NOT_RESOLVED: "Destructuring is not resolved.",
  WRAPPERS_NOT_RESOLVED: "Wrapper functions are not resolved.",
  DYNAMIC_REFERENCES_NOT_RESOLVED: "Dynamic reference names are not resolved.",
};

const failures: Record<AuditFailureCode, string> = {
  INVALID_INPUT: "Review the project root and the selected environment and example file paths.",
  READ_ERROR: "The analysis could not read or process the selected project. Review file availability and permissions, then retry.",
  FORMAT_ERROR: "An environment file has an unsupported format. Review the selected files against the supported assignment syntax.",
  LIMIT_EXCEEDED: "The analysis reached a safety limit. Review project size and file sizes before retrying.",
};

/** Quote labels and escape terminal controls, Unicode formatting and line separators. */
function quoteLabel(value: string): string {
  return `"${value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}"\\]/gu, character => {
    if (character === '"' || character === "\\") return `\\${character}`;
    const code = character.codePointAt(0)!;
    return code <= 0xffff ? `\\u${code.toString(16).padStart(4, "0")}` : `\\u{${code.toString(16)}}`;
  })}"`;
}

function formatLocation(location: SourceLocation): string {
  return `  at ${quoteLabel(location.path)}:${location.line}:${location.column}`;
}

/** Render contract fields only, preserving report order without I/O or input mutation. */
export function formatText(result: AuditResult): string {
  if (result.status === "failed") {
    return `Audit failed: ${result.code}\n${failures[result.code]}\nNo completed report is available.\n`;
  }

  const { report } = result;
  const lines = [
    "Audit completed.",
    `Summary: ${report.summary.errorCount} error(s), ${report.summary.warningCount} warning(s).`,
  ];
  if (report.issues.length === 0) lines.push("No issues detected within the analysis scope.");

  for (const issue of report.issues) {
    lines.push("", `${issue.severity.toUpperCase()} ${issue.code}${issue.code === "DYNAMIC_REFERENCE" ? "" : ` ${quoteLabel(issue.name)}`}`,
      explanations[issue.code]);
    if (issue.code === "DYNAMIC_REFERENCE") {
      lines.push(formatLocation(issue.reference.location));
    } else if (issue.references.length === 0) {
      lines.push("  No direct source location recorded.");
    } else {
      for (const reference of issue.references) lines.push(formatLocation(reference.location));
    }
  }

  lines.push("", "Coverage: direct references only (process.env and import.meta.env).");
  for (const limitation of report.coverage.limitations) lines.push(`- ${limitations[limitation]}`);
  lines.push("Other access patterns may be missed. This does not validate the complete runtime or deployment configuration.");
  return `${lines.join("\n")}\n`;
}
