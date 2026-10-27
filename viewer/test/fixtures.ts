import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { buildReport } from "../../src/core/report.ts";
import { compare } from "../../src/core/compare.ts";
import type { AuditIssue, AuditResult, VariableReference } from "../../src/core/types.ts";

type Completed = Extract<AuditResult, { status: "completed" }>;

export function sample(): Completed {
  const references: VariableReference[] = [
    { name: "TOKEN", origin: "process.env", location: { path: "src/server.ts", line: 2, column: 1 } },
    { name: "TOKEN", origin: "process.env", location: { path: "src/extra.ts", line: 7, column: 3 } },
    { name: "EMPTY", origin: "process.env", location: { path: "src/server.ts", line: 3, column: 1 } },
    { name: "VITE_URL", origin: "import.meta.env", location: { path: "src/client.ts", line: 1, column: 1 } },
  ];
  const analysis = { references, dynamicReferences: [{ origin: "process.env" as const, location: { path: "src/dynamic.ts", line: 4, column: 1 } }] };
  const issues = compare({ ...analysis, documentedNames: ["TOKEN", "EMPTY", "UNUSED"], environment: [
    { name: "TOKEN", state: "absent" }, { name: "EMPTY", state: "empty" }, { name: "UNUSED", state: "present" }, { name: "VITE_URL", state: "present" },
  ] });
  return { status: "completed", report: buildReport(analysis, issues) };
}

export function empty(): Completed {
  return { status: "completed", report: buildReport({ references: [], dynamicReferences: [] }, []) };
}

export function many(longLabels = false): Completed {
  const value = sample();
  const issues: AuditIssue[] = [...value.report.issues];
  const index = issues.findIndex(issue => issue.code === "MISSING_VARIABLE");
  const name = longLabels ? "LONG_" + "N".repeat(1019) : "TOKEN";
  issues[index] = { code: "MISSING_VARIABLE", severity: "error", name, references: Array.from({ length: 51 }, (_, i) => ({
    name, origin: "process.env", location: { path: longLabels ? "src/" + "p".repeat(4089) + ".ts" : `src/location-${i}.ts`, line: i + 1, column: 1 },
  })) };
  for (let i = 0; i < 50; i++) issues.push({ code: "EMPTY_VARIABLE", severity: "warning", name: `EXTRA_${i}`, references: [] });
  return { status: "completed", report: { ...value.report, issues, summary: { errorCount: 1, warningCount: 54 } } };
}

export async function upload(page: Page, value: unknown, name = "report.json") {
  await page.getByLabel("Choose JSON report", { exact: true }).setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
}

export async function expectSummary(page: Page, errors: number, warnings: number, findings: number) {
  const summary = page.getByRole("region", { name: "Audit summary", exact: true });
  await expect(summary.getByRole("definition")).toHaveText([String(errors), String(warnings), String(findings)]);
}

declare global {
  interface Window {
    testReadCalls: string[];
    releaseTestRead: (name: string, fail?: boolean) => Promise<void>;
    testStorageWrites: string[];
  }
}

/** Delayed reads exist only in this isolated test page; the product has no test hook. */
export async function controlledReads(page: Page) {
  await page.addInitScript(() => {
    const original = File.prototype.text;
    const pending = new Map<string, (fail: boolean) => Promise<void>>();
    window.testReadCalls = [];
    window.releaseTestRead = async (name, fail = false) => {
      const release = pending.get(name);
      if (!release) throw new Error("No pending synthetic read");
      pending.delete(name);
      await release(fail);
      await new Promise(requestAnimationFrame);
    };
    File.prototype.text = function () {
      window.testReadCalls.push(this.name);
      if (this.name === "unreadable.json") return Promise.reject(new Error("READ_CANARY"));
      if (this.name.startsWith("pending-")) return new Promise<string>((resolve, reject) => {
        pending.set(this.name, async fail => {
          if (fail) reject(new Error("READ_CANARY"));
          else resolve(await original.call(this));
        });
      });
      return original.call(this);
    };
  });
  await page.reload();
}
