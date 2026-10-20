import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { audit } from "../src/audit.ts";
import { analyze } from "../src/core/analyze.ts";
import { compare } from "../src/core/compare.ts";
import { buildReport } from "../src/core/report.ts";
import type {
  AuditFailureCode, AuditIssue, AuditResult, CoverageLimitation, VariableReference,
} from "../src/core/types.ts";
import { formatText } from "../src/reporters/text.ts";

function reference(name = "TOKEN", path = "src/config.ts", line = 2, column = 7): VariableReference {
  return { name, origin: "process.env", location: { path, line, column } };
}

function completed(issues: readonly AuditIssue[] = [], limitations: readonly CoverageLimitation[] = []): AuditResult {
  return {
    status: "completed",
    report: {
      schemaVersion: 1,
      summary: {
        errorCount: issues.filter(issue => issue.severity === "error").length,
        warningCount: issues.filter(issue => issue.severity === "warning").length,
      },
      issues,
      references: [],
      coverage: { scope: "direct-references", limitations },
    },
  };
}

const issues: readonly AuditIssue[] = [
  { code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: "EXTRA", references: [reference("EXTRA")] },
  { code: "MISSING_VARIABLE", severity: "error", name: "MISSING", references: [reference("MISSING")] },
  { code: "EMPTY_VARIABLE", severity: "warning", name: "EMPTY", references: [reference("EMPTY")] },
  { code: "POSSIBLY_UNUSED_VARIABLE", severity: "warning", name: "UNUSED", references: [] },
  { code: "DYNAMIC_REFERENCE", severity: "warning", reference: reference("NOT_AN_INFERRED_NAME", "src/dynamic.ts", 8, 11) },
];

test("renders summary and all five issue codes with severity, names, explanations and locations", () => {
  const text = formatText(completed(issues));
  assert.match(text, /^Audit completed\.\nSummary: 1 error\(s\), 4 warning\(s\)\./);
  for (const issue of issues) {
    const header = `${issue.severity.toUpperCase()} ${issue.code}${issue.code === "DYNAMIC_REFERENCE" ? "" : ` "${issue.name}"`}`;
    assert.ok(text.includes(`\n${header}\n`));
  }
  assert.match(text, /direct reference uses this name, but the selected example file does not document it/);
  assert.match(text, /documented in the selected example file but absent from the selected environment file/);
  assert.match(text, /present but empty in the selected environment file/);
  assert.match(text, /No direct references were detected for this documented name/);
  assert.match(text, /variable name at this access could not be resolved/);
  assert.ok(text.includes('  at "src/config.ts":2:7'));
  assert.ok(text.includes('  at "src/dynamic.ts":8:11'));
  assert.ok(text.includes("  No direct source location recorded."));
  assert.doesNotMatch(text, /NOT_AN_INFERRED_NAME|\x1b/);
});

test("gives cautious review guidance for undocumented, missing, empty and possibly unused names", () => {
  const text = formatText(completed(issues));
  assert.match(text, /Review whether to document it; usage alone does not establish that it is required/);
  assert.match(text, /Review the expected configuration and any optional usage or defaults/);
  assert.match(text, /Review whether an empty value is intentional and accepted by the application; empty is not always invalid/);
  assert.match(text, /Review indirect usage and the coverage limits before changing its documentation or configuration; it may still be used/);
  assert.match(text, /Review the access and its expected configuration manually; no name is inferred/);
  assert.doesNotMatch(text, /\b(delete|remove|must be configured|empty is always invalid)\b/i);
});

test("preserves issue, duplicate location and coverage order without sorting or deduplicating", () => {
  const first = reference("Z", "z.ts", 10, 3);
  const second = reference("Z", "a.ts", 2, 1);
  const input = completed([
    { code: "MISSING_VARIABLE", severity: "error", name: "Z", references: [first, second, first] },
    { code: "MISSING_VARIABLE", severity: "error", name: "A", references: [] },
    { code: "EMPTY_VARIABLE", severity: "warning", name: "A", references: [] },
  ], ["WRAPPERS_NOT_RESOLVED", "ALIASES_NOT_RESOLVED"]);
  const text = formatText(input);
  assert.ok(text.includes('  at "z.ts":10:3\n  at "a.ts":2:1\n  at "z.ts":10:3'));
  assert.ok(text.indexOf('MISSING_VARIABLE "Z"') < text.indexOf('MISSING_VARIABLE "A"'));
  assert.ok(text.indexOf('MISSING_VARIABLE "A"') < text.indexOf('EMPTY_VARIABLE "A"'));
  assert.ok(text.indexOf("Wrapper functions are not resolved.") < text.indexOf("Aliases are not resolved."));
});

