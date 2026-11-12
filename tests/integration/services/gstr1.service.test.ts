import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, ValidationError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { type Customer, insertCustomer } from "@/server/db/repos/customers.repo";
import { cancelInvoice, createCreditNote } from "@/server/services/credit-note.service";
import { getGstr1, getGstr1Options, gstr1File } from "@/server/services/gstr1.service";
import {
  createDraft,
  getInvoice,
  type Invoice,
  issueInvoice,
} from "@/server/services/invoice.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

function onDay(date: string): void {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${date}T06:00:00Z`));
}

const as = (tenant: Tenant, role: Role): Tenant => ({ ...tenant, ctx: { ...tenant.ctx, role } });

function customer(tenant: Tenant, name: string, gstin: string | null): Promise<Customer> {
  return insertCustomer(getDb(), tenant.ctx, {
    name,
    openingBalancePaise: 0n,
    creditDays: 0,
    gstin,
    billingAddressLine1: "12 MG Road",
    billingCity: "Bengaluru",
    billingStateCode: "29",
  });
}

function line(overrides: Partial<DraftLine>): Partial<DraftLine> {
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

async function invoice(
  tenant: Tenant,
  date: string,
  buyer: Customer | null,
  lines: Partial<DraftLine>[],
): Promise<Invoice> {
  onDay(date);
  const draft = await createDraft(tenant.ctx, { customerId: buyer?.id ?? null, lines });
  const result = await issueInvoice(tenant.ctx, draft.id, {
    version: draft.version,
    acknowledgedWarnings: ["UNREGISTERED_INTER_STATE"],
  });
  if (result.status !== "issued") throw new Error(`not issued: ${result.status}`);
  return result.invoice;
}

async function creditFirst(tenant: Tenant, target: Invoice, date: string) {
  const [first] = (await getInvoice(tenant.ctx, target.id)).lines;
  onDay(date);
  return createCreditNote(tenant.ctx, target.id, {
    reason: "Goods returned",
    lines: [{ invoiceLineId: first?.id ?? "", qty: "1" }],
  });
}

/**
 * A Maharashtra shop in November 2026: pipes to Shah Stores (registered, Karnataka); ₹1 lakh of
 * pipes + 18% to Mehta (unregistered, Karnataka: B2CL); rice (5%) and dal (0%) to a walk-in;
 * a cancelled walk-in sale; and one credit note on each of the first three.
 */
async function shop() {
  const tenant = await createTenant();
  const shah = await customer(tenant, "Shah Stores", "29AABCU9603R1ZM");
  const mehta = await customer(tenant, "Mehta Builders", null);
  const toShah = await invoice(tenant, "2026-11-02", shah, [line({ qty: "2" })]);
  const big = await invoice(tenant, "2026-11-03", mehta, [line({ qty: "2", unitPrice: "50000" })]);
  const counter = await invoice(tenant, "2026-11-04", null, [
    line({
      description: "Rice",
      hsnSac: "1006",
      unit: "KGS",
      qty: "2",
      unitPrice: "50",
      rateBp: 500,
    }),
    line({ description: "Toor dal", hsnSac: "0713", unit: "KGS", unitPrice: "160", rateBp: 0 }),
  ]);
  const wrong = await invoice(tenant, "2026-11-05", null, [line({ unitPrice: "999" })]);
  onDay("2026-11-05");
  await cancelInvoice(tenant.ctx, wrong.id, { reason: "Entered twice" });
  await creditFirst(tenant, toShah, "2026-11-06");
  await creditFirst(tenant, big, "2026-11-07");
  await creditFirst(tenant, counter, "2026-11-08");
  // October, outside the period.
  await invoice(tenant, "2026-10-30", null, [line({})]);
  onDay("2026-12-02");
  return { tenant, toShah, big, counter, wrong };
}

describe("getGstr1", () => {
  it("sorts the month into B2B, B2CL, B2CS, CDNR, CDNUR, EXEMP, HSN and DOCS", async () => {
    const { tenant, toShah, big, wrong } = await shop();
    const { period, report } = await getGstr1(as(tenant, "ACCOUNTANT").ctx, "2026-11");
    expect(period).toMatchObject({ from: "2026-11-01", to: "2026-11-30", kind: "month" });
    expect(report.b2b).toEqual([
      {
        gstin: "29AABCU9603R1ZM",
        name: "Shah Stores",
        number: toShah.number,
        date: "2026-11-02",
        invoiceValuePaise: 23_600n,
        placeOfSupply: "29",
        rateBp: 1800,
        taxablePaise: 20_000n,
      },
    ]);
    expect(report.b2cl).toEqual([
      {
        number: big.number,
        date: "2026-11-03",
        invoiceValuePaise: 11_800_000n,
        placeOfSupply: "29",
        rateBp: 1800,
        taxablePaise: 10_000_000n,
      },
    ]);
    // Rice ₹100 at 5% in Maharashtra, less the ₹50 credited back.
    expect(report.b2cs).toEqual([{ placeOfSupply: "27", rateBp: 500, taxablePaise: 5_000n }]);
    expect(report.cdnr).toMatchObject([
      { gstin: "29AABCU9603R1ZM", rateBp: 1800, taxablePaise: 10_000n },
    ]);
    expect(report.cdnur).toMatchObject([
      { placeOfSupply: "29", rateBp: 1800, taxablePaise: 5_000_000n },
    ]);
    expect(report.exemp).toContainEqual({ supply: "INTRA_UNREGISTERED", nilRatedPaise: 16_000n });
    expect(report.hsnB2b).toMatchObject([{ hsn: "3917", uqc: "NOS-NUMBERS", qtyMilli: 1_000n }]);
    expect(report.hsnB2c.map((row) => [row.hsn, row.uqc, row.qtyMilli, row.taxablePaise])).toEqual([
      ["0713", "KGS-KILOGRAMS", 1_000n, 16_000n],
      ["1006", "KGS-KILOGRAMS", 1_000n, 5_000n],
      ["3917", "NOS-NUMBERS", 1_000n, 5_000_000n],
    ]);
    expect(report.docs).toEqual([
      expect.objectContaining({ nature: "INVOICES", total: 4, cancelled: 1, to: wrong.number }),
      expect.objectContaining({ nature: "CREDIT_NOTES", total: 3, cancelled: 0 }),
    ]);
  });

  it("a quarter covers its three months", async () => {
    const { tenant } = await shop();
    const { report } = await getGstr1(tenant.ctx, "26-27-Q3");
    expect(report.docs[0]?.total).toBe(5);
  });

  it("refuses a bad period, staff, and a business that doesn't file GSTR-1", async () => {
    const { tenant } = await shop();
    await expect(getGstr1(tenant.ctx, "2026-13")).rejects.toBeInstanceOf(ValidationError);
    await expect(getGstr1(as(tenant, "STAFF").ctx, "2026-11")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const composition = await createTenant({ gstScheme: "COMPOSITION" });
    await expect(getGstr1(composition.ctx, "2026-11")).rejects.toMatchObject({
      issues: [{ path: "period", message: "gstr1NotRegular" }],
    });
    expect((await getGstr1Options(composition.ctx)).available).toBe(false);
  });
});

describe("getGstr1Options and gstr1File", () => {
  it("offers the last 12 months and 4 quarters, and builds the workbook", async () => {
    const { tenant } = await shop();
    const options = await getGstr1Options(tenant.ctx);
    expect(options).toMatchObject({ available: true });
    expect(options.months[0]).toBe("2026-12");
    expect(options.quarters[0]).toBe("26-27-Q3");

    const file = await gstr1File(tenant.ctx, { period: "2026-11" });
    expect(file.filename).toBe("gstr1-helper-2026-11.xlsx");
    expect(file.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const raw = Buffer.from(file.bytes).toString("latin1");
    expect(raw.startsWith("PK")).toBe(true);
    // Ten sheets: Read me, b2b, b2cl, b2cs, cdnr, cdnur, exemp, hsn(b2b), hsn(b2c), docs.
    expect(raw).toContain("xl/worksheets/sheet10.xml");
    expect(raw).not.toContain("xl/worksheets/sheet11.xml");
    await expect(gstr1File(tenant.ctx, { period: "2026-11", extra: "1" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("gstr1.service tenant isolation", () => {
  const arrange = async (owner: Tenant) => {
    const buyer = await customer(owner, "Owner's Buyer", "29AABCU9603R1ZM");
    await invoice(owner, "2026-11-02", buyer, [line({})]);
    onDay("2026-11-20");
    return buyer;
  };
  itIsolatesTenants({
    getGstr1: isolationCase({
      arrange,
      act: async (intruder) => {
        const { report } = await getGstr1(intruder.ctx, "2026-11");
        expect(report.b2b).toEqual([]);
        expect(report.docs).toEqual([]);
        return report;
      },
    }),
    gstr1File: isolationCase({
      arrange,
      act: async (intruder) => (await gstr1File(intruder.ctx, { period: "2026-11" })).filename,
    }),
    getGstr1Options: isolationCase({
      arrange,
      act: (intruder) => getGstr1Options(intruder.ctx),
    }),
  });
});
