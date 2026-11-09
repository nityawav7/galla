import { randomUUID } from "node:crypto";

import { expect, type Page, type TestInfo } from "@playwright/test";

/**
 * The visible input labelled exactly `label`. Tab panels are labelled "Password" too, and
 * Next keeps pages visited earlier mounted but hidden, so their inputs are still in the DOM.
 */
export const field = (page: Page, label: string) =>
  page
    .locator("input, select")
    .and(page.getByLabel(label, { exact: true }))
    .filter({ visible: true });

/**
 * Sign-ups are limited to 5 per minute per IP (SPEC §6.2) and a whole e2e run comes from one
 * IP, so each account-creating test runs in one browser size only. Budget: 4 per run.
 */
export function onlyOn(testInfo: TestInfo, project: "desktop" | "mobile"): void {
  if (testInfo.project.name !== project) testInfo.skip(true, "saves the sign-up rate limit");
}

export async function signUp(
  page: Page,
  name: string,
): Promise<{ email: string; password: string }> {
  const email = `e2e-${randomUUID()}@example.com`;
  const password = `e2e-${randomUUID()}`;
  await page.goto("/signup");
  await field(page, "Your name").fill(name);
  await field(page, "Email").fill(email);
  await field(page, "Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  // The first sign-up of a local run waits for the dev server to compile the next pages.
  await page.waitForURL((url) => !url.pathname.endsWith("/signup"), { timeout: 30_000 });
  return { email, password };
}

/** Fetches a PDF route with the page's session and checks it really is a PDF (SPEC F5). */
export async function expectPdf(page: Page, href: string): Promise<void> {
  const response = await page.request.get(href);
  expect(response.status(), href).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect((await response.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");
}
