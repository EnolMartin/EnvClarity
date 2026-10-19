import type { AuditIssue, ComparisonInput, VariableReference } from "./types.js";

/** Compare literal references and documented names against the selected environment states. */
export function compare(input: ComparisonInput): AuditIssue[] {
  const documentedNames = new Set(input.documentedNames);
  const environment = new Map(input.environment.map(({ name, state }) => [name, state]));
  const referencesByName = new Map<string, VariableReference[]>();
  const issues: AuditIssue[] = [];

  for (const reference of input.references) {
    const references = referencesByName.get(reference.name);
    if (references === undefined) {
      referencesByName.set(reference.name, [reference]);
    } else {
      references.push(reference);
    }
  }

  for (const [name, references] of referencesByName) {
    if (!documentedNames.has(name)) {
      issues.push({ code: "UNDOCUMENTED_VARIABLE", severity: "warning", name, references });
    }
  }

  for (const name of documentedNames) {
    const state = environment.get(name);
    const references = referencesByName.get(name) ?? [];
    if (state === undefined || state === "absent") {
      issues.push({ code: "MISSING_VARIABLE", severity: "error", name, references });
    } else if (state === "empty") {
      issues.push({ code: "EMPTY_VARIABLE", severity: "warning", name, references });
    }
    // Other patterns, including dynamic accesses, may still use this name.
    if (references.length === 0) {
      issues.push({ code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name, references });
    }
  }

  return issues;
}
