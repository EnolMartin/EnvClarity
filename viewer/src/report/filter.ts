import type { AuditIssue, IssueCode, IssueSeverity } from "../../../src/core/types.js";

export const FINDINGS_PAGE_SIZE = 50;
export interface IssueFilters {
  readonly severity: IssueSeverity | "all";
  readonly code: IssueCode | "all";
  readonly query: string;
}
export const EMPTY_FILTERS: IssueFilters = { severity: "all", code: "all", query: "" };

/** Retain report order and original indices for stable finding identity. */
export function filterIssues(issues: readonly AuditIssue[], filters: IssueFilters) {
  const query = filters.query.toLowerCase();
  return issues.flatMap((issue, index) => {
    if (filters.severity !== "all" && issue.severity !== filters.severity) return [];
    if (filters.code !== "all" && issue.code !== filters.code) return [];
    const references = issue.code === "DYNAMIC_REFERENCE" ? [issue.reference] : issue.references;
    const matches = query === "" ||
      (issue.code !== "DYNAMIC_REFERENCE" && issue.name.toLowerCase().includes(query)) ||
      references.some(reference => reference.location.path.toLowerCase().includes(query));
    return matches ? [{ issue, index }] : [];
  });
}

/** Display control and formatting characters explicitly; never interpret a label as markup. */
export function displayLabel(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, character =>
    `\\u{${character.codePointAt(0)!.toString(16).toUpperCase()}}`);
}
