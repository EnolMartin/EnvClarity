import { test, expect } from "@playwright/test";
import { empty, expectSummary, sample, upload } from "./fixtures.ts";

test("report data is neither transmitted nor persisted during import, search, clear or reload", async ({ page, context, baseURL }) => {
  const requests: { url: string; method: string; payload: string | null; headers: Record<string, string> }[] = [];
  const external: string[] = [];
  const sockets: string[] = [];
  const consoleMessages: string[] = [];
  const pageErrors: string[] = [];
  context.on("request", request => requests.push({ url: request.url(), method: request.method(), payload: request.postData(), headers: request.headers() }));
  page.on("websocket", socket => sockets.push(socket.url()));
  page.on("console", message => consoleMessages.push(message.text()));
  page.on("pageerror", error => pageErrors.push(error.message));
  await context.route("**/*", async route => {
    if (new URL(route.request().url()).origin !== new URL(baseURL!).origin) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  await page.addInitScript(() => {
    window.testStorageWrites = [];
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      window.testStorageWrites.push(`${key}:${value}`);
      return setItem.call(this, key, value);
    };
    const openDatabase = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<IDBFactory["open"]>) {
      window.testStorageWrites.push(`indexedDB:${args[0]}`);
      return openDatabase.apply(this, args);
    };
    const openCache = CacheStorage.prototype.open;
    CacheStorage.prototype.open = function (name) {
      window.testStorageWrites.push(`cache:${name}`);
      return openCache.call(this, name);
    };
  });
  await page.goto("/");
  const value = sample();
  const canary = "REPORT_DATA_CANARY";
  const issue = value.report.issues.find(item => item.code === "MISSING_VARIABLE")!;
  if (issue.code !== "MISSING_VARIABLE") throw new Error("Missing fixture issue");
  const report = { ...value, report: { ...value.report, issues: value.report.issues.map(item => item === issue ? { ...item, name: canary } : item) } };
  await upload(page, report, "CANARY_FILENAME.json");
  await expectSummary(page, 1, 4, 5);
  await page.getByRole("searchbox").fill(canary);
  await expect(page.getByRole("article")).toHaveCount(1);
  await page.getByLabel("Choose JSON report", { exact: true }).setInputFiles({ name: "CANARY_FILENAME.json", mimeType: "application/json", buffer: Buffer.from("{" + canary) });
  await expect(page.getByRole("heading", { name: "Invalid JSON file" })).toBeVisible();
  await upload(page, report, "CANARY_FILENAME.json");
  await expectSummary(page, 1, 4, 5);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await page.evaluate(() => window.testStorageWrites)).toEqual([]);
  expect(await context.storageState()).toEqual({ cookies: [], origins: [] });
  expect(await page.evaluate(async () => ({ session: sessionStorage.length, databases: await indexedDB.databases(), caches: await caches.keys(), history: history.state, windowName: window.name }))).toEqual({ session: 0, databases: [], caches: [], history: null, windowName: "" });
  await page.getByRole("button", { name: "Clear report", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Start with a CLI report" })).toBeVisible();
  expect(await page.evaluate(() => window.testStorageWrites)).toEqual([]);
  await upload(page, report, "CANARY_FILENAME.json");
  await expectSummary(page, 1, 4, 5);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Start with a CLI report" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Audit summary" })).toHaveCount(0);
  await upload(page, empty()); await expectSummary(page, 0, 0, 0);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(request => request.method === "GET" && request.payload === null)).toBe(true);
  expect(JSON.stringify(requests)).not.toContain(canary);
  expect(JSON.stringify(requests)).not.toContain("CANARY_FILENAME");
  expect(consoleMessages.join("\n")).not.toContain(canary);
  expect(consoleMessages.join("\n")).not.toContain("CANARY_FILENAME");
  expect(external).toEqual([]);
  expect(sockets).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(context.pages()).toHaveLength(1);
  expect(await page.evaluate(() => window.testStorageWrites)).toEqual([]);
  expect(await context.storageState()).toEqual({ cookies: [], origins: [] });
});
