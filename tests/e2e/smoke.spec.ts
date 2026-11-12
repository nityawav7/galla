import { expect, test } from "@playwright/test";

import { watchCsp } from "./support";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Galla" })).toBeVisible();
});

test("pages carry the security headers and run under the CSP (SPEC §6.2)", async ({ page }) => {
  const violations = watchCsp(page);
  const response = await page.goto("/login");
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"]).toMatch(
    /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/,
  );
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["strict-transport-security"]).toContain("max-age=");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["x-request-id"]).toBeTruthy();
  // The page's own scripts ran: the form is interactive (the tabs switch).
  const codeTab = page.getByRole("tab", { name: "Email code" });
  await codeTab.click();
  await expect(codeTab).toHaveAttribute("aria-selected", "true");
  expect(violations).toEqual([]);
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
