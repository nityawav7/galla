import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMPTY_DRAFT } from "@/lib/validation/invoices";
import { closeDb, getDb } from "@/server/db/client";
import { isImmutableViolation } from "@/server/db/errors";
import {
  businesses,
  creditNoteLines,
  creditNotes,
  customers,
  invoiceLines,
  invoices,
  numberSequences,
  paymentAllocations,
  payments,
  products,
  remindersSent,
  type SupplierSnapshot,
} from "@/server/db/schema";

import { expectViolation } from "../support/db-errors";
import { createTenant, type Tenant, uniqueSlug } from "../support/tenants";

// The database is the last line of defence (SPEC §7.4): each test feeds it one bad value.

type InvoiceInsert = typeof invoices.$inferInsert;
type LineInsert = typeof invoiceLines.$inferInsert;

const db = () => getDb();

let shop: Tenant;
let lastNumber = 1000;
let otherShop: Tenant;

beforeAll(async () => {
  shop = await createTenant();
  otherShop = await createTenant();
});

afterAll(async () => {
  await closeDb();
});

function businessRow(overrides: Partial<typeof businesses.$inferInsert> = {}) {
  return {
    slug: uniqueSlug(),
    legalName: "Constraint Co",
    gstScheme: "REGULAR" as const,
    gstin: "27AAPFU0939F1ZV",
    stateCode: "27",
    ...overrides,
  };
}

function draftInvoice(overrides: Partial<InvoiceInsert> = {}): InvoiceInsert {
  return {
    businessId: shop.business.id,
    type: "TAX_INVOICE",
    invoiceDate: "2026-11-02",
    placeOfSupplyStateCode: "27",
    isInterState: false,
    draft: EMPTY_DRAFT,
    ...overrides,
  };
}

const SUPPLIER: SupplierSnapshot = {
  legalName: "Test Traders",
  tradeName: null,
  gstin: "27AAPFU0939F1ZV",
  gstScheme: "REGULAR",
  stateCode: "27",
  address: { line1: null, line2: null, city: null, pincode: null, stateCode: "27" },
  phoneE164: null,
  email: null,
  logoUrl: null,
  signatureUrl: null,
};

/** ₹100 @ 18% intra-state, issued: 100 + 9 + 9 = ₹118. */
function issuedInvoice(overrides: Partial<InvoiceInsert> = {}): InvoiceInsert {
  return draftInvoice({
    status: "ISSUED",
    number: `INV/26-27/${String(++lastNumber)}`,
    fy: "26-27",
    issuedAt: new Date(),
    draft: null,
    supplierSnapshot: SUPPLIER,
    customerSnapshot: {
      name: "Walk-in",
      gstin: null,
      phoneE164: null,
      email: null,
      billing: null,
      shipping: null,
    },
    taxablePaise: 10000n,
    cgstPaise: 900n,
    sgstPaise: 900n,
    grandTotalPaise: 11800n,
    ...overrides,
  });
}

async function insertInvoice(values: InvoiceInsert): Promise<string> {
  const [row] = await db().insert(invoices).values(values).returning({ id: invoices.id });
  if (!row) throw new Error("no row");
  return row.id;
}

function line(invoiceId: string, overrides: Partial<LineInsert> = {}): LineInsert {
  return {
    businessId: shop.business.id,
    invoiceId,
    position: 1,
    description: "Detergent",
    unit: "PCS",
    qtyMilli: 1000n,
    unitPricePaise: 10000n,
    priceIncludesTax: false,
    rateBp: 1800,
    taxablePaise: 10000n,
    cgstPaise: 900n,
    sgstPaise: 900n,
    utgstPaise: 0n,
    igstPaise: 0n,
    lineTotalPaise: 11800n,
    ...overrides,
  };
}

