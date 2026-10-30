import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);
// Set PLAYWRIGHT_BASE_URL to run against a deployment instead of a local server. Vercel's
// dispatch payload may give a bare host ("galla-abc.vercel.app"), so add https:// if missing.
// GitHub passes an empty string when the value is absent, so treat "" as unset.
const rawExternalURL = process.env.PLAYWRIGHT_BASE_URL?.trim();
const externalBaseURL = rawExternalURL
  ? /^https?:\/\//.test(rawExternalURL)
    ? rawExternalURL
    : `https://${rawExternalURL}`
  : undefined;
const baseURL = externalBaseURL ?? "http://localhost:3000";
// Lets CI reach Vercel previews that have Deployment Protection enabled.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    extraHTTPHeaders: bypassSecret ? { "x-vercel-protection-bypass": bypassSecret } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    // SPEC §6.1: usable at 360 px wide.
    { name: "mobile", use: { ...devices["Pixel 7"], viewport: { width: 360, height: 780 } } },
  ],
  webServer: externalBaseURL
    ? undefined
    : {
        command: isCI ? "pnpm start" : "pnpm dev",
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
});