test("distinguishes a completed empty report while always stating its scope", () => {
  assert.equal(formatText(completed()), [
    "Audit completed.",
    "Summary: 0 error(s), 0 warning(s).",
    "No issues detected within the analysis scope.",
    "",
    "Coverage: direct references only (process.env and import.meta.env).",
    "Other access patterns may be missed. This does not validate the complete runtime or deployment configuration.",
    "",
  ].join("\n"));
  assert.doesNotMatch(formatText(completed(issues)), /No issues detected/);
});

test("shows every coverage limitation even when no dynamic access or issue was detected", () => {
  const report = buildReport({ references: [], dynamicReferences: [] }, []);
  const text = formatText({ status: "completed", report });
  assert.ok(text.includes("- Aliases are not resolved.\n- Destructuring is not resolved.\n- Wrapper functions are not resolved.\n- Dynamic reference names are not resolved."));
  assert.match(text, /No issues detected within the analysis scope/);
  assert.doesNotMatch(text, /Audit failed|WARNING DYNAMIC_REFERENCE|fully validated/i);
});

const failureMessages: Record<AuditFailureCode, string> = {
  INVALID_INPUT: "Review the project root and the selected environment and example file paths.",
  READ_ERROR: "The analysis could not read or process the selected project. Review file availability and permissions, then retry.",
  FORMAT_ERROR: "An environment file has an unsupported format. Review the selected files against the supported assignment syntax.",
  LIMIT_EXCEEDED: "The analysis reached a safety limit. Review project size and file sizes before retrying.",
};

test("renders each operational failure as a safe failure, never as a completed or partial report", () => {
  for (const code of Object.keys(failureMessages) as AuditFailureCode[]) {
    const text = formatText({ status: "failed", code });
    assert.equal(text, `Audit failed: ${code}\n${failureMessages[code]}\nNo completed report is available.\n`);
    assert.doesNotMatch(text, /Audit completed|Summary:|No issues detected|Coverage:/);
  }
});

test("escapes every C0 and C1 control in names and paths without adding lines or terminal sequences", () => {
  const controls = [...Array.from({ length: 32 }, (_, index) => index),
    ...Array.from({ length: 33 }, (_, index) => index + 0x7f)];
  for (const code of controls) {
    const label = `before${String.fromCodePoint(code)}after`;
    const escaped = `before\\u${code.toString(16).padStart(4, "0")}after`;
    const text = formatText(completed([
      { code: "MISSING_VARIABLE", severity: "error", name: label, references: [reference(label, label)] },
      { code: "DYNAMIC_REFERENCE", severity: "warning", reference: reference("IGNORED", label) },
    ]));
    assert.ok(text.includes(`ERROR MISSING_VARIABLE "${escaped}"\n`));
    assert.equal(text.split(`  at "${escaped}":2:7`).length - 1, 2);
    assert.doesNotMatch(text.replaceAll("\n", ""), /[\p{Cc}]/u);
    assert.equal(text.split("\n").length, 14);
  }
});

