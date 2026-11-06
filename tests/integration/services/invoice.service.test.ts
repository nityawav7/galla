import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type DraftLine, type InvoiceDraftValues } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { updateCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { type Customer, insertCustomer, updateCustomer } from "@/server/db/repos/customers.repo";
import { findInvoiceById } from "@/server/db/repos/invoices.repo";
import { insertProduct, type Product, updateProduct } from "@/server/db/repos/products.repo";
import { invoices, numberSequences } from "@/server/db/schema";
import { type GstScheme } from "@/server/domain/gst/place-of-supply";
import { parseRupees } from "@/server/domain/money";
import {
  createDraft,
  deleteDraft,
  getBuilderOptions,
  getInvoice,
  type Invoice,
  INVOICES_PAGE_SIZE,
  issueInvoice,
  type IssueResult,
  listInvoices,
  updateDraft,
} from "@/server/services/invoice.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

const db = () => getDb();

// --- helpers ------------------------------------------------------------------------------

function line(overrides: Partial<DraftLine> = {}): Partial<DraftLine> {
  return {
    productId: null,
    description: "PVC pipe",
    hsnSac: "3917",
    unit: "NOS",
    qty: "1",
    unitPrice: "100",
    discount: "",
    rateBp: 1800,
    priceIncludesTax: false,
    ...overrides,
  };
}

function draftOf(overrides: Partial<InvoiceDraftValues> = {}): InvoiceDraftValues {
  return { lines: [line()], ...overrides };
}

/** A registered GSTIN shape for any state: the DB checks the format, not the checksum. */
const gstinFor = (stateCode: string) => `${stateCode}AAPFU0939F1ZV`;

async function tenantAs(role: Role = "OWNER", overrides: Parameters<typeof createTenant>[0] = {}) {
  const owner = await createTenant(overrides);
  return { ...owner, ctx: { ...owner.ctx, role } };
}

async function addCustomer(
  tenant: Tenant,
  overrides: Partial<Parameters<typeof insertCustomer>[2]> = {},
): Promise<Customer> {
  return insertCustomer(db(), tenant.ctx, { name: "Mehta Traders", ...overrides });
}

async function addProduct(
  tenant: Tenant,
  overrides: Partial<Parameters<typeof insertProduct>[2]> = {},
): Promise<Product> {
  return insertProduct(db(), tenant.ctx, {
    name: "Cement 50 kg",
    hsnSac: "2523",
    unit: "BAG",
    pricePaise: 42000n,
    rateBp: 1800,
    priceIncludesTax: false,
    ...overrides,
  });
}

function issuedOf(result: IssueResult): Invoice {
  if (result.status !== "issued") throw new Error(`expected issued, got ${result.status}`);
  return result.invoice;
}

async function issue(tenant: Tenant, draft: Invoice, acknowledgedWarnings: string[] = []) {
  return issueInvoice(tenant.ctx, draft.id, { version: draft.version, acknowledgedWarnings });
}

async function issueDraft(tenant: Tenant, values: InvoiceDraftValues = draftOf()) {
  return issuedOf(await issue(tenant, await createDraft(tenant.ctx, values)));
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

async function issuesOf(promise: Promise<unknown>) {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).issues;
}

async function conflictOf(promise: Promise<unknown>): Promise<string> {
  const error = await rejection(promise);
  expect(error).toBeInstanceOf(ConflictError);
  return (error as ConflictError).message;
}

/** Sets "now" for the service (Date only; timers and the DB driver keep real time). */
function setNow(iso: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(iso));
}

const seq = (number: string | null) => Number(number?.split("/").at(-1));

// --- drafts -------------------------------------------------------------------------------

