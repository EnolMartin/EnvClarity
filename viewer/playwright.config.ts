import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = "http://127.0.0.1:4174";

export default defineConfig({
  testDir: "./test",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: true,
  workers: process.env.CI ? 1 : 2,
  retries: 0,
  timeout: 20_000,
  globalTimeout: 120_000,
  expect: { timeout: 5_000 },
  reporter: "list",
  use: {
    browserName: "chromium",
    baseURL,
    serviceWorkers: "block",
    trace: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "pnpm exec vite preview viewer --config viewer/vite.config.ts --port 4174",
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