describe("businesses", () => {
  it("accepts a valid registered and a valid unregistered business", async () => {
    await db().insert(businesses).values(businessRow());
    await db()
      .insert(businesses)
      .values(businessRow({ gstScheme: "UNREGISTERED", gstin: null, stateCode: "04" }));
  });

  it.each([
    ["businesses_slug_format", { slug: "Bad Slug" }],
    ["businesses_slug_format", { slug: "-starts-with-hyphen" }],
    ["businesses_gstin_matches_scheme", { gstScheme: "UNREGISTERED" as const }],
    ["businesses_gstin_matches_scheme", { gstScheme: "COMPOSITION" as const, gstin: null }],
    ["businesses_gstin_format", { gstin: "27aapfu0939f1zv" }],
    ["businesses_gstin_state", { gstin: "29AAACI1681G1ZL" }],
    ["businesses_pincode_format", { pincode: "011001" }],
    ["businesses_phone_format", { phoneE164: "9800000001" }],
    ["businesses_invoice_prefix_format", { invoicePrefix: "TOOLONG" }],
    ["businesses_credit_note_prefix_format", { creditNotePrefix: "C/N" }],
    ["businesses_prefixes_differ", { invoicePrefix: "GAL", creditNotePrefix: "gal" }],
    ["businesses_hsn_digits", { hsnDigitsRequired: 8 }],
    ["businesses_locale", { locale: "fr" as "en" }],
    ["businesses_gst_scheme", { gstScheme: "SPECIAL" as "REGULAR" }],
    [
      "businesses_state_code_states_code_fk",
      { stateCode: "99", gstin: null, gstScheme: "UNREGISTERED" as const },
    ],
  ])("%s rejects %o", async (constraint, overrides) => {
    await expectViolation(db().insert(businesses).values(businessRow(overrides)), constraint);
  });

  it("rejects a duplicate slug", async () => {
    const slug = uniqueSlug();
    await db().insert(businesses).values(businessRow({ slug }));
    await expectViolation(
      db().insert(businesses).values(businessRow({ slug })),
      "businesses_slug_unique",
    );
  });
});

describe("products", () => {
  const product = (overrides: Partial<typeof products.$inferInsert> = {}) => ({
    businessId: shop.business.id,
    name: "Rice",
    unit: "KGS",
    pricePaise: 5000n,
    rateBp: 500,
    ...overrides,
  });

  it.each([
    ["products_price_non_negative", { pricePaise: -1n }],
    ["products_name_not_blank", { name: "   " }],
    ["products_hsn_sac_format", { hsnSac: "10A6" }],
    ["products_rate_bp_tax_rates_rate_bp_fk", { rateBp: 700 }],
    ["products_unit_units_uqc_code_fk", { unit: "XYZ" }],
    [
      "products_business_id_businesses_id_fk",
      { businessId: "01a19bb1-0000-7000-8000-000000000000" },
    ],
  ])("%s rejects %o", async (constraint, overrides) => {
    await expectViolation(db().insert(products).values(product(overrides)), constraint);
  });

  it("keeps SKUs unique among active products, and frees an archived product's SKU", async () => {
    const sku = uniqueSlug("sku");
    const [first] = await db().insert(products).values(product({ sku })).returning();
    await expectViolation(
      db().insert(products).values(product({ sku })),
      "products_business_id_sku_unique",
    );
    // Another business may use the same SKU.
    await db()
      .insert(products)
      .values(product({ sku, businessId: otherShop.business.id }));

    if (!first) throw new Error("no row");
    await db().update(products).set({ archivedAt: new Date() }).where(eq(products.id, first.id));
    await db().insert(products).values(product({ sku }));
  });
});

describe("customers", () => {
  const customer = (overrides: Partial<typeof customers.$inferInsert> = {}) => ({
    businessId: shop.business.id,
    name: "Sharma Stores",
    ...overrides,
  });

  it.each([
    ["customers_name_not_blank", { name: "" }],
    ["customers_phone_format", { phoneE164: "+91 98000 00001" }],
    ["customers_gstin_format", { gstin: "27AAPFU0939F1Z" }],
    ["customers_billing_pincode_format", { billingPincode: "4110" }],
    ["customers_credit_days_range", { creditDays: -1 }],
    ["customers_billing_state_code_states_code_fk", { billingStateCode: "00" }],
  ])("%s rejects %o", async (constraint, overrides) => {
    await expectViolation(db().insert(customers).values(customer(overrides)), constraint);
  });

  it("allows one active customer per GSTIN per business, but repeated phone numbers", async () => {
    const shopForGstin = await createTenant();
    const values = customer({ businessId: shopForGstin.business.id, gstin: "29AAGCB7383J1Z4" });
    const [first] = await db().insert(customers).values(values).returning();
    await expectViolation(
      db().insert(customers).values(values),
      "customers_business_id_gstin_unique",
    );

    const phone = { businessId: shopForGstin.business.id, phoneE164: "+919800000002" };
    await db()
      .insert(customers)
      .values([customer(phone), customer(phone)]);

    if (!first) throw new Error("no row");
    await db().update(customers).set({ archivedAt: new Date() }).where(eq(customers.id, first.id));
    await db().insert(customers).values(values);
  });
});

