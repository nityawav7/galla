import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { onlyOn, field, signUp } from "./support";

// These tests create accounts, so they never run against production (e2e-deployed.yml sets
// E2E_ENVIRONMENT from Vercel's deployment event). Locally, in CI and on previews they do.
test.skip(process.env.E2E_ENVIRONMENT === "production", "creates accounts");

test("signed-out visitors are sent to sign in", async ({ page }) => {
  await page.goto("/b");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("sign up, sign out, sign back in with the password", async ({ page }, testInfo) => {
  onlyOn(testInfo, "desktop");
  const { email, password } = await signUp(page, "E2E Owner");
  // A brand-new account has no business yet.
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await field(page, "Email").fill(email);
  await field(page, "Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test("a wrong password shows an error and stays signed out", async ({ page }) => {
  await page.goto("/login");
  await field(page, "Email").fill(`e2e-${randomUUID()}@example.com`);
  await field(page, "Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Email or password is incorrect")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
