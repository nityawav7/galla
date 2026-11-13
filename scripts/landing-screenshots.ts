/**
 * The landing page's screenshots (public/landing/*.jpg), taken from the demo shop at phone size
 * (390 × 844 at 2×) so they show the real app and can be made again after a UI change.
 *
 *   pnpm build && pnpm start      (another terminal; the demo seeded: pnpm db:seed:demo)
 *   pnpm landing:screenshots [base URL, default http://localhost:3000]
 */
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://localhost:3000";
const out = (name: string) => `public/landing/${name}.jpg`;

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    baseURL: base,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByRole("button", { name: "Try as the owner" }).click();
  await page.waitForURL(/\/b\/demo-sharma-hardware\/dashboard$/, { timeout: 60_000 });
  await page.getByText("Welcome to Sharma Hardware").waitFor();
  await page.screenshot({ path: out("dashboard"), type: "jpeg", quality: 80 });

  await page.goto("/b/demo-sharma-hardware/invoices?status=UNPAID");
  await page
    .getByRole("link", { name: /SH\/\d{2}-\d{2}\/\d{4}/ })
    .first()
    .click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]{36}$/);
  await page.getByTestId("invoice-total").first().waitFor();
  await page.screenshot({ path: out("invoice"), type: "jpeg", quality: 80 });

  const link = await page.getByTestId("public-link").first().inputValue();
  const customer = await context.newPage();
  await customer.goto(new URL(link).pathname);
  await customer.getByTestId("sample-invoice").waitFor();
  await customer.screenshot({ path: out("public"), type: "jpeg", quality: 80 });
  console.log("Saved public/landing/dashboard.jpg, invoice.jpg and public.jpg");
} finally {
  await browser.close();
}