test("escapes Unicode formatting, separators, lone surrogates, quotes and literal backslashes", () => {
  const cases = [
    ["\u2028", "\\u2028"], ["\u2029", "\\u2029"], ["\u202e", "\\u202e"],
    ["\u2066", "\\u2066"], ["\u2069", "\\u2069"], ["\u200b", "\\u200b"],
    ["\ufeff", "\\ufeff"], ["\u{e0001}", "\\u{e0001}"],
    ["\ud800", "\\ud800"], ["\udfff", "\\udfff"], ['"', '\\"'], ["\\n", "\\\\n"],
  ];
  for (const [character, escaped] of cases) {
    const text = formatText(completed([
      { code: "EMPTY_VARIABLE", severity: "warning", name: `a${character}b`, references: [reference("TOKEN", `a${character}b`)] },
    ]));
    assert.ok(text.includes(`WARNING EMPTY_VARIABLE "a${escaped}b"\n`));
    assert.ok(text.includes(`  at "a${escaped}b":2:7\n`));
    assert.doesNotMatch(text, /[\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
  }
  const text = formatText(completed([
    { code: "EMPTY_VARIABLE", severity: "warning", name: "配置_á_😀", references: [reference("TOKEN", "src/配置 😀.ts")] },
  ]));
  assert.ok(text.includes('"配置_á_😀"'));
  assert.ok(text.includes('"src/配置 😀.ts":2:7'));
});

test("ignores extra runtime values, source, original errors and timestamps at every level", () => {
  const extras = {
    value: "synthetic-private-value", content: "synthetic-source-content",
    error: new Error("synthetic-original-error"), timestamp: "synthetic-timestamp",
    message: "synthetic-unsafe-message", cause: "synthetic-original-cause",
  };
  const input = completed(issues);
  assert.equal(input.status, "completed");
  if (input.status !== "completed") return;
  const decoratedIssues = issues.map(issue => {
    const decorate = (ref: VariableReference): VariableReference => ({ ...ref, ...extras, location: { ...ref.location, ...extras } });
    return issue.code === "DYNAMIC_REFERENCE"
      ? { ...issue, ...extras, reference: decorate(reference("UNINFERRED", issue.reference.location.path, 8, 11)) }
      : { ...issue, ...extras, references: issue.references.map(decorate) };
  });
  const decorated = { ...input, ...extras, report: {
    ...input.report, ...extras, issues: decoratedIssues,
    references: [Object.assign(reference("synthetic-unrelated-reference"), extras)],
    summary: { ...input.report.summary, ...extras }, coverage: { ...input.report.coverage, ...extras },
  } };
  assert.equal(formatText(decorated), formatText(input));
  assert.doesNotMatch(formatText(decorated), /synthetic-|UNINFERRED/);
  for (const code of Object.keys(failureMessages) as AuditFailureCode[]) {
    const failed = { status: "failed" as const, code, ...extras, report: decorated.report };
    assert.equal(formatText(failed), formatText({ status: "failed", code }));
  }
});

test("renders existing analysis, comparison and report contracts without synthetic source values", () => {
  const analysis = analyze({ path: "src/config.ts", content: [
    'const fallback = "synthetic-source-value";',
    "process.env.EXTRA; process.env.MISSING; process.env.EMPTY; process.env[key];",
  ].join("\n") });
  const input = { ...analysis, documentedNames: ["MISSING", "EMPTY", "UNUSED"],
    environment: [{ name: "EMPTY", state: "empty" }, { name: "UNUSED", state: "present" }] as const };
  const text = formatText({ status: "completed", report: buildReport(analysis, compare(input)) });
  for (const issue of issues) assert.ok(text.includes(issue.code));
  assert.match(text, /Summary: 1 error\(s\), 4 warning\(s\)/);
  assert.doesNotMatch(text, /synthetic-source-value|const fallback|process\.env\[key\]/);
});

test("describes the selected example file when auditing an explicit alternative example", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "envclarity-text-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "config"));
  await writeFile(join(root, ".env.example"), "invalid default example");
  await writeFile(join(root, "config/custom.example"), "MISSING=\nEMPTY=\nUNUSED=");
  await writeFile(join(root, "config/selected.env"), "EMPTY=\nUNUSED=synthetic-alternative-example-value");
  await writeFile(join(root, "app.ts"), "process.env.EXTRA; process.env.MISSING; process.env.EMPTY; process.env[key];");

  const result = await audit(root, "config/selected.env", "config/custom.example");
  assert.equal(result.status, "completed");
  const text = formatText(result);
  assert.match(text, /Summary: 1 error\(s\), 4 warning\(s\)/);
  assert.ok(text.includes('WARNING UNDOCUMENTED_VARIABLE "EXTRA"\nA direct reference uses this name, but the selected example file does not document it.'));
  assert.ok(text.includes('ERROR MISSING_VARIABLE "MISSING"\nThis name is documented in the selected example file but absent from the selected environment file.'));
  assert.doesNotMatch(text, /\.env\.example|invalid default example|synthetic-alternative-example-value/);
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("accepts frozen results without mutation and returns identical text on repeated calls", () => {
  for (const input of [completed(issues, ["ALIASES_NOT_RESOLVED"]),
    { status: "failed", code: "READ_ERROR" } as const]) {
    const before = structuredClone(input);
    deepFreeze(input);
    const text = formatText(input);
    assert.equal(formatText(input), text);
    assert.deepEqual(input, before);
  }
});

test("source and compiled reporters return strings without printing on import, success or failure", () => {
  for (const moduleUrl of [new URL("../src/reporters/text.ts", import.meta.url),
    new URL("../dist/reporters/text.js", import.meta.url)]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      const { formatText } = await import(${JSON.stringify(moduleUrl.href)});
      assert.equal(typeof formatText(${JSON.stringify(completed(issues))}), "string");
      assert.equal(typeof formatText({ status: "failed", code: "READ_ERROR" }), "string");
    `], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "");
  }
});
