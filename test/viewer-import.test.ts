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
