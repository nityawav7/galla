import { expect, test } from "@playwright/test";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Galla" })).toBeVisible();
});

test("health check reports ok", async ({ request }) => {
  // Vercel Deployment Protection answers with a redirect to its login page; don't follow it.
  const response = await request.get("/api/health", { maxRedirects: 0 });
  expect(
    response.status(),
    "Redirected or blocked: is Vercel Deployment Protection on without VERCEL_AUTOMATION_BYPASS_SECRET?",
  ).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toMatchObject({ status: "ok", db: "ok" });
});
