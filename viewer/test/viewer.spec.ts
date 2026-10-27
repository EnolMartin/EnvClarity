import { test, expect } from "@playwright/test";
import { controlledReads, empty, expectSummary, many, sample, upload } from "./fixtures.ts";

test.beforeEach(async ({ page }) => { await page.goto("/"); });

test("imports a CLI-core result, exposes all finding types and clears with keyboard focus", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Start with a CLI report" })).toBeVisible();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Choose JSON report", exact: true }).press("Enter");
  await (await chooserPromise).setFiles({ name: "report.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(sample())) });
  await expectSummary(page, 1, 4, 5);
  for (const name of ["Missing variable", "Empty variable", "Undocumented variable", "Possibly unused variable", "Dynamic reference"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Coverage: direct references only" })).toBeVisible();
  await page.getByRole("button", { name: "Clear report", exact: true }).press("Enter");
  await expect(page.getByRole("button", { name: "Choose JSON report", exact: true })).toBeFocused();
  await expect(page.getByRole("region", { name: "Audit summary" })).toHaveCount(0);
});

test("an empty report retains coverage without unused exploration controls", async ({ page }) => {
  await upload(page, empty());
  await expectSummary(page, 0, 0, 0);
  await expect(page.getByText("No findings were detected", { exact: false })).toBeVisible();
  await expect(page.getByRole("region", { name: "Coverage: direct references only" })).toBeVisible();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
});

test("combines filters and path/name search, retains locations and full summary, then resets", async ({ page }) => {
  await upload(page, sample());
  const severity = page.getByRole("combobox", { name: "Severity", exact: true });
  await severity.press("Home"); await severity.press("ArrowDown"); await severity.press("Enter");
  const type = page.getByRole("combobox", { name: "Type", exact: true });
  await type.click(); await page.getByRole("option", { name: "Missing variable", exact: true }).click();
  await page.getByRole("searchbox").fill("EXTRA.TS");
  await expect(page.getByRole("article")).toHaveCount(1);
  await expectSummary(page, 1, 4, 5);
  await page.getByText("View locations (2)", { exact: true }).press("Enter");
  await expect(page.locator(".locations li")).toHaveCount(2);
  await expect(page.locator(".locations")).toContainText("src/server.ts");
  await page.getByRole("searchbox").fill("no-match");
  await expect(page.getByRole("heading", { name: "No matching findings" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expectSummary(page, 1, 4, 5);
  await page.getByRole("button", { name: "Reset filters" }).press("Enter");
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.getByRole("searchbox")).toHaveValue("");
  await page.getByRole("searchbox").pressSequentially("token");
  await expect(page.getByRole("article")).toHaveCount(1);
});

test("a canceled selection preserves results and same-file replacement resets filters", async ({ page }) => {
  await upload(page, sample());
  const severity = page.getByRole("combobox", { name: "Severity", exact: true });
  await severity.press("Home"); await severity.press("ArrowDown"); await severity.press("Enter");
  await page.getByRole("searchbox").fill("no-match");
  const input = page.getByLabel("Choose JSON report", { exact: true });
  await expect(input).toHaveValue("");
  await input.setInputFiles([]);
  await expectSummary(page, 1, 4, 5);
  await expect(page.getByRole("searchbox")).toHaveValue("no-match");
  await upload(page, sample());
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(page.getByRole("searchbox")).toHaveValue("");
});

test("paginates findings and locations with bounded lists and usable focus", async ({ page }) => {
  await upload(page, many());
  await expect(page.getByRole("article")).toHaveCount(50);
  const pages = page.getByRole("navigation", { name: "Findings pages", exact: true });
  await pages.getByRole("button", { name: "Next", exact: true }).press("Enter");
  await expect(page.getByRole("article")).toHaveCount(5);
  await expect(pages.getByRole("status")).toHaveText("Page 2 of 2");
  await expect(pages.getByRole("button", { name: "Previous", exact: true })).toBeFocused();
  await pages.getByRole("button", { name: "Previous", exact: true }).press("Enter");
  await expect(pages.getByRole("button", { name: "Next", exact: true })).toBeFocused();
  await pages.getByRole("button", { name: "Next", exact: true }).press("Enter");
  await page.getByRole("searchbox").fill("TOKEN");
  await expect(pages.getByRole("status")).toHaveText("Page 1 of 1");
  await expect(page.locator(".locations li")).toHaveCount(0);
  await page.getByText("View locations (51)", { exact: true }).press("Enter");
  await expect(page.locator(".locations li")).toHaveCount(50);
  const locations = page.getByRole("navigation", { name: "Missing variable locations", exact: true });
  await locations.getByRole("button", { name: "Next locations" }).press("Enter");
  await expect(page.locator(".locations li")).toHaveCount(1);
  await expect(locations.getByRole("button", { name: "Previous locations" })).toBeFocused();
  await locations.getByRole("button", { name: "Previous locations" }).press("Enter");
  await expect(locations.getByRole("button", { name: "Next locations" })).toBeFocused();
});

test("custom menus support pointer, Escape, fresh letter search, Tab and active-option semantics", async ({ page }) => {
  await upload(page, sample());
  const severity = page.getByRole("combobox", { name: "Severity", exact: true });
  await severity.press("w"); await severity.press("Escape");
  await expect(severity).toContainText("All severities");
  await severity.press("e"); await severity.press("Enter");
  await expect(severity).toContainText("Errors");
  await severity.press("Tab");
  const type = page.getByRole("combobox", { name: "Type", exact: true });
  await expect(type).toBeFocused();
  await type.press("End");
  const active = await type.getAttribute("aria-activedescendant");
  expect(active).not.toBeNull();
  await expect(page.locator(`[id="${active}"]`)).toHaveText("Dynamic reference");
  await type.press("Tab");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.getByRole("heading", { name: "No matching findings" })).toBeVisible();
  await severity.click(); await page.getByRole("option", { name: "Warnings", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await severity.click(); await page.getByRole("heading", { name: "Explore findings", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

const failureGuidance = {
  INVALID_INPUT: "Check its arguments",
  READ_ERROR: "Check access and run it again",
  FORMAT_ERROR: "Review that file and run the audit again",
  LIMIT_EXCEEDED: "Reduce its scope and run it again",
};
for (const [code, guidance] of Object.entries(failureGuidance)) {
  test(`a valid ${code} audit failure replaces a completed report without stale summary`, async ({ page }) => {
    await upload(page, sample()); await expectSummary(page, 1, 4, 5);
    await upload(page, { status: "failed", code });
    await expect(page.getByRole("heading", { name: "The audit did not complete" })).toBeVisible();
    await expect(page.getByText(guidance, { exact: false })).toBeVisible();
    await expect(page.getByRole("region", { name: "Audit summary" })).toHaveCount(0);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await upload(page, empty()); await expectSummary(page, 0, 0, 0);
  });
}

for (const scenario of [
  { name: "malformed", text: "{REPORT_DATA_CANARY", title: "Invalid JSON file" },
  { name: "shape", text: JSON.stringify({ ...empty(), report: { ...empty().report, summary: { errorCount: 1, warningCount: 0 } } }), title: "Invalid audit report" },
  { name: "version", text: JSON.stringify({ ...empty(), report: { ...empty().report, schemaVersion: 2 } }), title: "Report version not supported" },
  { name: "limit", text: JSON.stringify({ ...empty(), report: { ...empty().report, references: [{ name: "N".repeat(1025), origin: "process.env", location: { path: "a.ts", line: 1, column: 1 } }] } }), title: "Report exceeds viewer limits" },
]) {
  test(`rejects ${scenario.name} input safely and permits retry`, async ({ page }) => {
    await upload(page, sample()); await expectSummary(page, 1, 4, 5);
    await page.getByLabel("Choose JSON report", { exact: true }).setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from(scenario.text) });
    await expect(page.getByRole("alert").getByRole("heading", { name: scenario.title, exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Audit summary" })).toHaveCount(0);
    await expect(page.getByRole("article")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("REPORT_DATA_CANARY");
    await upload(page, sample()); await expectSummary(page, 1, 4, 5);
  });
}

test("oversized files are rejected before reading and read failures do not reveal exceptions", async ({ page }) => {
  await controlledReads(page);
  const messages: string[] = [];
  page.on("console", message => messages.push(message.text()));
  await page.getByLabel("Choose JSON report", { exact: true }).setInputFiles({ name: "large.json", mimeType: "application/json", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole("heading", { name: "File is too large" })).toBeVisible();
  expect(await page.evaluate(() => window.testReadCalls)).not.toContain("large.json");
  await upload(page, sample(), "unreadable.json");
  await expect(page.getByRole("heading", { name: "File could not be read" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("READ_CANARY");
  expect(messages.join("\n")).not.toContain("READ_CANARY");
  await upload(page, sample()); await expectSummary(page, 1, 4, 5);
});

test("a canceled pending read cannot restore a report or an error", async ({ page }) => {
  await controlledReads(page);
  for (const fail of [false, true]) {
    await upload(page, sample(), "pending-cancel.json");
    await expect(page.getByRole("heading", { name: "Opening your report" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel import" }).press("Enter");
    await expect(page.getByRole("button", { name: "Choose JSON report", exact: true })).toBeFocused();
    await page.evaluate(fail => window.releaseTestRead("pending-cancel.json", fail), fail);
    await expect(page.getByRole("heading", { name: "Start with a CLI report" })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Audit summary" })).toHaveCount(0);
  }
});

for (const fail of [false, true]) {
  test(`newest file wins over an older read that ${fail ? "fails" : "completes"} later`, async ({ page }) => {
    await controlledReads(page);
    await upload(page, sample()); await expectSummary(page, 1, 4, 5);
    await upload(page, sample(), "pending-old.json");
    await expect(page.getByRole("heading", { name: "Opening your report" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Audit summary" })).toHaveCount(0);
    await upload(page, empty()); await expectSummary(page, 0, 0, 0);
    await page.evaluate(fail => window.releaseTestRead("pending-old.json", fail), fail);
    await expectSummary(page, 0, 0, 0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}

test("hostile labels remain plain text with visible controls and no automatic actions", async ({ page }) => {
  const value = sample();
  const issue = value.report.issues.find(item => item.code === "MISSING_VARIABLE")!;
  if (issue.code !== "MISSING_VARIABLE") throw new Error("Missing fixture issue");
  const hostile = { ...value, report: { ...value.report, issues: value.report.issues.map(item => item === issue ? { ...issue, name: "<script>window.REPORT_XSS=1</script>\u202e", references: [{ ...issue.references[0]!, location: { path: "https://example.test/\u001b[31m.ts", line: 1, column: 1 } }] } : item) } };
  await upload(page, hostile);
  const finding = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "Missing variable", exact: true }) });
  await expect(finding.locator(".variable-name")).toHaveText("<script>window.REPORT_XSS=1</script>\\u{202E}");
  await finding.getByText("View locations (1)", { exact: true }).click();
  await expect(finding.locator(".locations")).toContainText("https://example.test/\\u{1B}[31m.ts");
  await expect(finding.locator("a,script,iframe")).toHaveCount(0);
  expect(await page.evaluate(() => Object.hasOwn(window, "REPORT_XSS"))).toBe(false);
});

test("long labels reflow and short menus keep active options visible", async ({ page }) => {
  await upload(page, many(true));
  await page.getByRole("searchbox").fill("LONG_");
  await page.getByText("View locations (51)", { exact: true }).click();
  await page.getByRole("button", { name: "Next locations" }).click();
  await expect(page.locator(".locations li")).toHaveCount(1);
  for (const width of [280, 320, 375, 768, 1280]) {
    await page.setViewportSize({ width, height: 812 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(await page.locator('button,input[type="search"],summary').evaluateAll(elements => elements.every(element => element.getBoundingClientRect().height >= 44))).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 320 });
  const type = page.getByRole("combobox", { name: "Type", exact: true });
  await type.press("End");
  const id = await type.getAttribute("aria-activedescendant");
  await expect(page.locator(`[id="${id}"]`)).toBeInViewport({ ratio: 1 });
});