describe("invoices", () => {
  it("accepts a draft without a number and an issued invoice with one", async () => {
    await insertInvoice(draftInvoice());
    await insertInvoice(issuedInvoice());
  });

  it.each<[string, Partial<InvoiceInsert>]>([
    ["invoices_number_iff_issued", { number: "INV/26-27/0001", fy: "26-27" }],
    ["invoices_type", { type: "PROFORMA" as "INVOICE" }],
    ["invoices_due_date_after_invoice_date", { dueDate: "2026-11-01" }],
    ["invoices_public_token_format", { publicToken: "short" }],
  ])("draft: %s rejects %o", async (constraint, overrides) => {
    await expectViolation(insertInvoice(draftInvoice(overrides)), constraint);
  });

  it.each<[string, Partial<InvoiceInsert>]>([
    ["invoices_number_iff_issued", { number: null, fy: null }],
    ["invoices_fy_with_number", { fy: null }],
    ["invoices_issued_at_iff_issued", { issuedAt: null }],
    ["invoices_snapshot_when_issued", { customerSnapshot: null }],
    ["invoices_number_format", { number: "INV 26-27 0001" }],
    ["invoices_number_format", { number: "LONGPREFIX/26-27/0001" }],
    ["invoices_fy_format", { fy: "2026-27" }],
    ["invoices_status", { status: "OVERDUE" as "ISSUED" }],
    // Tax split: CGST must equal SGST (or UTGST), never both. IGST mixing is covered on lines.
    ["invoices_tax_split", { sgstPaise: 800n, grandTotalPaise: 11700n }],
    ["invoices_tax_split", { utgstPaise: 900n, grandTotalPaise: 12700n }],
    ["invoices_place_of_supply_tax", { isInterState: true }],
    [
      "invoices_place_of_supply_tax",
      { cgstPaise: 0n, sgstPaise: 0n, igstPaise: 1800n, grandTotalPaise: 11800n },
    ],
    ["invoices_tax_only_on_tax_invoice", { type: "BILL_OF_SUPPLY" }],
    ["invoices_grand_total", { grandTotalPaise: 11799n }],
    ["invoices_round_off_range", { roundOffPaise: 51n, grandTotalPaise: 11851n }],
    ["invoices_round_off_range", { roundOffPaise: -50n, grandTotalPaise: 11750n }],
    ["invoices_settled_range", { amountPaidPaise: 11801n }],
    ["invoices_settled_range", { amountPaidPaise: -1n }],
    ["invoices_settled_range", { amountCreditedPaise: -1n }],
    ["invoices_settled_range", { amountPaidPaise: 6000n, amountCreditedPaise: 5801n }],
    ["invoices_supplier_snapshot_when_issued", { supplierSnapshot: null }],
    ["invoices_draft_iff_draft", { draft: EMPTY_DRAFT }],
    ["invoices_amounts_non_negative", { taxablePaise: -100n, grandTotalPaise: 1700n }],
    [
      "invoices_cancelled_at_iff_cancelled",
      { status: "CANCELLED", cancelReason: "Wrong customer" },
    ],
    ["invoices_cancel_reason_when_cancelled", { status: "CANCELLED", cancelledAt: new Date() }],
    ["invoices_place_of_supply_state_code_states_code_fk", { placeOfSupplyStateCode: "99" }],
  ])("issued: %s rejects %o", async (constraint, overrides) => {
    await expectViolation(insertInvoice(issuedInvoice(overrides)), constraint);
  });

  it("allows round-off of exactly −49 and +50 paise and UTGST instead of SGST", async () => {
    await insertInvoice(issuedInvoice({ roundOffPaise: 50n, grandTotalPaise: 11850n }));
    await insertInvoice(issuedInvoice({ roundOffPaise: -49n, grandTotalPaise: 11751n }));
    await insertInvoice(issuedInvoice({ sgstPaise: 0n, utgstPaise: 900n }));
    await insertInvoice(
      issuedInvoice({ isInterState: true, cgstPaise: 0n, sgstPaise: 0n, igstPaise: 1800n }),
    );
  });

  it("numbers are unique per business, not globally", async () => {
    const number = "INV/26-27/0042";
    await insertInvoice(issuedInvoice({ number }));
    await expectViolation(
      insertInvoice(issuedInvoice({ number })),
      "invoices_business_id_number_unique",
    );
    await insertInvoice(issuedInvoice({ number, businessId: otherShop.business.id }));
  });

  it("cannot point at another business's customer", async () => {
    const [foreign] = await db()
      .insert(customers)
      .values({ businessId: otherShop.business.id, name: "Not yours" })
      .returning();
    if (!foreign) throw new Error("no row");
    await expectViolation(
      insertInvoice(draftInvoice({ customerId: foreign.id })),
      "invoices_customer_fk",
    );
  });

  it("a customer with invoices cannot be deleted (ON DELETE RESTRICT)", async () => {
    const [customer] = await db()
      .insert(customers)
      .values({ businessId: shop.business.id, name: "Has invoices" })
      .returning();
    if (!customer) throw new Error("no row");
    await insertInvoice(draftInvoice({ customerId: customer.id }));
    await expectViolation(
      db().delete(customers).where(eq(customers.id, customer.id)),
      "invoices_customer_fk",
    );
  });
});

