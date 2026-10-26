import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport } from "../src/core/report.ts";
import { createReportImporter } from "../viewer/src/report/import.ts";
import type { ImportState } from "../viewer/src/report/import.ts";
import { REPORT_LIMITS } from "../viewer/src/report/validate.ts";

const result = { status: "completed", report: buildReport({ references: [], dynamicReferences: [] }, []) };
const json = JSON.stringify(result);

function setup() {
  const states: ImportState[] = [];
  const importer = createReportImporter(state => states.push(state));
  return { importer, states };
}

function pendingFile() {
  let resolve!: (value: string) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<string>((success, failure) => { resolve = success; reject = failure; });
  return { file: { size: 100, text: () => promise }, resolve, reject };
}

test("viewer reads a bounded local file and replaces loading with the validated result", async () => {
  const { importer, states } = setup();
  await importer.load({ size: new TextEncoder().encode(json).length, text: async () => json });
  assert.deepEqual(states, [{ status: "loading" }, { status: "loaded", result }]);
  importer.clear();
  assert.deepEqual(states.at(-1), { status: "idle" });
});

test("viewer refuses oversized files before invoking their read method", async () => {
  const { importer, states } = setup();
  let reads = 0;
  await importer.load({ size: REPORT_LIMITS.bytes + 1, text: async () => { reads++; return json; } });
  assert.equal(reads, 0);
  assert.deepEqual(states, [{ status: "error", error: "FILE_TOO_LARGE" }]);
  await importer.load({ size: REPORT_LIMITS.bytes, text: async () => json });
  assert.deepEqual(states.at(-1), { status: "loaded", result });
});

test("viewer reports safe read and validation errors without keeping the previous result", async () => {
  const { importer, states } = setup();
  await importer.load({ size: json.length, text: async () => json });
  const start = states.length;
  await importer.load({ size: 10, text: async () => { throw new Error("PRIVATE_CANARY"); } });
  assert.deepEqual(states.slice(start), [{ status: "loading" }, { status: "error", error: "FILE_READ_ERROR" }]);
  await importer.load({ size: 10, text: async () => "{PRIVATE_CANARY" });
  assert.deepEqual(states.at(-1), { status: "error", error: "INVALID_JSON" });
  assert.equal(JSON.stringify(states).includes("PRIVATE_CANARY"), false);
});

test("viewer handles valid operational failures as results rather than import failures", async () => {
  const { importer, states } = setup();
  const failed = { status: "failed", code: "READ_ERROR" };
  await importer.load({ size: 100, text: async () => JSON.stringify(failed) });
  assert.deepEqual(states.at(-1), { status: "loaded", result: failed });
});

test("viewer keeps only the newest selection when older reads complete or fail later", async () => {
  for (const outcome of ["resolve", "reject"] as const) {
    const { importer, states } = setup();
    const first = pendingFile();
    const pending = importer.load(first.file);
    const failed = { status: "failed", code: "FORMAT_ERROR" };
    await importer.load({ size: 100, text: async () => JSON.stringify(failed) });
    const expected = [...states];
    if (outcome === "resolve") first.resolve(json);
    else first.reject(new Error("PRIVATE_CANARY"));
    await pending;
    assert.deepEqual(states, expected);
    assert.deepEqual(states.at(-1), { status: "loaded", result: failed });
  }
});

test("viewer clearing or unmounting invalidates in-flight reads", async () => {
  for (const action of ["clear", "cancel"] as const) {
    const { importer, states } = setup();
    const file = pendingFile();
    const pending = importer.load(file.file);
    importer[action]();
    const expected = [...states];
    file.resolve(json);
    await pending;
    assert.deepEqual(states, expected);
    if (action === "clear") assert.deepEqual(states.at(-1), { status: "idle" });
  }
});

test("viewer an oversized replacement invalidates an older read and permits retry", async () => {
  const { importer, states } = setup();
  const first = pendingFile();
  const pending = importer.load(first.file);
  await importer.load({ size: REPORT_LIMITS.bytes + 1, text: async () => json });
  first.resolve(json);
  await pending;
  assert.deepEqual(states.at(-1), { status: "error", error: "FILE_TOO_LARGE" });
  await importer.load({ size: json.length, text: async () => json });
  assert.deepEqual(states.at(-1), { status: "loaded", result });
});


test("viewer replaces a loaded report with each validation error and recovers without stale data", async () => {
  const cases = [
    { json: "{PRIVATE_CANARY", error: "INVALID_JSON" },
    { json: JSON.stringify({ ...result, report: { ...result.report, summary: { errorCount: 1, warningCount: 0 } } }), error: "INVALID_REPORT" },
    { json: JSON.stringify({ ...result, report: { ...result.report, schemaVersion: 2 } }), error: "UNSUPPORTED_SCHEMA" },
    { json: JSON.stringify({ ...result, report: { ...result.report, references: [{ name: "x".repeat(REPORT_LIMITS.nameLength + 1), origin: "process.env", location: { path: "src/a.ts", line: 1, column: 1 } }] } }), error: "LIMIT_EXCEEDED" },
  ];
  for (const invalid of cases) {
    const { importer, states } = setup();
    await importer.load({ size: json.length, text: async () => json });
    const start = states.length;
    await importer.load({ size: invalid.json.length, text: async () => invalid.json });
    assert.deepEqual(states.slice(start), [{ status: "loading" }, { status: "error", error: invalid.error }]);
    await importer.load({ size: json.length, text: async () => json });
    assert.deepEqual(states.at(-1), { status: "loaded", result });
    assert.equal(JSON.stringify(states).includes("PRIVATE_CANARY"), false);
  }
});

test("viewer clearing an import ignores late read failures and permits another report", async () => {
  const { importer, states } = setup();
  const pending = pendingFile();
  const reading = importer.load(pending.file);
  assert.deepEqual(states.at(-1), { status: "loading" });
  importer.clear();
  const cleared = [...states];
  pending.reject(new Error("PRIVATE_CANARY"));
  await reading;
  assert.deepEqual(states, cleared);
  assert.deepEqual(states.at(-1), { status: "idle" });
  await importer.load({ size: json.length, text: async () => json });
  assert.deepEqual(states.at(-1), { status: "loaded", result });
});
