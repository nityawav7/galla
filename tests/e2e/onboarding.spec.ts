import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { expectPdf, field, onlyOn, signUp } from "./support";

// Creates accounts and businesses, so never against production.
test.skip(process.env.E2E_ENVIRONMENT === "production", "creates accounts");

/** Runs the 3 onboarding steps and returns the business's dashboard URL. */
async function onboard(page: Page, shopName: string): Promise<string> {
  await expect(page).toHaveURL(/\/onboarding$/);
  const preview = page.getByRole("region", { name: "Invoice preview" });

  // Step 1: details. The preview follows what is typed.
  await field(page, "Registered business name").fill(`${shopName} Pvt Ltd`);
  await field(page, "Shop name (if different)").fill(shopName);
  await field(page, "Address").fill("12 Station Road");
  await field(page, "City or town").fill("Pune");
  await field(page, "PIN code").fill("411001");
  await field(page, "State").selectOption("27");
  await expect(preview.getByText(shopName, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 2: GST. A GSTIN from another state is refused, then the right one is accepted.
  await expect(page.getByRole("radio", { name: /Regular GST/ })).toBeChecked();
  await field(page, "GSTIN").fill("29AAACI1681G1ZL");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("This GSTIN belongs to a different state")).toBeVisible();
  await field(page, "GSTIN").fill("27AAPFU0939F1ZV");
  await expect(preview.getByText("GSTIN: 27AAPFU0939F1ZV")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();

  // Step 3: prefix and UPI.
  await field(page, "Invoice number prefix").fill("SH");
  await expect(preview.getByText(/^SH\/\d{2}-\d{2}\/0001$/)).toBeVisible();
  await field(page, "UPI ID (optional)").fill("shop@oksbi");
  await page.getByRole("button", { name: "Create business" }).click();

  await expect(page).toHaveURL(/\/b\/[a-z0-9-]+\/dashboard$/);
  return new URL(page.url()).pathname;
}

// At 360 px: onboarding is the first thing a shop owner sees, usually on a phone.
test("sign up → onboard → reach the dashboard (SPEC F1)", async ({ page }, testInfo) => {
  onlyOn(testInfo, "mobile");
  // One account walks through onboarding, members, products and customers (sign-ups are
  // rate-limited), so this test runs longer than the 30 s default.
  test.setTimeout(150_000);
  const shopName = `E2E Shop ${randomUUID().slice(0, 6)}`;
  await signUp(page, "E2E Owner");
  await onboard(page, shopName);
  await expect(page.getByText(`Welcome to ${shopName}`)).toBeVisible();

  // Settings are reachable and pre-filled for the owner.
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(field(page, "Shop name (if different)")).toHaveValue(shopName);

  // Invite a member: the link is shown to share, and the invite is listed until cancelled.
  // (Accepting needs the emailed verification code, so the integration tests cover it.)
  await page.getByRole("link", { name: "Members" }).click();
  await expect(page.getByText("E2E Owner (you)")).toBeVisible();
  const inviteeEmail = `e2e-invitee-${randomUUID().slice(0, 8)}@example.com`;
  await field(page, "Email").fill(inviteeEmail);
  await field(page, "Role").selectOption("STAFF");
  await page.getByRole("button", { name: "Send invite" }).click();
  const link = page.getByText(/\/invite\/[0-9a-f-]{36}$/);
  await expect(link).toBeVisible();
  const invitePath = new URL((await link.textContent()) ?? "").pathname;
  const pending = page.getByRole("listitem").filter({ hasText: inviteeEmail });
  await expect(pending).toBeVisible();

  // Someone signed out who opens the link is asked to sign in first.
  const visitor = await page.context().browser()?.newContext();
  if (visitor) {
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(invitePath);
    await expect(visitorPage.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      `/signup?next=${encodeURIComponent(invitePath)}`,
    );
    await visitor.close();
  }

  await pending.getByRole("button", { name: "Cancel invite" }).click();
  await expect(page.getByText("No pending invites.")).toBeVisible();

  // Products (SPEC F2), in the same account: sign-ups are rate-limited (see support.ts).
  await test.step("add a product and find it with a typo", async () => {
    await page.getByRole("link", { name: "Products" }).click();
    await page.getByRole("link", { name: "Add product" }).click();
    await field(page, "Product name").fill("Cement 50 kg");
    await field(page, "Price (₹)").fill("420");
    await field(page, "Unit").selectOption("BAG");
    await field(page, "HSN or SAC code (optional)").fill("2523");
    await field(page, "SKU (optional)").fill("CEM-50");
    await page.getByRole("button", { name: "Add product" }).click();
    await expect(page).toHaveURL(/\/products$/);
    // Next keeps visited pages mounted: opening the form again must start empty.
    await page.getByRole("link", { name: "Add product" }).click();
    await expect(field(page, "Product name")).toHaveValue("");
    await page.getByRole("link", { name: "All products" }).click();
    await field(page, "Search products").fill("cemnt");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("link", { name: /Cement 50 kg/ })).toBeVisible();
  });

  await test.step("import a CSV: a bad row blocks it, the fixed file imports", async () => {
    await page.getByRole("link", { name: "Products" }).click();
    await page.getByRole("link", { name: "Import CSV" }).click();
    const upload = (rows: string[]) =>
      page.getByLabel("CSV file").setInputFiles({
        name: "products.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(
          ["name,hsn_sac,unit,price,gst_rate,price_includes_tax,sku", ...rows].join("\r\n"),
        ),
      });
    const sand = "Sand 1 bag,2505,BAG,90,5,no,SAND";
    const nails = "Nails,7317,KGS,120,18,no,NAIL";
    await upload([sand, "Milk 1 L,0401,LTR,abc,0,yes,", nails]);
    await expect(page.getByText("Line 3 · price:")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import all/ })).toHaveCount(0);

    await upload([sand, "Milk 1 L,0401,LTR,56.50,0,yes,", nails]);
    await expect(page.getByText("3 of 3 rows are ready.")).toBeVisible();
    await page.getByRole("button", { name: "Import all 3 rows" }).click();
    await expect(page.getByText("Imported 3 products.")).toBeVisible();
    await page.getByRole("link", { name: "See the products" }).click();
    for (const name of ["Cement 50 kg", "Milk 1 L", "Nails", "Sand 1 bag"]) {
      await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    }
  });

  // Customers (SPEC F3).
  await test.step("add a customer: the GSTIN fills the state; a shared phone asks first", async () => {
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await page.getByRole("link", { name: "Add customer" }).click();
    await field(page, "Customer name").fill("Ramesh Traders");
    await field(page, "Phone (optional)").fill("98765 43210");
    await field(page, "GSTIN (optional)").fill("29AAACI1681G1ZL");
    await expect(field(page, "Billing state")).toHaveValue("29");
    await field(page, "Amount (₹)").fill("1500");
    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByRole("link", { name: /Ramesh Traders/ })).toBeVisible();
    await expect(page.getByText("Owes ₹1,500.00")).toBeVisible();

    await page.getByRole("link", { name: "Add customer" }).click();
    await field(page, "Customer name").fill("Ramesh Junior");
    await field(page, "Phone (optional)").fill("9876543210");
    await page.getByRole("button", { name: "Add customer" }).click();
    await expect(page.getByText("Someone already has this phone number")).toBeVisible();
    await page.getByRole("button", { name: "Save anyway" }).click();
    await expect(page).toHaveURL(/\/customers$/);
    await expect(page.getByRole("link", { name: /Ramesh Junior/ })).toBeVisible();
  });

  // Invoices (SPEC F4 AC): 3 lines, totals to the paisa as tests/fixtures/invoices/11.
  await test.step("build and issue a 3-line invoice that matches fixture 11", async () => {
    await page.getByRole("link", { name: "Invoices", exact: true }).click();
    await page.getByRole("link", { name: "New invoice" }).click();

    await page.getByRole("button", { name: "Choose customer" }).click();
    await field(page, "Search customers").fill("Ramesh Traders");
    await page.getByRole("button", { name: /Ramesh Traders/ }).click();
    await expect(page.getByTestId("tax-mode")).toHaveText("Inter-state: IGST");

    const addProduct = async (search: string, name: RegExp) => {
      await page.getByRole("button", { name: "Add item" }).click();
      await field(page, "Search products").fill(search);
      await page.getByRole("button", { name }).click();
    };
    // 1. A product with a discount before tax.
    await addProduct("Cement", /^Cement 50 kg/);
    const cement = page.getByRole("listitem", { name: "Item 1" });
    await cement.getByLabel("Discount (before tax, ₹)").fill("20");
    await expect(page.getByTestId("line-total-0")).toHaveText("₹472.00");
    // 2. A fractional quantity.
    await addProduct("Nails", /^Nails/);
    await page.getByRole("listitem", { name: "Item 2" }).getByLabel("Qty").fill("1.5");
    await expect(page.getByTestId("line-total-1")).toHaveText("₹212.40");
    // 3. A one-off item whose price includes GST.
    await page.getByRole("button", { name: "Add item" }).click();
    await field(page, "Search products").fill("Paint 1 L");
    await page.getByRole("button", { name: "Add “Paint 1 L” as a one-off item" }).click();
    const paint = page.getByRole("listitem", { name: "Item 3" });
    await paint.getByLabel("HSN/SAC").fill("3208");
    await paint.getByLabel("Price (₹)").fill("590");
    await paint.getByLabel("Price includes GST").check();
    await expect(page.getByTestId("line-total-2")).toHaveText("₹590.00");
    await expect(page.getByTestId("grand-total")).toHaveText("Total ₹1,274.00");

    await page.getByRole("button", { name: "Issue invoice" }).click();
    const issued = page.getByRole("dialog");
    await expect(
      issued.getByRole("heading", { name: /^Invoice SH\/\d{2}-\d{2}\/0001 issued$/ }),
    ).toBeVisible();
    // SPEC F5: the issued sheet offers the PDF straight away.
    const download = issued.getByRole("link", { name: "Download PDF" });
    await expect(download).toHaveAttribute(
      "href",
      /\/invoices\/[0-9a-f-]{36}\/pdf\?format=a4&download=1$/,
    );
    await expectPdf(page, (await download.getAttribute("href")) ?? "");
    await issued.getByRole("link", { name: "View invoice" }).click();
    await expect(page.getByTestId("invoice-total")).toHaveText("₹1,274.00");
    // The 80 mm slip for a thermal printer: Print opens it in a new tab.
    await field(page, "Paper size").selectOption("80mm");
    const print = page.getByRole("link", { name: /^Print/ });
    await expect(print).toHaveAttribute("href", /\/pdf\?format=80mm$/);
    await expect(print).toHaveAttribute("target", "_blank");
    await expectPdf(page, (await print.getAttribute("href")) ?? "");
    await expect(page.getByText("Rupees One Thousand Two Hundred Seventy Four Only")).toBeVisible();

    await page.getByRole("link", { name: "Back to invoices" }).click();
    await expect(page.getByRole("link", { name: /SH\/\d{2}-\d{2}\/0001/ })).toBeVisible();
  });

  // Credit notes (SPEC §4.8, ADR 0007): return the cement; the balance drops by its ₹472.00.
  await test.step("credit a returned item; the invoice can no longer be cancelled", async () => {
    await page.getByRole("link", { name: /SH\/\d{2}-\d{2}\/0001/ }).click();
    await expect(page.getByRole("button", { name: "Cancel invoice" })).toBeVisible();
    await page.getByRole("link", { name: "Issue credit note" }).click();
    await page.getByLabel("Quantity returned of Cement 50 kg").fill("1");
    await expect(page.getByTestId("credit-total")).toHaveText("₹472.00");
    await page.getByRole("button", { name: "Goods returned" }).click();
    await page.getByRole("button", { name: "Issue credit note" }).click();

    await expect(page.getByText(/^CN\/\d{2}-\d{2}\/0001$/)).toBeVisible();
    await expect(page.getByTestId("credit-note-total")).toHaveText("₹472.00");
    await expectPdf(
      page,
      (await page.getByRole("link", { name: "Download PDF" }).getAttribute("href")) ?? "",
    );
    await page.getByRole("link", { name: /^Back to invoice/ }).click();
    await expect(page.getByTestId("invoice-balance")).toHaveText("₹802.00");
    await expect(page.getByRole("button", { name: "Cancel invoice" })).toHaveCount(0);
  });
});

