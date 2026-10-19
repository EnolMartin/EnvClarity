import { analyze } from "./core/analyze.ts";
import { compare } from "./core/compare.ts";
import { buildReport } from "./core/report.ts";
import type { AuditResult, DynamicReference, VariableReference } from "./core/types.js";
import { ProjectFiles, ScanError } from "./io/discover.ts";
import { readEnv } from "./io/read-env.ts";

/** Audit one local project without executing, modifying or printing its contents. */
export async function audit(
  root: string,
  environmentPath: string,
  examplePath = ".env.example",
): Promise<AuditResult> {
  if (typeof root !== "string" || typeof environmentPath !== "string" || !environmentPath ||
    typeof examplePath !== "string") {
    return { status: "failed", code: "INVALID_INPUT" };
  }

  try {
    const files = await ProjectFiles.open(root);
    const paths = await files.discover();
    const environment = await readEnv(files, environmentPath, examplePath);
    const references: VariableReference[] = [];
    const dynamicReferences: DynamicReference[] = [];
    for (const path of paths) {
      const content = await files.readSource(path);
      const analysis = analyze({ path, content });
      for (const reference of analysis.references) references.push(reference);
      for (const reference of analysis.dynamicReferences) dynamicReferences.push(reference);
    }

    const analysis = { references, dynamicReferences };
    const issues = compare({ ...analysis, ...environment });
    return { status: "completed", report: buildReport(analysis, issues) };
  } catch (error) {
    // Unexpected failures also close the run; never expose native errors or partial data.
    return { status: "failed", code: error instanceof ScanError ? error.code : "READ_ERROR" };
  }
}
