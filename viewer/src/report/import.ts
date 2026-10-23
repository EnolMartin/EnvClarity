import type { AuditResult } from "../../../src/core/types.js";
import { REPORT_LIMITS, validateReportJson } from "./validate.ts";
import type { ReportValidationError } from "./validate.ts";

export type ImportState =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly error: ReportValidationError | "FILE_TOO_LARGE" | "FILE_READ_ERROR" }
  | { readonly status: "loaded"; readonly result: AuditResult };

type ReportFile = Pick<File, "size" | "text">;

/** Keep only the newest selection; file names and raw exceptions never enter state. */
export function createReportImporter(onChange: (state: ImportState) => void) {
  let generation = 0;

  return {
    async load(file: ReportFile): Promise<void> {
      const current = ++generation;
      if (file.size > REPORT_LIMITS.bytes) {
        onChange({ status: "error", error: "FILE_TOO_LARGE" });
        return;
      }
      onChange({ status: "loading" });
      try {
        const text = await file.text();
        if (current !== generation) return;
        const validation = validateReportJson(text);
        onChange(validation.valid
          ? { status: "loaded", result: validation.result }
          : { status: "error", error: validation.error });
      } catch {
        if (current === generation) onChange({ status: "error", error: "FILE_READ_ERROR" });
      }
    },
    clear(): void {
      generation++;
      onChange({ status: "idle" });
    },
    cancel(): void {
      generation++;
    },
  };
}
