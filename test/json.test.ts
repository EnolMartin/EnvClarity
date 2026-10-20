import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { analyze } from "../src/core/analyze.ts";
import { compare } from "../src/core/compare.ts";
import { buildReport } from "../src/core/report.ts";
import type { AuditFailureCode, AuditReport, AuditResult, VariableReference } from "../src/core/types.ts";
import { formatJson } from "../src/reporters/json.ts";

function reference(name = "TOKEN", path = "src/config.ts", line = 2, column = 7): VariableReference {
  return { name, origin: "process.env", location: { path, line, column } };
}

function completed(): Extract<AuditResult, { status: "completed" }> {
  const direct = reference();
  return {
    status: "completed",
    report: {
      schemaVersion: 1,
      summary: { errorCount: 0, warningCount: 1 },
      issues: [{ code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: direct.name, references: [direct] }],
      references: [direct],
      coverage: { scope: "direct-references", limitations: ["ALIASES_NOT_RESOLVED"] },
    },
  };
}

const failureCodes: readonly AuditFailureCode[] = ["INVALID_INPUT", "READ_ERROR", "FORMAT_ERROR", "LIMIT_EXCEEDED"];

test("serializes a completed result with only the versioned report and no decorative text", () => {
  const input = completed();
  const json = formatJson(input);
  assert.deepEqual(JSON.parse(json), input);
  assert.ok(json.startsWith('{"status":"completed","report":{"schemaVersion":1,'));
  assert.ok(json.endsWith("}}"));
  assert.equal(json, json.trim());
  assert.ok(!json.includes("\n"));
});

test("keeps a completed empty report distinct from an operational failure", () => {
  const input: AuditResult = { status: "completed", report: buildReport({ references: [], dynamicReferences: [] }, []) };
  assert.deepEqual(JSON.parse(formatJson(input)), {
    status: "completed",
    report: {
      schemaVersion: 1,
      summary: { errorCount: 0, warningCount: 0 },
      issues: [],
      references: [],
      coverage: { scope: "direct-references", limitations: [
        "ALIASES_NOT_RESOLVED", "DESTRUCTURING_NOT_RESOLVED", "WRAPPERS_NOT_RESOLVED", "DYNAMIC_REFERENCES_NOT_RESOLVED",
      ] },
    },
  });
});

test("preserves all five issue shapes from analysis, comparison and report building", () => {
  const analysis = analyze({ path: "src/config.ts", content: [
    'const fallback = "synthetic-source-value";',
    "process.env.EXTRA; process.env.MISSING; import.meta.env.EMPTY; process.env[key];",
  ].join("\n") });
  const report = buildReport(analysis, compare({
    ...analysis,
    documentedNames: ["MISSING", "EMPTY", "UNUSED"],
    environment: [{ name: "EMPTY", state: "empty" }, { name: "UNUSED", state: "present" }],
  }));
  const json = formatJson({ status: "completed", report });
  const parsed = JSON.parse(json);
  assert.deepEqual(parsed, { status: "completed", report });
  assert.deepEqual(report.summary, { errorCount: 1, warningCount: 4 });
  assert.deepEqual(report.issues.map(issue => issue.code), [
    "UNDOCUMENTED_VARIABLE", "MISSING_VARIABLE", "EMPTY_VARIABLE", "DYNAMIC_REFERENCE", "POSSIBLY_UNUSED_VARIABLE",
  ]);
  assert.deepEqual(parsed.report.issues[3], {
    code: "DYNAMIC_REFERENCE", severity: "warning",
    reference: { origin: "process.env", location: { path: "src/config.ts", line: 2, column: 64 } },
  });
  const unused = parsed.report.issues[4];
  assert.ok(unused && unused.code === "POSSIBLY_UNUSED_VARIABLE");
  assert.deepEqual(unused.references, []);
  assert.doesNotMatch(json, /synthetic-source-value|const fallback|process\.env\[key\]/);
});

test("preserves array order, duplicates, coverage and supplied counts without normalization", () => {
  const first = reference("Z", "z.ts", 10, 3);
  const second = reference("A", "./a.ts", 2, 1);
  const report: AuditReport = {
    schemaVersion: 1,
    // Deliberately not derived from issues: the reporter must not recompute them.
    summary: { errorCount: 17, warningCount: 23 },
    issues: [
      { code: "MISSING_VARIABLE", severity: "error", name: "Z", references: [first, second, first] },
      { code: "EMPTY_VARIABLE", severity: "warning", name: "A", references: [] },
      { code: "MISSING_VARIABLE", severity: "error", name: "Z", references: [first, second, first] },
    ],
    references: [first, second, first],
    coverage: { scope: "direct-references", limitations: ["WRAPPERS_NOT_RESOLVED", "ALIASES_NOT_RESOLVED", "WRAPPERS_NOT_RESOLVED"] },
  };
  assert.deepEqual(JSON.parse(formatJson({ status: "completed", report })), { status: "completed", report });
});

test("serializes every operational failure with exactly status and safe code", () => {
  for (const code of failureCodes) {
    const json = formatJson({ status: "failed", code });
    assert.equal(json, `{"status":"failed","code":"${code}"}`);
    assert.deepEqual(JSON.parse(json), { status: "failed", code });
  }
});

