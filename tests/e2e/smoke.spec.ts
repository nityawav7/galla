import { expect, test } from "@playwright/test";

import { expectAccessible, watchCsp } from "./support";

test("the landing page says what Galla does and offers the demo (Phase 12c)", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: /GST bills in under a minute/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Try as the owner" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a free account" })).toHaveAttribute(
    "href",
    "/signup",
  );
  for (const name of [
    "The dashboard: sales, GST and money to collect",
    "What your customer sees",
  ]) {
    await expect(page.getByRole("img", { name })).toBeVisible();
  }
  await page.getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.getByText("not been reviewed by a lawyer")).toBeVisible();
  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Terms" })).toBeVisible();
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

test("the public pages have no serious accessibility issues (Phase 11c)", async ({ page }) => {
  for (const [path, heading] of [
    ["/", "GST bills in under a minute. Know who owes you what."],
    ["/privacy", "Privacy"],
    ["/terms", "Terms"],
    ["/login", "Sign in"],
    ["/signup", "Create your account"],
    ["/forgot-password", null],
  ] as const) {
    await page.goto(path);
    if (heading) await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expectAccessible(page, path);
  }
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