test("a user with no membership gets 404 for another business (SPEC F1)", async ({
  browser,
}, testInfo) => {
  onlyOn(testInfo, "desktop");
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await signUp(owner, "E2E Owner");
  const dashboard = await onboard(owner, `E2E Private ${randomUUID().slice(0, 6)}`);
  const slug = dashboard.split("/")[2] ?? "";
  // A draft invoice, so an invoice page can be tried as the stranger too.
  await owner.goto(`/b/${slug}/invoices/new`);
  await field(owner, "Walk-in customer name (optional)").fill("Counter sale");
  await expect(owner).toHaveURL(/\/invoices\/[0-9a-f-]{36}\/edit$/, { timeout: 15_000 });
  const draftPath = new URL(owner.url()).pathname;
  await ownerContext.close();

  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await signUp(stranger, "E2E Stranger");

  for (const path of [dashboard, `/b/${slug}/settings`, `/b/${slug}`, draftPath]) {
    const response = await stranger.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(stranger.getByRole("heading", { name: "Page not found" })).toBeVisible();
  }
  // The draft's PDF route answers 404 too (SPEC F5: tenant-scoped).
  const pdfPath = draftPath.replace(/\/edit$/, "/pdf");
  expect((await stranger.request.get(pdfPath)).status(), pdfPath).toBe(404);
  // A slug nobody has looks exactly the same.
  const missing = await stranger.goto(`/b/no-such-shop-${randomUUID().slice(0, 6)}/dashboard`);
  expect(missing?.status()).toBe(404);
  await strangerContext.close();
});
