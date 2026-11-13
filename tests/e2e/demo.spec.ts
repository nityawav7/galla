import { expect, test } from "@playwright/test";

/**
 * SPEC F12: "Try the demo" without signing up. Needs the demo shop in the database
 * (`pnpm db:seed:demo`, a CI step). Deployments get theirs from the 04:00 IST reset, so this
 * runs against local and CI servers only.
 */
test.skip(Boolean(process.env.PLAYWRIGHT_BASE_URL), "deployments build their demo by cron");

const DASHBOARD = /\/b\/demo-sharma-hardware\/dashboard$/;

test("a visitor tries the demo as staff: a real-looking shop, clearly marked", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try as staff" }).click();
  await expect(page).toHaveURL(DASHBOARD, { timeout: 30_000 });
  await expect(page.getByTestId("demo-banner")).toContainText("Demo data — resets daily");
  await expect(page.getByText("Welcome to Sharma Hardware")).toBeVisible();
  // Staff don't see the owner's and accountant's pages.
  await expect(page.getByRole("link", { name: "Activity", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Invoices", exact: true }).click();
  await expect(page.getByText(/SH\/\d{2}-\d{2}\/\d{4}/).first()).toBeVisible();
});

test("the demo owner can't change the shop, and its invoices say they are samples", async ({
  page,
  context,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try as the owner" }).click();
  await expect(page).toHaveURL(DASHBOARD, { timeout: 30_000 });

  await page.goto("/b/demo-sharma-hardware/settings");
  await expect(
    page.getByText("This is the demo shop: its settings can't be changed"),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await page.goto("/b/demo-sharma-hardware/members");
  await expect(page.getByText("members can't be invited, changed or removed")).toBeVisible();

  await page.goto("/b/demo-sharma-hardware/invoices?status=UNPAID");
  await page
    .getByRole("link", { name: /SH\/\d{2}-\d{2}\/\d{4}/ })
    .first()
    .click();
  const link = await page.getByTestId("public-link").filter({ visible: true }).inputValue();
  const customer = await context.browser()?.newPage();
  if (!customer) throw new Error("no browser");
  await customer.goto(new URL(link).pathname);
  await expect(customer.getByTestId("sample-invoice")).toContainText("not a real bill");
  await expect(customer.getByRole("link", { name: /Pay .* via UPI/ })).toHaveCount(0);
  await customer.close();
});