/** Decorate objects and arrays, including serialization hooks that must never be called. */
function withExtras<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const copy = Array.isArray(value)
    ? value.map(child => withExtras(child))
    : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, withExtras(child)]));
  Object.assign(copy, {
    value: "synthetic-private-value", content: "synthetic-source-content",
    error: new Error("synthetic-original-error"), cause: "synthetic-original-cause",
    timestamp: "synthetic-timestamp", message: "synthetic-unsafe-message", extra: 1n,
    toJSON() { throw new Error("Extra serialization hook must not be called"); },
  });
  Object.defineProperty(copy, "unreadExtra", { enumerable: true, get() { throw new Error("Extra must not be read"); } });
  Object.assign(copy, { circular: copy });
  return copy as T;
}

test("projects allowed fields at every nested level without inspecting extras or serialization hooks", () => {
  const base = completed();
  const input: AuditResult = { ...base, report: {
    ...base.report,
    issues: [...base.report.issues, {
      code: "DYNAMIC_REFERENCE", severity: "warning",
      reference: Object.assign(reference("synthetic-uninferred-name"), { references: [reference("synthetic-extra-reference")] }),
    }],
    summary: { errorCount: 0, warningCount: 2 },
  } };
  const decorated = withExtras(input);
  const json = formatJson(decorated);
  const expected = completed();
  assert.deepEqual(JSON.parse(json), { status: "completed", report: {
    ...expected.report,
    summary: { errorCount: 0, warningCount: 2 },
    issues: [...expected.report.issues, {
      code: "DYNAMIC_REFERENCE", severity: "warning",
      reference: { origin: "process.env", location: { path: "src/config.ts", line: 2, column: 7 } },
    }],
  } });
  assert.doesNotMatch(json, /synthetic-|value|content|error"|cause|timestamp|message|toJSON|circular|unreadExtra/);
});

test("does not inspect a partial report or unsafe diagnostics on any failure", () => {
  for (const code of failureCodes) {
    const input = withExtras({ status: "failed" as const, code });
    Object.defineProperty(input, "report", { enumerable: true, get() { throw new Error("Partial report must not be read"); } });
    const json = formatJson(input);
    assert.equal(json, formatJson({ status: "failed", code }));
    assert.deepEqual(JSON.parse(json), { status: "failed", code });
  }
});

test("round-trips special names and paths as JSON data without losing or interpreting characters", () => {
  const labels = [
    ...Array.from({ length: 32 }, (_, code) => `a${String.fromCodePoint(code)}b`),
    'quotes" and \\slashes', "\u007f\u0085\u009f", "\u2028\u2029\u202e\u2066\u2069",
    "\ud800", "\udfff", "配置_á_😀", "__proto__", "constructor", "toString", "${NAME}",
  ];
  for (const label of labels) {
    const base = completed();
    const ref = reference(label, label);
    const input: AuditResult = { ...base, report: { ...base.report, references: [ref], issues: [
      { code: "UNDOCUMENTED_VARIABLE", severity: "warning", name: label, references: [ref] },
    ] } };
    const json = formatJson(input);
    assert.deepEqual(JSON.parse(json), input);
    assert.doesNotMatch(json, /[\u0000-\u001f]/u);
  }
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

test("accepts deeply frozen inputs and never mutates completed or failed results", () => {
  for (const input of [completed(), ...failureCodes.map(code => ({ status: "failed" as const, code }))]) {
    const before = structuredClone(input);
    deepFreeze(input);
    assert.deepEqual(JSON.parse(formatJson(input)), before);
    assert.deepEqual(input, before);
  }
});

test("produces identical JSON on repeated calls and independent property insertion orders", () => {
  const input = completed();
  const reordered = { report: {
    coverage: { limitations: ["ALIASES_NOT_RESOLVED"] as const, scope: "direct-references" as const },
    references: [{ location: { column: 7, line: 2, path: "src/config.ts" }, origin: "process.env" as const, name: "TOKEN" }],
    issues: input.report.issues,
    summary: { warningCount: 1, errorCount: 0 }, schemaVersion: 1 as const,
  }, status: "completed" as const };
  const json = formatJson(input);
  assert.deepEqual(JSON.parse(json), input);
  assert.equal(formatJson(reordered), json);
  assert.equal(formatJson(structuredClone(input)), json);
  for (let call = 0; call < 5; call++) assert.equal(formatJson(input), json);
});

test("source and compiled reporters return parseable JSON without printing on import or calls", () => {
  for (const moduleUrl of [new URL("../src/reporters/json.ts", import.meta.url),
    new URL("../dist/reporters/json.js", import.meta.url)]) {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import assert from "node:assert/strict";
      const { formatJson } = await import(${JSON.stringify(moduleUrl.href)});
      const input = ${JSON.stringify(completed())};
      assert.deepEqual(JSON.parse(formatJson(input)), input);
      for (const code of ${JSON.stringify(failureCodes)}) {
        assert.deepEqual(JSON.parse(formatJson({ status: "failed", code })), { status: "failed", code });
      }
    `], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, "");
    assert.equal(child.stderr, "");
  }
});
