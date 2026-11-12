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
    // ...and the customer's link (SPEC F5).
    await expect(issued.getByTestId("public-link")).toHaveValue(/\/i\/[A-Za-z0-9_-]{22}$/);
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

  // SPEC F5: the customer opens the link without an account and pays the balance by UPI; the
  // owner can turn the link off and make a new one. Runs after the credit note: ₹802.00 is due.
  await test.step("share the public link; pay by UPI; turn the link off and on", async () => {
    // Next keeps pages visited earlier mounted but hidden: use the visible field.
    const publicLink = () => page.getByTestId("public-link").filter({ visible: true });
    const shared = new URL(await publicLink().inputValue()).pathname;
    expect(shared).toMatch(/^\/i\/[A-Za-z0-9_-]{22}$/);
    const visitor = await page
      .context()
      .browser()
      ?.newContext({
        viewport: { width: 360, height: 740 },
      });
    if (!visitor) throw new Error("no browser");
    const customer = await visitor.newPage();

    const response = await customer.goto(shared);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await expect(customer.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(customer.getByTestId("amount-due")).toHaveText("₹802.00");
    await expect(customer.getByRole("link", { name: "Pay ₹802.00 via UPI" })).toHaveAttribute(
      "href",
      /^upi:\/\/pay\?pa=shop@oksbi&pn=E2E%20Shop%20[0-9a-f]{6}&am=802\.00&cu=INR&tn=SH%2F\d{2}-\d{2}%2F0001$/,
    );
    await expect(
      customer.getByRole("img", { name: "UPI QR code to pay ₹802.00 to shop@oksbi" }),
    ).toBeVisible();
    await expectPdf(customer, `${shared}/pdf?download=1`);

    // Turned off: the customer gets 404, for the page and the PDF.
    await page.getByRole("button", { name: "Turn off link" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByText(/The link is turned off/)).toBeVisible();
    expect((await customer.reload())?.status()).toBe(404);
    expect((await customer.request.get(`${shared}/pdf`)).status()).toBe(404);

    // A new link works; the old one stays dead.
    await page.getByRole("button", { name: "Turn on with a new link" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Make new link" }).click();
    await expect(publicLink()).toBeVisible();
    const fresh = new URL(await publicLink().inputValue()).pathname;
    expect(fresh).not.toBe(shared);
    expect((await customer.goto(fresh))?.status()).toBe(200);
    expect((await customer.goto(shared))?.status()).toBe(404);
    await visitor.close();
  });

  // SPEC F6: the owner edits the English message in settings; the invoice's "Share on WhatsApp"
  // opens wa.me with the customer's number and that message, correctly encoded.
  await test.step("edit the WhatsApp message and share the invoice on WhatsApp", async () => {
    const invoicePath = new URL(page.url()).pathname;
    const link = await page.getByTestId("public-link").filter({ visible: true }).inputValue();
    await page.getByRole("link", { name: "Settings" }).click();
    const english = page
      .getByRole("textbox", { name: "Message in English" })
      .filter({ visible: true });
    await english.fill(`${await english.inputValue()}\nSee you again soon!`);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved")).toBeVisible();

    await page.goto(invoicePath);
    const share = page.getByRole("link", { name: /^Share on WhatsApp/ }).filter({ visible: true });
    await expect(share).toHaveAttribute("href", /^https:\/\/wa\.me\/919876543210\?text=/);
    const englishText = new URL((await share.getAttribute("href")) ?? "").searchParams.get("text");
    expect(englishText).toMatch(
      /^Namaste Ramesh Traders,\nYour invoice SH\/\d{2}-\d{2}\/0001 from E2E Shop [0-9a-f]{6} is for ₹802\.00, due /,
    );
    expect(englishText).toContain(`View, download or pay by UPI: ${link}`);
    expect(englishText).toMatch(/See you again soon!$/);

    await page.getByRole("radio", { name: "हिन्दी" }).filter({ visible: true }).check();
    await expect(share).toHaveAttribute("href", /text=%E0%A4%A8%E0%A4%AE/);
    const hindi = new URL((await share.getAttribute("href")) ?? "").searchParams.get("text");
    expect(hindi).toMatch(/^नमस्ते Ramesh Traders,/);
    expect(hindi).toContain(link);
  });

  // SPEC F7: a part payment from the invoice, the rest oldest first from the payments page (the
  // excess stays on account), then the owner voids the second payment. ₹802.00 is due.
  await test.step("record payments; the invoice is part paid, paid, then part paid again", async () => {
    const invoicePath = new URL(page.url()).pathname;
    await page.getByRole("link", { name: "Record payment" }).filter({ visible: true }).click();
    const amount = field(page, "Amount received (₹)");
    await expect(amount).toHaveValue("802");
    await amount.fill("300");
    // The mode chips are labels around visually hidden radios: tap the chip.
    await page.locator("label").filter({ hasText: /^UPI$/, visible: true }).click();
    await expect(page.getByRole("radio", { name: "UPI" }).filter({ visible: true })).toBeChecked();
    await field(page, "UTR or reference (optional)").fill("UTR123456");
    const preview = page.getByTestId("payment-preview").filter({ visible: true });
    await expect(preview).toContainText(/SH\/\d{2}-\d{2}\/0001₹300\.00/);
    await expect(preview).toContainText("On account₹0.00");
    await page.getByRole("button", { name: "Save payment" }).filter({ visible: true }).click();
    await expect(
      page.getByRole("heading", { name: "Payment recorded" }).filter({ visible: true }),
    ).toBeVisible();
    await expect(page.getByTestId("payment-result").filter({ visible: true })).toContainText(
      "Part paid · ₹502.00 due",
    );
    await page.getByRole("link", { name: "Done" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`${invoicePath}$`));
    await expect(page.getByTestId("invoice-balance").filter({ visible: true })).toHaveText(
      "₹502.00",
    );
    await expect(page.getByTestId("invoice-payments").filter({ visible: true })).toContainText(
      "UPI",
    );

    // From the payments page: pick the customer and pay ₹2,100 oldest first: the ₹1,500 opening
    // balance, then the invoice's ₹502; ₹98 stays on account.
    // The invoice page has a "Record payment" link too: wait until it has been swapped out, or
    // the click can latch onto it just before Next hides it.
    await page.getByRole("link", { name: "Payments", exact: true }).click();
    await expect(page).toHaveURL(/\/payments$/);
    await page.getByRole("link", { name: "Record payment" }).filter({ visible: true }).click();
    await field(page, "Who paid?").fill("Ramesh Traders");
    await page.getByRole("button", { name: "Search" }).filter({ visible: true }).click();
    await page.getByRole("link", { name: "Ramesh Traders", exact: true }).click();
    await expect(page).toHaveURL(/\/payments\/new\?customer=/);
    await field(page, "Amount received (₹)").fill("2100");
    await page.getByRole("radio", { name: "Oldest dues first (automatic)" }).check();
    const oldestFirst = page.getByTestId("payment-preview").filter({ visible: true });
    await expect(oldestFirst).toContainText("Opening balance₹1,500.00");
    await expect(oldestFirst).toContainText(/SH\/\d{2}-\d{2}\/0001₹502\.00/);
    await expect(oldestFirst).toContainText("On account₹98.00");
    await page.getByRole("button", { name: "Save payment" }).filter({ visible: true }).click();
    await expect(page.getByTestId("payment-result").filter({ visible: true })).toContainText(
      "Paid · ₹0.00 due",
    );
    await expect(
      page.getByText("₹98.00 is kept on account").filter({ visible: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Done" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/payments\?customer=/);

    // The owner voids the ₹2,100: the invoice is due again, the payment stays listed.
    const list = page.getByTestId("payment-list").filter({ visible: true });
    await expect(list.getByRole("listitem").filter({ hasText: "₹2,100.00" })).toHaveCount(1);
    await list
      .getByRole("listitem")
      .filter({ hasText: "₹2,100.00" })
      .getByRole("button", { name: "Void" })
      .click();
    await page.getByRole("button", { name: "Cheque bounced" }).click();
    await page.getByRole("button", { name: "Void payment" }).click();
    await expect(list).toContainText("Voided: Cheque bounced");
    await page.goto(invoicePath);
    await expect(page.getByTestId("invoice-balance").filter({ visible: true })).toHaveText(
      "₹502.00",
    );
    // The customer list shows what they owe now: ₹1,500 + ₹1,274 − ₹472 − ₹300.
    await page.getByRole("link", { name: "Customers", exact: true }).click();
    await expect(
      page.getByRole("link", { name: /^Ramesh Traders/ }).filter({ visible: true }),
    ).toContainText("Owes ₹2,002.00");
  });

  // SPEC F7: the customer page is the ledger: rows with a running balance, aging, the statement
  // PDF, a WhatsApp reminder, and an advance applied to the oldest dues.
  await test.step("the customer page shows the ledger, statement and reminder", async () => {
    await page
      .getByRole("link", { name: /^Ramesh Traders/ })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    const balance = page.getByTestId("customer-balance").filter({ visible: true });
    await expect(balance).toHaveText("Owes you ₹2,002.00");

    // Opening ₹1,500 + invoice ₹1,274 − credit note ₹472 − ₹300 UPI; the voided ₹2,100 is left out.
    const ledger = page.getByTestId("ledger").filter({ visible: true });
    await expect(ledger).toContainText("Opening balance");
    await expect(ledger).toContainText(/Invoice SH\/\d{2}-\d{2}\/0001/);
    await expect(ledger).toContainText("Credit note");
    await expect(ledger).toContainText("Payment · UPI · UTR123456");
    await expect(ledger).not.toContainText("₹2,100.00");
    await expect(ledger.getByRole("listitem").last()).toContainText("₹2,002.00");
    const aging = page.getByTestId("aging").filter({ visible: true });
    await expect(aging).toContainText("0–30 days late₹502.00");
    await expect(aging).toContainText("Opening balance₹1,500.00");

    const statement = page.getByRole("link", { name: /^Statement PDF/ }).filter({ visible: true });
    const statementResponse = await page.request.get((await statement.getAttribute("href")) ?? "");
    expect(statementResponse.status()).toBe(200);
    expect(statementResponse.headers()["content-type"]).toBe("application/pdf");

    await page.getByText("Send reminder", { exact: true }).filter({ visible: true }).click();
    const whatsapp = page
      .getByRole("link", { name: /^Share on WhatsApp/ })
      .filter({ visible: true });
    await expect(whatsapp).toHaveAttribute("href", /^https:\/\/wa\.me\/919876543210\?text=/);
    const reminder = new URL((await whatsapp.getAttribute("href")) ?? "").searchParams.get("text");
    expect(reminder).toMatch(
      /^Namaste Ramesh Traders,\nThis is a reminder from E2E Shop [0-9a-f]{6}: ₹2,002\.00 is due\./,
    );
    expect(reminder).toContain("Earlier balance · ₹1,500.00");

    // ₹600 to the invoice only: ₹502 pays it, ₹98 stays on account, then goes to the opening
    // balance with "Apply advance".
    const customerPath = new URL(page.url()).pathname;
    await page.getByRole("link", { name: "Record payment" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/payments\/new\?customer=[0-9a-f-]{36}&back=customer$/);
    await field(page, "Amount received (₹)").fill("600");
    await page.getByRole("radio", { name: "Choose invoices" }).check();
    await page.getByRole("button", { name: "Full" }).nth(1).click();
    await expect(page.getByTestId("payment-preview").filter({ visible: true })).toContainText(
      "On account₹98.00",
    );
    await page.getByRole("button", { name: "Save payment" }).filter({ visible: true }).click();
    await page.getByRole("link", { name: "Done" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`${customerPath}$`));
    await page.getByRole("button", { name: "Apply advance" }).click();
    await expect(page.getByText("₹98.00 applied to the oldest dues.")).toBeVisible();
    await expect(balance).toHaveText("Owes you ₹1,402.00");

    await page.getByRole("link", { name: "Edit", exact: true }).filter({ visible: true }).click();
    await expect(page).toHaveURL(new RegExp(`${customerPath}/edit$`));
    await expect(field(page, "Customer name")).toHaveValue("Ramesh Traders");
  });

  // ADR 0011: a credit note on the paid invoice moves what was overpaid to the customer's
  // advance; the owner then refunds it in cash, and the balance is back where it was.
  await test.step("credit a paid invoice: the money goes to the advance, then is refunded", async () => {
    await page.getByRole("link", { name: "Back to customer" }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}$/);
    const customerPath = new URL(page.url()).pathname;
    const balance = page.getByTestId("customer-balance").filter({ visible: true });
    await expect(balance).toHaveText("Owes you ₹1,402.00");
    await page
      .getByTestId("ledger")
      .filter({ visible: true })
      .getByRole("link", { name: /^Invoice SH\// })
      .click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}$/);
    await page.getByRole("link", { name: "Issue credit note" }).filter({ visible: true }).click();
    await field(page, "Quantity returned of Nails").fill("1");
    const total = page.getByTestId("credit-total").filter({ visible: true });
    await expect(total).not.toHaveText("₹0.00");
    const credited = (await total.textContent()) ?? "";
    await expect(page.getByTestId("credit-released").filter({ visible: true })).toHaveText(
      `${credited} of what was paid goes to the customer's advance.`,
    );
    await page.getByRole("button", { name: "Goods returned" }).filter({ visible: true }).click();
    await page.getByRole("button", { name: "Issue credit note" }).filter({ visible: true }).click();
    await expect(page.getByText(/^CN\/\d{2}-\d{2}\/0002$/)).toBeVisible();

    await page.goto(customerPath);
    await expect(balance).not.toHaveText("Owes you ₹1,402.00");
    await expect(page.getByTestId("ledger").filter({ visible: true })).toContainText(
      /Credit note CN\/\d{2}-\d{2}\/0002/,
    );
    await page.getByText("Refund advance", { exact: true }).filter({ visible: true }).click();
    await expect(field(page, "Amount to give back (₹)")).toHaveValue(
      credited.replace(/[₹,]/g, "").replace(/\.00$/, ""),
    );
    await page.getByRole("button", { name: "Record refund" }).click();
    await expect(page.getByTestId("refund-list").filter({ visible: true })).toContainText(credited);
    await expect(balance).toHaveText("Owes you ₹1,402.00");
    await expect(page.getByTestId("ledger").filter({ visible: true })).toContainText(
      "Refund · Cash",
    );
  });

  // SPEC F8: the dashboard adds up the day.
  await test.step("the dashboard shows today's sales and what is still to collect", async () => {
    await page.getByRole("link", { name: "Dashboard", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    // ₹1,274.00 invoiced today, less the ₹472.00 and ₹141.60 credited back.
    await expect(page.getByTestId("card-today").filter({ visible: true })).toHaveText("₹660.40");
    await expect(page.getByTestId("card-receivable").filter({ visible: true })).toHaveText(
      "₹1,402.00",
    );
    await expect(page.getByTestId("top-debtors").filter({ visible: true })).toContainText(
      "Ramesh Traders",
    );
    await expect(page.getByTestId("top-products").filter({ visible: true })).toContainText(
      "Paint 1 L",
    );
  });

  // SPEC F8: the owner's reports for this month, on screen and as files.
  await test.step("reports: the sales register and HSN summary download", async () => {
    await page.getByRole("link", { name: "Reports", exact: true }).click();
    await expect(page).toHaveURL(/\/reports$/);
    // One invoice and two credit notes so far.
    const summary = page.getByTestId("register-summary").filter({ visible: true });
    await expect(summary).toContainText("Invoices1");
    await expect(summary).toContainText("Credit notes2");
    await expect(summary).toContainText("Net total₹660.40");
    await expect(page.getByTestId("hsn-summary").filter({ visible: true })).toContainText("3208");

    const csvLink = page.getByRole("link", { name: "Download CSV" }).first();
    const csv = await page.request.get((await csvLink.getAttribute("href")) ?? "");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toBe("text/csv; charset=utf-8");
    expect(await csv.text()).toMatch(/Invoice,SH\/\d{2}-\d{2}\/0001,,Ramesh Traders/);
    const excel = await page.request.get(
      (await page.getByRole("link", { name: "Download Excel" }).getAttribute("href")) ?? "",
    );
    expect(excel.status()).toBe(200);
    expect(excel.headers()["content-type"]).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
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
  // A customer, so their page and statement can be tried too.
  await owner.goto(`/b/${slug}/customers/new`);
  await field(owner, "Customer name").fill("Private Customer");
  await owner.getByRole("button", { name: "Add customer" }).click();
  await expect(owner).toHaveURL(/\/customers$/);
  const customerPath =
    (await owner.getByRole("link", { name: /^Private Customer/ }).getAttribute("href")) ?? "";
  await ownerContext.close();

  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await signUp(stranger, "E2E Stranger");

  for (const path of [
    dashboard,
    `/b/${slug}/settings`,
    `/b/${slug}`,
    draftPath,
    `/b/${slug}/payments`,
    `/b/${slug}/payments/new`,
    customerPath,
    `${customerPath}/edit`,
    `/b/${slug}/reports`,
  ]) {
    const response = await stranger.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(stranger.getByRole("heading", { name: "Page not found" })).toBeVisible();
  }
  // The draft's PDF route answers 404 too (SPEC F5: tenant-scoped).
  const pdfPath = draftPath.replace(/\/edit$/, "/pdf");
  expect((await stranger.request.get(pdfPath)).status(), pdfPath).toBe(404);
  const statementPath = `${customerPath}/statement`;
  expect((await stranger.request.get(statementPath)).status(), statementPath).toBe(404);
  const registerPath = `/b/${slug}/reports/sales-register?format=csv`;
  expect((await stranger.request.get(registerPath)).status(), registerPath).toBe(404);
  // An invoice link that was never issued is a plain 404 too, with no sign-in needed.
  const unknownLink = await stranger.goto("/i/AAAAAAAAAAAAAAAAAAAAAA");
  expect(unknownLink?.status()).toBe(404);
  // A slug nobody has looks exactly the same.
  const missing = await stranger.goto(`/b/no-such-shop-${randomUUID().slice(0, 6)}/dashboard`);
  expect(missing?.status()).toBe(404);
  await strangerContext.close();
});