describe("invoice lines", () => {
  let invoiceId: string;
  beforeAll(async () => {
    invoiceId = await insertInvoice(draftInvoice());
  });

  it("accepts a valid intra-state line", async () => {
    await db().insert(invoiceLines).values(line(invoiceId));
  });

  it.each<[string, Partial<LineInsert>]>([
    ["invoice_lines_line_total", { lineTotalPaise: 11801n }],
    ["invoice_lines_tax_split", { sgstPaise: 901n, lineTotalPaise: 11801n }],
    ["invoice_lines_tax_split", { igstPaise: 1n, lineTotalPaise: 11801n }],
    ["invoice_lines_qty_positive", { qtyMilli: 0n }],
    ["invoice_lines_unit_price_non_negative", { unitPricePaise: -1n }],
    ["invoice_lines_discount_non_negative", { discountPaise: -1n }],
    ["invoice_lines_rate_bp_range", { rateBp: 10000 }],
    ["invoice_lines_position_positive", { position: 0 }],
    ["invoice_lines_description_not_blank", { description: " " }],
    ["invoice_lines_hsn_sac_format", { hsnSac: "12" }],
    ["invoice_lines_unit_format", { unit: "kg" }],
  ])("%s rejects %o", async (constraint, overrides) => {
    await expectViolation(
      db()
        .insert(invoiceLines)
        .values(line(invoiceId, { position: 2, ...overrides })),
      constraint,
    );
  });

  it("positions are unique within an invoice", async () => {
    await db()
      .insert(invoiceLines)
      .values(line(invoiceId, { position: 3 }));
    await expectViolation(
      db()
        .insert(invoiceLines)
        .values(line(invoiceId, { position: 3 })),
      "invoice_lines_invoice_position_unique",
    );
  });

  it("cannot attach a line to another business's invoice or product", async () => {
    const foreignInvoice = await insertInvoice(draftInvoice({ businessId: otherShop.business.id }));
    await expectViolation(
      db().insert(invoiceLines).values(line(foreignInvoice)),
      "invoice_lines_invoice_fk",
    );
    const [foreignProduct] = await db()
      .insert(products)
      .values({
        businessId: otherShop.business.id,
        name: "Not yours",
        unit: "PCS",
        pricePaise: 100n,
        rateBp: 0,
      })
      .returning();
    if (!foreignProduct) throw new Error("no row");
    await expectViolation(
      db()
        .insert(invoiceLines)
        .values(line(invoiceId, { position: 9, productId: foreignProduct.id })),
      "invoice_lines_product_fk",
    );
  });

  it("an invoice with lines cannot be deleted (ON DELETE RESTRICT)", async () => {
    await expectViolation(
      db().delete(invoices).where(eq(invoices.id, invoiceId)),
      "invoice_lines_invoice_fk",
    );
  });
});

