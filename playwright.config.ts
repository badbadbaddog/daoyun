import { defineConfig, devices } from "@playwright/test"

import { resolveChromiumExecutable } from "./e2e/browser-runtime"

const baseURL = process.env.DAOYUN_WEB_URL ?? "http://127.0.0.1:4173"
const chromiumExecutable = resolveChromiumExecutable()

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  testIgnore: process.env.DAOYUN_LOCAL_E2E === "1" ? [] : ["**/local-business-flow.spec.ts"],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: process.env.DAOYUN_LOCAL_E2E === "1" ? 1 : undefined,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL,
    launchOptions: chromiumExecutable
      ? {
          executablePath: chromiumExecutable,
          args: ["--no-sandbox"],
        }
      : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: process.env.DAOYUN_WEB_URL
    ? undefined
    : {
        command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4173",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
})