describe("createDraft", () => {
  it.each<Role>(["OWNER", "STAFF"])("lets %s start a draft, with its audit row", async (role) => {
    const tenant = await tenantAs(role);
    const draft = await createDraft(tenant.ctx, draftOf());
    expect(draft).toMatchObject({
      status: "DRAFT",
      number: null,
      type: "TAX_INVOICE",
      placeOfSupplyStateCode: "27",
      isInterState: false,
      taxablePaise: 10000n,
      cgstPaise: 900n,
      sgstPaise: 900n,
      grandTotalPaise: 11800n,
      version: 1,
    });
    const audit = await listAuditLogs(db(), tenant.ctx, { entityId: draft.id });
    expect(audit.map((row) => row.action)).toEqual(["invoice.draftCreated"]);
  });

  it("refuses an accountant", async () => {
    const tenant = await tenantAs("ACCOUNTANT");
    await expect(createDraft(tenant.ctx, draftOf())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("keeps half-typed lines and counts only the valid ones in the totals", async () => {
    const tenant = await tenantAs();
    const draft = await createDraft(
      tenant.ctx,
      draftOf({ lines: [line(), line({ description: "", qty: "abc" })] }),
    );
    expect(draft.draft?.lines).toHaveLength(2);
    expect(draft.grandTotalPaise).toBe(11800n);
  });

  it("ignores totals sent by the client (they are not part of the input)", async () => {
    const tenant = await tenantAs();
    const draft = await createDraft(tenant.ctx, {
      ...draftOf(),
      grandTotalPaise: "1",
      totals: { grandTotal: "1.00" },
    });
    expect(draft.grandTotalPaise).toBe(11800n);
    expect(draft.draft).not.toHaveProperty("totals");
  });

  it("uses the product's rate, HSN and unit, not what the client sent", async () => {
    const tenant = await tenantAs();
    const product = await addProduct(tenant);
    const draft = await createDraft(
      tenant.ctx,
      draftOf({
        lines: [
          line({ productId: product.id, rateBp: 0, unit: "NOS", hsnSac: "", unitPrice: "420" }),
        ],
      }),
    );
    expect(draft.cgstPaise).toBe(3780n); // 9% of ₹420
  });

  it("sets the due date from the customer's credit days", async () => {
    setNow("2026-11-06T06:00:00Z");
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, { creditDays: 15 });
    const draft = await createDraft(tenant.ctx, draftOf({ customerId: customer.id }));
    expect(draft).toMatchObject({ invoiceDate: "2026-11-06", dueDate: "2026-11-21" });
  });
});

describe("updateDraft", () => {
  it("saves with optimistic locking and writes no audit row per autosave", async () => {
    const tenant = await tenantAs("STAFF");
    const draft = await createDraft(tenant.ctx, draftOf());
    const saved = await updateDraft(tenant.ctx, draft.id, {
      version: draft.version,
      draft: draftOf({ lines: [line({ qty: "2" })] }),
    });
    expect(saved).toMatchObject({ version: 2, grandTotalPaise: 23600n });
    const audit = await listAuditLogs(db(), tenant.ctx, { entityId: draft.id });
    expect(audit.map((row) => row.action)).toEqual(["invoice.draftCreated"]);
  });

  it("refuses a save from a stale tab", async () => {
    const tenant = await tenantAs();
    const draft = await createDraft(tenant.ctx, draftOf());
    await updateDraft(tenant.ctx, draft.id, { version: 1, draft: draftOf() });
    expect(
      await conflictOf(updateDraft(tenant.ctx, draft.id, { version: 1, draft: draftOf() })),
    ).toBe("draftEditedElsewhere");
  });

  it("refuses to change an issued invoice", async () => {
    const tenant = await tenantAs();
    const issued = await issueDraft(tenant);
    expect(
      await conflictOf(
        updateDraft(tenant.ctx, issued.id, { version: issued.version, draft: draftOf() }),
      ),
    ).toBe("invoiceAlreadyIssued");
  });

  it("refuses an accountant and a malformed id", async () => {
    const owner = await tenantAs();
    const draft = await createDraft(owner.ctx, draftOf());
    const accountant = { ...owner.ctx, role: "ACCOUNTANT" as const };
    await expect(
      updateDraft(accountant, draft.id, { version: 1, draft: draftOf() }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      updateDraft(owner.ctx, "not-a-uuid", { version: 1, draft: draftOf() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteDraft", () => {
  it("deletes a draft with an audit row", async () => {
    const tenant = await tenantAs("STAFF");
    const draft = await createDraft(tenant.ctx, draftOf());
    await deleteDraft(tenant.ctx, draft.id);
    expect(await findInvoiceById(db(), tenant.ctx, draft.id)).toBeUndefined();
    const audit = await listAuditLogs(db(), tenant.ctx, { entityId: draft.id });
    expect(audit.map((row) => row.action)).toEqual([
      "invoice.draftDeleted",
      "invoice.draftCreated",
    ]);
  });

  it("never deletes an issued invoice", async () => {
    const tenant = await tenantAs();
    const issued = await issueDraft(tenant);
    expect(await conflictOf(deleteDraft(tenant.ctx, issued.id))).toBe("invoiceAlreadyIssued");
    await expect(deleteDraft(tenant.ctx, crypto.randomUUID())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

// --- issue -------------------------------------------------------------------------------

describe("issueInvoice", () => {
  it("assigns the first number, snapshots and a public token, with one audit row", async () => {
    setNow("2026-11-06T06:00:00Z");
    const tenant = await tenantAs("STAFF");
    const customer = await addCustomer(tenant, {
      gstin: "27AAPFU0939F1ZV",
      billingAddressLine1: "12 MG Road",
      billingStateCode: "27",
    });
    const product = await addProduct(tenant);
    const draft = await createDraft(
      tenant.ctx,
      draftOf({
        customerId: customer.id,
        lines: [
          line({ productId: product.id, description: "Cement 50 kg", qty: "2", unitPrice: "420" }),
        ],
      }),
    );
    const issued = issuedOf(await issue(tenant, draft));

    expect(issued).toMatchObject({
      status: "ISSUED",
      number: "INV/26-27/0001",
      fy: "26-27",
      invoiceDate: "2026-11-06",
      draft: null,
      roundOffPaise: -20n,
      grandTotalPaise: 99100n,
      customerSnapshot: { name: "Mehta Traders", gstin: "27AAPFU0939F1ZV" },
      supplierSnapshot: { legalName: "Test Traders", gstin: "27AAPFU0939F1ZV", stateCode: "27" },
    });
    expect(issued.publicToken).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const { lines } = await getInvoice(tenant.ctx, issued.id);
    expect(lines).toMatchObject([
      {
        position: 1,
        productId: product.id,
        description: "Cement 50 kg",
        hsnSac: "2523",
        unit: "BAG",
        qtyMilli: 2000n,
        rateBp: 1800,
        taxablePaise: 84000n,
        cgstPaise: 7560n,
        sgstPaise: 7560n,
        lineTotalPaise: 99120n,
      },
    ]);
    const audit = await listAuditLogs(db(), tenant.ctx, { entityId: issued.id });
    expect(audit.map((row) => row.action)).toEqual(["invoice.issued", "invoice.draftCreated"]);
    expect(audit[0]?.diff).toMatchObject({
      after: { number: "INV/26-27/0001", grandTotalPaise: "99100" },
    });
  });

  it("refuses an accountant", async () => {
    const owner = await tenantAs();
    const draft = await createDraft(owner.ctx, draftOf());
    await expect(
      issueInvoice({ ...owner.ctx, role: "ACCOUNTANT" }, draft.id, { version: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("50 parallel issues get unique, gapless numbers (SPEC §4.6)", async () => {
    setNow("2026-11-06T06:00:00Z");
    const tenant = await tenantAs();
    const drafts = await Promise.all(
      Array.from({ length: 50 }, () => createDraft(tenant.ctx, draftOf())),
    );
    const results = await Promise.all(drafts.map((draft) => issue(tenant, draft)));
    const numbers = results.map((result) => issuedOf(result).number);
    expect(new Set(numbers).size).toBe(50);
    expect(numbers.map(seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1),
    );
    const [counter] = await db()
      .select()
      .from(numberSequences)
      .where(
        and(eq(numberSequences.businessId, tenant.business.id), eq(numberSequences.series, "INV")),
      );
    expect(counter?.nextValue).toBe(51);
  }, 60_000);

  it("two businesses issuing at once keep their own counters", async () => {
    const [a, b] = await Promise.all([tenantAs(), tenantAs()]);
    const draftsA = await Promise.all([1, 2, 3].map(() => createDraft(a.ctx, draftOf())));
    const draftsB = await Promise.all([1, 2, 3].map(() => createDraft(b.ctx, draftOf())));
    const issued = await Promise.all([
      ...draftsA.map((draft) => issue(a, draft)),
      ...draftsB.map((draft) => issue(b, draft)),
    ]);
    const numbers = issued.map((result) => seq(issuedOf(result).number));
    expect(numbers.slice(0, 3).sort()).toEqual([1, 2, 3]);
    expect(numbers.slice(3).sort()).toEqual([1, 2, 3]);
  });

  it("issuing the same draft twice at once issues it once", async () => {
    const tenant = await tenantAs();
    const draft = await createDraft(tenant.ctx, draftOf());
    const outcomes = await Promise.allSettled([issue(tenant, draft), issue(tenant, draft)]);
    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const failed = outcomes.find((o) => o.status === "rejected");
    expect(failed?.reason).toBeInstanceOf(ConflictError);
    const next = await issueDraft(tenant);
    expect(next.number).toMatch(/\/0002$/);
  });

  it("a refused issue uses no number", async () => {
    const tenant = await tenantAs();
    const bad = await createDraft(tenant.ctx, draftOf({ lines: [line({ description: "" })] }));
    expect(await issuesOf(issue(tenant, bad))).toEqual([
      { path: "lines.0.description", message: "lineDescriptionRequired" },
    ]);
    expect((await issueDraft(tenant)).number).toMatch(/\/0001$/);
  });

  it("refuses a stale version and an empty invoice", async () => {
    const tenant = await tenantAs();
    const draft = await createDraft(tenant.ctx, draftOf());
    await updateDraft(tenant.ctx, draft.id, { version: 1, draft: draftOf() });
    expect(await conflictOf(issue(tenant, draft))).toBe("draftEditedElsewhere");
    const empty = await createDraft(tenant.ctx, { lines: [] });
    expect(await issuesOf(issue(tenant, empty))).toEqual([
      { path: "lines", message: "invoiceLinesRequired" },
    ]);
  });

  it("starts a new counter in a new financial year (IST boundary)", async () => {
    const tenant = await tenantAs();
    setNow("2027-03-31T18:29:00Z"); // 31 Mar 23:59 IST
    expect((await issueDraft(tenant)).number).toBe("INV/26-27/0001");
    setNow("2027-03-31T18:30:00Z"); // 1 Apr 00:00 IST
    const april = await issueDraft(tenant);
    expect(april).toMatchObject({
      number: "INV/27-28/0001",
      fy: "27-28",
      invoiceDate: "2027-04-01",
    });
  });

  it("uses the business's prefix", async () => {
    const tenant = await tenantAs("OWNER", { invoicePrefix: "GAL", creditNotePrefix: "GCN" });
    const issued = await issueDraft(tenant);
    expect(issued.number).toBe(`GAL/${issued.fy ?? ""}/0001`);
  });

  it("keeps the snapshot when the customer, product or business change later", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, { billingStateCode: "27" });
    const product = await addProduct(tenant);
    const issued = await issueDraft(
      tenant,
      draftOf({
        customerId: customer.id,
        lines: [line({ productId: product.id, unitPrice: "420" })],
      }),
    );
    await updateCustomer(db(), tenant.ctx, customer.id, { name: "Renamed" });
    await updateProduct(db(), tenant.ctx, product.id, { name: "Other", rateBp: 500 });
    await updateCurrentBusiness(db(), tenant.ctx, { legalName: "New Name LLP" });

    const after = await getInvoice(tenant.ctx, issued.id);
    expect(after.invoice.customerSnapshot?.name).toBe("Mehta Traders");
    expect(after.invoice.supplierSnapshot?.legalName).toBe("Test Traders");
    expect(after.lines[0]).toMatchObject({ description: "PVC pipe", rateBp: 1800 });
    expect(after.invoice.grandTotalPaise).toBe(issued.grandTotalPaise);
  });

  it("refuses an archived customer and an inactive rate on a one-off line", async () => {
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant);
    const draft = await createDraft(tenant.ctx, draftOf({ customerId: customer.id }));
    await db().execute(sql`update customers set archived_at = now() where id = ${customer.id}`);
    expect(await conflictOf(issue(tenant, draft))).toBe("customerArchived");

    const retired = await createDraft(tenant.ctx, draftOf({ lines: [line({ rateBp: 1200 })] }));
    expect(await issuesOf(issue(tenant, retired))).toEqual([
      { path: "lines.0.rateBp", message: "rateRequired" },
    ]);
  });

  it("refuses a discount above the line value and a due date before the invoice date", async () => {
    setNow("2026-11-06T06:00:00Z");
    const tenant = await tenantAs();
    const draft = await createDraft(
      tenant.ctx,
      draftOf({ dueDate: "2026-11-01", lines: [line({ discount: "100.01" })] }),
    );
    expect(await issuesOf(issue(tenant, draft))).toEqual([
      { path: "dueDate", message: "dueDateBeforeInvoiceDate" },
      { path: "lines.0.discountPaise", message: "discountTooLarge" },
    ]);
  });

  describe("GST rules", () => {
    it("bills another state with IGST", async () => {
      const tenant = await tenantAs();
      const customer = await addCustomer(tenant, { billingStateCode: "29" });
      const issued = await issueDraft(tenant, draftOf({ customerId: customer.id }));
      expect(issued).toMatchObject({
        isInterState: true,
        placeOfSupplyStateCode: "29",
        igstPaise: 1800n,
        cgstPaise: 0n,
      });
    });

    it("lets the user override the place of supply, but only to a valid state", async () => {
      const tenant = await tenantAs();
      const issued = await issueDraft(tenant, draftOf({ placeOfSupplyOverride: "07" }));
      expect(issued).toMatchObject({ placeOfSupplyStateCode: "07", igstPaise: 1800n });
      const bad = await createDraft(tenant.ctx, draftOf({ placeOfSupplyOverride: "25" }));
      expect(await issuesOf(issue(tenant, bad))).toEqual([
        { path: "placeOfSupplyOverride", message: "placeOfSupplyInvalid" },
      ]);
    });

    it("refuses a composition business billing another state", async () => {
      const tenant = await tenantAs("OWNER", { gstScheme: "COMPOSITION" });
      const draft = await createDraft(tenant.ctx, draftOf({ placeOfSupplyOverride: "29" }));
      expect(await issuesOf(issue(tenant, draft))).toEqual([
        { path: "placeOfSupply", message: "compositionInterState" },
      ]);
    });

    it("issues a bill of supply with no tax for a composition business", async () => {
      const tenant = await tenantAs("OWNER", { gstScheme: "COMPOSITION" });
      const issued = await issueDraft(
        tenant,
        draftOf({ lines: [line({ priceIncludesTax: true })] }),
      );
      expect(issued).toMatchObject({
        type: "BILL_OF_SUPPLY",
        cgstPaise: 0n,
        grandTotalPaise: 10000n,
      });
      const { lines } = await getInvoice(tenant.ctx, issued.id);
      expect(lines[0]).toMatchObject({ rateBp: 0, priceIncludesTax: false });
    });

    it("asks before an unregistered business bills another state, then issues", async () => {
      const tenant = await tenantAs("OWNER", { gstScheme: "UNREGISTERED", gstin: null });
      const draft = await createDraft(tenant.ctx, draftOf({ placeOfSupplyOverride: "29" }));
      expect(await issue(tenant, draft)).toEqual({
        status: "needsConfirmation",
        warnings: ["UNREGISTERED_INTER_STATE"],
      });
      expect((await findInvoiceById(db(), tenant.ctx, draft.id))?.status).toBe("DRAFT");
      const issued = issuedOf(await issue(tenant, draft, ["UNREGISTERED_INTER_STATE"]));
      expect(issued).toMatchObject({ type: "INVOICE", igstPaise: 0n, grandTotalPaise: 10000n });
    });

    it("needs HSN on B2B lines with the 4-digit setting, and 6 digits on all with 6", async () => {
      const tenant = await tenantAs();
      const b2b = await addCustomer(tenant, { gstin: "27AAPFU0939F1ZV", billingStateCode: "27" });
      const draft = await createDraft(
        tenant.ctx,
        draftOf({ customerId: b2b.id, lines: [line({ hsnSac: "" })] }),
      );
      expect(await issuesOf(issue(tenant, draft))).toEqual([
        { path: "lines.0.hsnSac", message: "hsnRequired" },
      ]);
      await issueDraft(tenant, draftOf({ lines: [line({ hsnSac: "" })] })); // B2C is fine

      const big = await tenantAs("OWNER", { hsnDigitsRequired: 6 });
      const walkIn = await createDraft(big.ctx, draftOf({ lines: [line({ hsnSac: "3917" })] }));
      expect(await issuesOf(issue(big, walkIn))).toEqual([
        { path: "lines.0.hsnSac", message: "hsnSixDigitsRequired" },
      ]);
    });

    it("refuses a walk-in sale of ₹50,000 or more (Rule 46)", async () => {
      const tenant = await tenantAs();
      const draft = await createDraft(
        tenant.ctx,
        draftOf({ lines: [line({ unitPrice: "50000", priceIncludesTax: true })] }),
      );
      expect(await issuesOf(issue(tenant, draft))).toEqual([
        { path: "customerId", message: "recipientDetailsRequired" },
      ]);
      const customer = await addCustomer(tenant, {
        billingAddressLine1: "12 MG Road",
        billingStateCode: "27",
      });
      await issueDraft(
        tenant,
        draftOf({
          customerId: customer.id,
          lines: [line({ unitPrice: "50000", priceIncludesTax: true })],
        }),
      );
    });
  });
});

// --- golden fixtures through the whole service ----------------------------------------------

interface GoldenFixture {
  id: string;
  business: { stateCode: string; scheme: GstScheme };
  customer: { billingStateCode: string | null; shippingStateCode: string | null };
  overrideStateCode: string | null;
  roundOff: boolean;
  lines: {
    description: string;
    qty: string;
    unitPrice: string;
    rateBp: number;
    priceIncludesTax: boolean;
    discount: string;
  }[];
  expected: {
    documentType: string;
    placeOfSupply: string;
    lines: Record<"taxable" | "cgst" | "sgst" | "utgst" | "igst" | "total", string>[];
    totals: Record<
      "discount" | "taxable" | "cgst" | "sgst" | "utgst" | "igst" | "roundOff" | "grandTotal",
      string
    >;
  };
}

const FIXTURE_DIR = join(import.meta.dirname, "../../fixtures/invoices");
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as GoldenFixture);

describe("golden fixtures through the service", () => {
  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
    "%s matches to the paisa",
    async (_id, fixture) => {
      const { stateCode, scheme } = fixture.business;
      const tenant = await tenantAs("OWNER", {
        stateCode,
        gstScheme: scheme,
        gstin: scheme === "UNREGISTERED" ? null : gstinFor(stateCode),
        roundOffEnabled: fixture.roundOff,
      });
      const { billingStateCode, shippingStateCode } = fixture.customer;
      const customer =
        billingStateCode || shippingStateCode
          ? await addCustomer(tenant, { billingStateCode, shippingStateCode })
          : null;
      const issued = await issueDraft(tenant, {
        customerId: customer?.id ?? null,
        placeOfSupplyOverride: fixture.overrideStateCode,
        lines: fixture.lines.map((fixtureLine) => line({ ...fixtureLine, hsnSac: "3917" })),
      });

      const { totals } = fixture.expected;
      expect(issued).toMatchObject({
        type: fixture.expected.documentType,
        placeOfSupplyStateCode: fixture.expected.placeOfSupply,
        discountPaise: parseRupees(totals.discount),
        taxablePaise: parseRupees(totals.taxable),
        cgstPaise: parseRupees(totals.cgst),
        sgstPaise: parseRupees(totals.sgst),
        utgstPaise: parseRupees(totals.utgst),
        igstPaise: parseRupees(totals.igst),
        roundOffPaise: BigInt(Math.round(Number(totals.roundOff) * 100)),
        grandTotalPaise: parseRupees(totals.grandTotal),
      });
      const { lines } = await getInvoice(tenant.ctx, issued.id);
      expect(
        lines.map((row) => ({
          taxable: row.taxablePaise,
          cgst: row.cgstPaise,
          sgst: row.sgstPaise,
          utgst: row.utgstPaise,
          igst: row.igstPaise,
          total: row.lineTotalPaise,
        })),
      ).toEqual(
        fixture.expected.lines.map((expected) => ({
          taxable: parseRupees(expected.taxable),
          cgst: parseRupees(expected.cgst),
          sgst: parseRupees(expected.sgst),
          utgst: parseRupees(expected.utgst),
          igst: parseRupees(expected.igst),
          total: parseRupees(expected.total),
        })),
      );
    },
  );
});

// --- reads --------------------------------------------------------------------------------

describe("getInvoice, listInvoices and getBuilderOptions", () => {
  it("let every role read", async () => {
    const owner = await tenantAs();
    const issued = await issueDraft(owner);
    for (const role of ["OWNER", "ACCOUNTANT", "STAFF"] as const) {
      const ctx = { ...owner.ctx, role };
      expect((await getInvoice(ctx, issued.id)).invoice.id).toBe(issued.id);
      expect((await listInvoices(ctx, {})).items).toHaveLength(1);
    }
    await expect(getInvoice(owner.ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("filters by status (with derived OVERDUE), date, customer and number", async () => {
    setNow("2026-11-01T06:00:00Z");
    const tenant = await tenantAs();
    const customer = await addCustomer(tenant, { name: "Ramesh Stores", creditDays: 2 });
    const overdue = await issueDraft(tenant, draftOf({ customerId: customer.id }));
    const cash = await issueDraft(tenant);
    const draft = await createDraft(tenant.ctx, draftOf());
    setNow("2026-11-06T06:00:00Z");

    const ids = async (query: Record<string, string>) =>
      (await listInvoices(tenant.ctx, query)).items.map((row) => row.invoice.id);
    expect(await ids({ status: "OVERDUE" })).toEqual([overdue.id]);
    expect((await ids({ status: "UNPAID" })).sort()).toEqual([overdue.id, cash.id].sort());
    expect(await ids({ status: "DRAFT" })).toEqual([draft.id]);
    expect(await ids({ status: "PAID" })).toEqual([]);
    expect(await ids({ customer: customer.id })).toEqual([overdue.id]);
    expect(await ids({ q: "ramesh" })).toEqual([overdue.id]);
    expect(await ids({ q: overdue.number ?? "" })).toEqual([overdue.id]);
    expect(await ids({ from: "2026-11-02" })).toEqual([]);
    expect(await ids({ status: "bogus", from: "nope" })).toHaveLength(3);

    const row = (await listInvoices(tenant.ctx, { customer: customer.id })).items[0];
    expect(row?.customerName).toBe("Ramesh Stores");
  });

  it("pages through invoices newest first without skipping or repeating", async () => {
    const tenant = await tenantAs();
    await db()
      .insert(invoices)
      .values(
        Array.from({ length: INVOICES_PAGE_SIZE + 5 }, (_, index) => ({
          businessId: tenant.business.id,
          type: "TAX_INVOICE" as const,
          invoiceDate: `2026-10-${String((index % 28) + 1).padStart(2, "0")}`,
          placeOfSupplyStateCode: "27",
          isInterState: false,
          draft: {
            customerId: null,
            walkInName: "",
            placeOfSupplyOverride: null,
            dueDate: null,
            notes: "",
            lines: [],
          },
        })),
      );
    const first = await listInvoices(tenant.ctx, {});
    expect(first.items).toHaveLength(INVOICES_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await listInvoices(tenant.ctx, { cursor: first.nextCursor ?? "" });
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((row) => row.invoice);
    expect(new Set(all.map((invoice) => invoice.id)).size).toBe(INVOICES_PAGE_SIZE + 5);
    const dates = all.map((invoice) => invoice.invoiceDate);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("gives the builder the business settings and active rates", async () => {
    const tenant = await tenantAs("STAFF");
    const options = await getBuilderOptions(tenant.ctx);
    expect(options.business).toEqual({
      gstScheme: "REGULAR",
      stateCode: "27",
      roundOffEnabled: true,
      hsnDigitsRequired: 4,
      invoicePrefix: "INV",
    });
    expect(options.rates.map((rate) => rate.rateBp)).not.toContain(1200);
    expect(options.states.map((state) => state.code)).toContain("97");
    await expect(getBuilderOptions({ ...tenant.ctx, role: "ACCOUNTANT" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

// --- isolation ----------------------------------------------------------------------------

describe("tenant isolation", () => {
  const arrangeDraft = (owner: Tenant) => createDraft(owner.ctx, draftOf());
  const arrangeIssued = (owner: Tenant) => issueDraft(owner);
  const unchanged = async (owner: Tenant, invoice: Invoice) => {
    const now = await findInvoiceById(db(), owner.ctx, invoice.id);
    expect(now).toMatchObject({ status: invoice.status, version: invoice.version });
  };

  itIsolatesTenants({
    "createDraft with another business's customer": isolationCase({
      arrange: (owner) => addCustomer(owner),
      act: (intruder, customer) => createDraft(intruder.ctx, draftOf({ customerId: customer.id })),
    }),
    "createDraft with another business's product": isolationCase({
      arrange: (owner) => addProduct(owner),
      act: (intruder, product) =>
        createDraft(intruder.ctx, draftOf({ lines: [line({ productId: product.id })] })),
    }),
    updateDraft: isolationCase({
      arrange: arrangeDraft,
      act: (intruder, draft) =>
        updateDraft(intruder.ctx, draft.id, { version: draft.version, draft: draftOf() }),
      verify: unchanged,
    }),
    deleteDraft: isolationCase({
      arrange: arrangeDraft,
      act: (intruder, draft) => deleteDraft(intruder.ctx, draft.id),
      verify: unchanged,
    }),
    issueInvoice: isolationCase({
      arrange: arrangeDraft,
      act: (intruder, draft) => issueInvoice(intruder.ctx, draft.id, { version: draft.version }),
      verify: unchanged,
    }),
    getInvoice: isolationCase({
      arrange: arrangeIssued,
      act: (intruder, invoice) => getInvoice(intruder.ctx, invoice.id),
    }),
    listInvoices: isolationCase({
      arrange: arrangeIssued,
      act: (intruder) => listInvoices(intruder.ctx, {}),
    }),
    "listInvoices by the owner's customer": isolationCase({
      arrange: async (owner) => {
        const customer = await addCustomer(owner);
        await issueDraft(owner, draftOf({ customerId: customer.id }));
        return customer;
      },
      act: (intruder, customer) => listInvoices(intruder.ctx, { customer: customer.id }),
    }),
    getBuilderOptions: isolationCase({
      arrange: arrangeDraft,
      act: (intruder) => getBuilderOptions(intruder.ctx),
    }),
  });
});