describe("number sequences, payments and reminders", () => {
  it("one counter per business, series and FY", async () => {
    const tenant = await createTenant();
    const row = { businessId: tenant.business.id, series: "INV" as const, fy: "26-27" };
    await db().insert(numberSequences).values(row);
    await expectViolation(
      db().insert(numberSequences).values(row),
      "number_sequences_business_id_series_fy_unique",
    );
    await db()
      .insert(numberSequences)
      .values({ ...row, series: "CN" });
    await db()
      .insert(numberSequences)
      .values({ ...row, fy: "27-28" });
    await expectViolation(
      db()
        .insert(numberSequences)
        .values({ ...row, fy: "2026" }),
      "number_sequences_fy_format",
    );
    await expectViolation(
      db()
        .insert(numberSequences)
        .values({ ...row, fy: "28-29", nextValue: 0 }),
      "number_sequences_next_value_positive",
    );
  });

  it("payments are positive and allocations stay inside one business", async () => {
    const payment = {
      businessId: shop.business.id,
      paymentDate: "2026-11-02",
      amountPaise: 11800n,
      mode: "UPI" as const,
    };
    await expectViolation(
      db()
        .insert(payments)
        .values({ ...payment, amountPaise: 0n }),
      "payments_amount_positive",
    );
    await expectViolation(
      db()
        .insert(payments)
        .values({ ...payment, mode: "CRYPTO" as "UPI" }),
      "payments_mode",
    );

    const [paid] = await db().insert(payments).values(payment).returning();
    if (!paid) throw new Error("no row");
    const ownInvoice = await insertInvoice(issuedInvoice());
    const foreignInvoice = await insertInvoice(
      issuedInvoice({ businessId: otherShop.business.id }),
    );
    const allocation = {
      businessId: shop.business.id,
      paymentId: paid.id,
      invoiceId: ownInvoice,
      amountPaise: 11800n,
    };
    await expectViolation(
      db()
        .insert(paymentAllocations)
        .values({ ...allocation, amountPaise: 0n }),
      "payment_allocations_amount_positive",
    );
    await expectViolation(
      db()
        .insert(paymentAllocations)
        .values({ ...allocation, invoiceId: foreignInvoice }),
      "payment_allocations_invoice_fk",
    );
    // The invoice's amount paid must match its allocations at commit (migration 0009).
    await db().transaction(async (tx) => {
      await tx.insert(paymentAllocations).values(allocation);
      await tx
        .update(invoices)
        .set({ amountPaidPaise: 11800n, status: "PAID" })
        .where(eq(invoices.id, ownInvoice));
    });
    await expectViolation(
      db().insert(paymentAllocations).values(allocation),
      "payment_allocations_payment_invoice_unique",
    );
  });

  it("each reminder is recorded once per invoice, kind and channel", async () => {
    const invoiceId = await insertInvoice(issuedInvoice());
    const reminder = {
      businessId: shop.business.id,
      invoiceId,
      kind: "D7" as const,
      channel: "EMAIL" as const,
    };
    await db().insert(remindersSent).values(reminder);
    await expectViolation(
      db().insert(remindersSent).values(reminder),
      "reminders_sent_invoice_kind_channel_unique",
    );
    await db()
      .insert(remindersSent)
      .values({ ...reminder, channel: "WHATSAPP" });
    await expectViolation(
      db()
        .insert(remindersSent)
        .values({ ...reminder, kind: "D30" as "D7" }),
      "reminders_sent_kind",
    );
  });
});

describe("tenant rows", () => {
  it("get a time-ordered UUIDv7 id and timestamps by default", async () => {
    const [a] = await db()
      .insert(customers)
      .values({ businessId: shop.business.id, name: "First" })
      .returning();
    const [b] = await db()
      .insert(customers)
      .values({ businessId: shop.business.id, name: "Second" })
      .returning();
    if (!a || !b) throw new Error("no row");
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.id < b.id).toBe(true);
    expect(a.createdAt).toBeInstanceOf(Date);
    expect(a.openingBalancePaise).toBe(0n);
  });
});

