import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

// These tests create accounts, so they never run against production (e2e-deployed.yml sets
// E2E_ENVIRONMENT from Vercel's deployment event). Locally, in CI and on previews they do.
test.skip(process.env.E2E_ENVIRONMENT === "production", "creates accounts");

/**
 * The visible input labelled exactly `label`. Tab panels are labelled "Password" too, and
 * Next keeps pages visited earlier mounted but hidden, so their inputs are still in the DOM.
 */
const field = (page: Page, label: string) =>
  page
    .locator("input")
    .and(page.getByLabel(label, { exact: true }))
    .filter({ visible: true });

const password = `e2e-${randomUUID()}`;

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/b");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("sign up, sign out, sign back in with the password", async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.com`;

  await page.goto("/signup");
  await field(page, "Your name").fill("E2E Owner");
  await field(page, "Email").fill(email);
  await field(page, "Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/b$/);
  await expect(page.getByText("Signed in as E2E Owner")).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await field(page, "Email").fill(email);
  await field(page, "Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Signed in as E2E Owner")).toBeVisible();
});

test("a wrong password shows an error and stays signed out", async ({ page }) => {
  await page.goto("/login");
  await field(page, "Email").fill(`e2e-${randomUUID()}@example.com`);
  await field(page, "Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