describe("immutability triggers (ADR 0006)", () => {
  async function issuedWithLine(): Promise<string> {
    // Lines go in while the invoice is a draft, then it is issued, as invoice.service does.
    const id = await insertInvoice(draftInvoice());
    await db().insert(invoiceLines).values(line(id));
    const issued = issuedInvoice();
    await db()
      .update(invoices)
      .set({
        status: "ISSUED",
        number: issued.number,
        fy: issued.fy,
        issuedAt: issued.issuedAt,
        draft: null,
        supplierSnapshot: issued.supplierSnapshot,
        customerSnapshot: issued.customerSnapshot,
        taxablePaise: 10000n,
        cgstPaise: 900n,
        sgstPaise: 900n,
        grandTotalPaise: 11800n,
      })
      .where(eq(invoices.id, id));
    return id;
  }

  async function frozen(write: Promise<unknown>): Promise<void> {
    const error = await write.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(isImmutableViolation(error), "expected the immutability trigger to refuse").toBe(true);
  }

  it.each<[string, Partial<InvoiceInsert>]>([
    ["totals", { grandTotalPaise: 11900n, cgstPaise: 950n, sgstPaise: 950n }],
    ["number", { number: "INV/26-27/9999" }],
    ["invoice date", { invoiceDate: "2026-11-03" }],
    ["customer snapshot", { customerSnapshot: null }],
    ["notes", { notes: "changed" }],
  ])("refuses to change the %s of an issued invoice", async (_what, patch) => {
    const id = await issuedWithLine();
    await frozen(db().update(invoices).set(patch).where(eq(invoices.id, id)));
  });

  it("refuses to move an issued invoice back to draft or un-cancel it", async () => {
    const id = await issuedWithLine();
    await frozen(
      db()
        .update(invoices)
        .set({ status: "DRAFT", number: null, fy: null, issuedAt: null, draft: EMPTY_DRAFT })
        .where(eq(invoices.id, id)),
    );
    await db()
      .update(invoices)
      .set({ status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Wrong customer" })
      .where(eq(invoices.id, id));
    await frozen(
      db()
        .update(invoices)
        .set({ status: "ISSUED", cancelledAt: null, cancelReason: null })
        .where(eq(invoices.id, id)),
    );
  });

  it("allows payment, credit and link changes on an issued invoice", async () => {
    const id = await issuedWithLine();
    // The amount paid must match an allocation at commit (migration 0009), so pay it properly.
    const [paid] = await db()
      .insert(payments)
      .values({
        businessId: shop.business.id,
        paymentDate: "2026-11-02",
        amountPaise: 5000n,
        mode: "CASH",
      })
      .returning();
    if (!paid) throw new Error("no row");
    await db().transaction(async (tx) => {
      await tx.insert(paymentAllocations).values({
        businessId: shop.business.id,
        paymentId: paid.id,
        invoiceId: id,
        amountPaise: 5000n,
      });
      await tx
        .update(invoices)
        .set({
          status: "PARTIALLY_PAID",
          amountPaidPaise: 5000n,
          amountCreditedPaise: 1000n,
          tokenRevokedAt: new Date(),
          version: 3,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id));
    });
  });

  it("refuses to delete an issued invoice", async () => {
    const id = await issuedWithLine();
    await frozen(db().delete(invoiceLines).where(eq(invoiceLines.invoiceId, id)));
    await frozen(db().delete(invoices).where(eq(invoices.id, id)));
  });

  it("refuses to add, change or remove lines of an issued invoice", async () => {
    const id = await issuedWithLine();
    await frozen(
      db()
        .insert(invoiceLines)
        .values(line(id, { position: 2 })),
    );
    await frozen(
      db().update(invoiceLines).set({ description: "Other" }).where(eq(invoiceLines.invoiceId, id)),
    );
  });

  it("lets a draft and its lines be deleted", async () => {
    const id = await insertInvoice(draftInvoice());
    await db().insert(invoiceLines).values(line(id));
    await db().delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    await db().delete(invoices).where(eq(invoices.id, id));
  });

  it("credit notes and their lines are append-only", async () => {
    const invoiceId = await issuedWithLine();
    const [note] = await db()
      .insert(creditNotes)
      .values({
        businessId: shop.business.id,
        invoiceId,
        number: `CN/26-27/${String(++lastNumber)}`,
        fy: "26-27",
        noteDate: "2026-11-03",
        reason: "Goods returned",
        customerSnapshot: walkIn(),
        supplierSnapshot: SUPPLIER,
        placeOfSupplyStateCode: "27",
        isInterState: false,
        taxablePaise: 10000n,
        cgstPaise: 900n,
        sgstPaise: 900n,
        grandTotalPaise: 11800n,
      })
      .returning();
    if (!note) throw new Error("no row");
    const [invoiceLine] = await db()
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId));
    if (!invoiceLine) throw new Error("no line");
    const { invoiceId: _ignored, ...lineValues } = line(invoiceId);
    await db()
      .insert(creditNoteLines)
      .values({ ...lineValues, creditNoteId: note.id, invoiceLineId: invoiceLine.id });
    await frozen(
      db().update(creditNotes).set({ reason: "Other" }).where(eq(creditNotes.id, note.id)),
    );
    await frozen(db().delete(creditNotes).where(eq(creditNotes.id, note.id)));
    await frozen(
      db()
        .update(creditNoteLines)
        .set({ description: "x" })
        .where(eq(creditNoteLines.creditNoteId, note.id)),
    );
    await frozen(
      db().execute(sql`delete from credit_note_lines where credit_note_id = ${note.id}`),
    );
  });
});

function walkIn() {
  return { name: "", gstin: null, phoneE164: null, email: null, billing: null, shipping: null };
}
