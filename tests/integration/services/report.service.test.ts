import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, ValidationError } from "@/lib/errors";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { type Customer, insertCustomer } from "@/server/db/repos/customers.repo";
import { cancelInvoice, createCreditNote } from "@/server/services/credit-note.service";
import {
  createDraft,
  getInvoice,
  type Invoice,
  issueInvoice,
} from "@/server/services/invoice.service";
import {
  getHsnSummary,
  getSalesRegister,
  hsnFile,
  salesRegisterFile,
} from "@/server/services/report.service";

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

function registered(tenant: Tenant): Promise<Customer> {
  return insertCustomer(getDb(), tenant.ctx, {
    name: "Shah Stores",
    openingBalancePaise: 0n,
    creditDays: 0,
    gstin: "29AABCU9603R1ZM",
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
    qty: "2",
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
  customer: Customer | null,
  item: Partial<DraftLine>,
): Promise<Invoice> {
  onDay(date);
  const draft = await createDraft(tenant.ctx, { customerId: customer?.id ?? null, lines: [item] });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

/**
 * Today is 11-11-2026. November: pipes to Shah Stores (Karnataka, IGST) on 02-11, one returned on
 * 07-11; rice to a walk-in on 05-11 (5%, CGST + SGST); ₹999 on 06-11, cancelled. October: ₹50.
 */
async function shop() {
  const tenant = await createTenant();
  const shah = await registered(tenant);
  const pipes = await invoice(tenant, "2026-11-02", shah, line({}));
  await invoice(
    tenant,
    "2026-11-05",
    null,
    line({ description: "Rice", hsnSac: "1006", unit: "KGS", rateBp: 500 }),
  );
  const wrong = await invoice(
    tenant,
    "2026-11-06",
    null,
    line({ qty: "1", unitPrice: "999", rateBp: 0 }),
  );
  await cancelInvoice(tenant.ctx, wrong.id, { reason: "Entered twice" });
  await invoice(tenant, "2026-10-30", null, line({ qty: "1", unitPrice: "50", rateBp: 0 }));
  const [pipe] = (await getInvoice(tenant.ctx, pipes.id)).lines;
  onDay("2026-11-07");
  await createCreditNote(tenant.ctx, pipes.id, {
    reason: "Goods returned",
    lines: [{ invoiceLineId: pipe?.id ?? "", qty: "1" }],
  });
  onDay("2026-11-11");
  return { tenant, pipes };
}

describe("getSalesRegister", () => {
  it("lists the month's invoices and credit notes; cancelled at zero; totals net", async () => {
    const { tenant } = await shop();
    const register = await getSalesRegister(as(tenant, "ACCOUNTANT").ctx, {});
    expect(register.period).toEqual({ from: "2026-11-01", to: "2026-11-11", preset: "thisMonth" });
    expect(
      register.rows.map((row) => [row.date, row.kind, row.status, row.customer, row.totalPaise]),
    ).toEqual([
      ["2026-11-02", "INVOICE", "ISSUED", "Shah Stores", 23_600n],
      ["2026-11-05", "INVOICE", "ISSUED", null, 21_000n],
      ["2026-11-06", "INVOICE", "CANCELLED", null, 0n],
      ["2026-11-07", "CREDIT_NOTE", "CREDIT_NOTE", "Shah Stores", -11_800n],
    ]);
    expect(register.rows[0]).toMatchObject({ gstin: "29AABCU9603R1ZM", placeOfSupply: "29" });
    expect(register.rows[3]?.against).toBe(register.rows[0]?.number);
    expect(register.totals).toEqual({
      invoices: 3,
      cancelled: 1,
      creditNotes: 1,
      taxablePaise: 30_000n,
      cgstPaise: 500n,
      sgstPaise: 500n,
      utgstPaise: 0n,
      igstPaise: 1_800n,
      roundOffPaise: 0n,
      totalPaise: 32_800n,
    });
  });

  it("takes presets and custom ranges, and refuses a bad range", async () => {
    const { tenant } = await shop();
    const october = await getSalesRegister(tenant.ctx, { preset: "lastMonth" });
    expect(october.rows.map((row) => row.totalPaise)).toEqual([5_000n]);
    const custom = await getSalesRegister(tenant.ctx, { from: "2026-11-05", to: "2026-11-05" });
    expect(custom.period.preset).toBeNull();
    expect(custom.rows).toHaveLength(1);
    await expect(
      getSalesRegister(tenant.ctx, { from: "2026-11-10", to: "2026-11-01" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("is for the owner and the accountant only", async () => {
    const { tenant } = await shop();
    await expect(getSalesRegister(as(tenant, "STAFF").ctx, {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(getHsnSummary(as(tenant, "STAFF").ctx, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("getHsnSummary", () => {
  it("groups the month by HSN, unit and rate; returns subtract; cancelled left out", async () => {
    const { tenant } = await shop();
    const { rows, totals } = await getHsnSummary(tenant.ctx, {});
    expect(rows).toEqual([
      {
        hsn: "1006",
        uqc: "KGS",
        rateBp: 500,
        qtyMilli: 2_000n,
        taxablePaise: 20_000n,
        igstPaise: 0n,
        cgstPaise: 500n,
        sgstPaise: 500n,
        totalPaise: 21_000n,
      },
      {
        hsn: "3917",
        uqc: "NOS",
        rateBp: 1800,
        qtyMilli: 1_000n,
        taxablePaise: 10_000n,
        igstPaise: 1_800n,
        cgstPaise: 0n,
        sgstPaise: 0n,
        totalPaise: 11_800n,
      },
    ]);
    expect(totals.totalPaise).toBe(32_800n);
  });
});

describe("report files", () => {
  it("the sales register as CSV: BOM, English labels, rupees, the state's name", async () => {
    const { tenant, pipes } = await shop();
    const file = await salesRegisterFile(tenant.ctx, { format: "csv" });
    expect(file).toMatchObject({
      filename: "sales-register-2026-11-01-to-2026-11-11.csv",
      contentType: "text/csv; charset=utf-8",
    });
    // `ignoreBOM` keeps the byte-order mark in the text, so the test can see it.
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(file.bytes);
    expect(text.startsWith("﻿Date,Type,Number,Against invoice,Customer,GSTIN")).toBe(true);
    expect(text).toContain(
      `02-11-2026,Invoice,${pipes.number ?? ""},,Shah Stores,29AABCU9603R1ZM,Karnataka (29),Unpaid,200.00,0.00,0.00,0.00,36.00,0.00,236.00,0.00,118.00,118.00`,
    );
    expect(text).toContain("Walk-in customer");
    expect(text).toContain("Cancelled");
    expect(text).toContain("Credit note");
    expect(text.trimEnd().split("\r\n").at(-1)).toBe(
      "Total,,,,,,,,300.00,5.00,5.00,0.00,18.00,0.00,328.00,,,",
    );
  });

  it("the sales register as Excel, and the HSN summary as CSV", async () => {
    const { tenant } = await shop();
    const xlsx = await salesRegisterFile(tenant.ctx, { preset: "thisMonth", format: "xlsx" });
    expect(xlsx.filename).toBe("sales-register-2026-11-01-to-2026-11-11.xlsx");
    expect(xlsx.contentType).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(Buffer.from(xlsx.bytes.subarray(0, 2)).toString("latin1")).toBe("PK");

    const hsn = await hsnFile(tenant.ctx, {});
    const text = new TextDecoder().decode(hsn.bytes);
    expect(hsn.filename).toBe("hsn-summary-2026-11-01-to-2026-11-11.csv");
    expect(text).toContain("1006,KGS,5%,2,200.00,0.00,5.00,5.00,210.00");
    expect(text).toContain("3917,NOS,18%,1,100.00,18.00,0.00,0.00,118.00");
  });

  it("refuses unknown query keys and formats", async () => {
    const { tenant } = await shop();
    await expect(salesRegisterFile(tenant.ctx, { format: "pdf" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(hsnFile(tenant.ctx, { extra: "1" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("report.service tenant isolation", () => {
  const arrange = async (owner: Tenant) => {
    const customer = await registered(owner);
    await invoice(owner, "2026-11-11", customer, line({ description: "Secret pipe" }));
    return customer;
  };
  itIsolatesTenants({
    getSalesRegister: isolationCase({
      arrange,
      act: async (intruder) => {
        const register = await getSalesRegister(intruder.ctx, {});
        expect(register.rows).toEqual([]);
        return register;
      },
    }),
    getHsnSummary: isolationCase({
      arrange,
      act: async (intruder) => {
        const summary = await getHsnSummary(intruder.ctx, {});
        expect(summary.rows).toEqual([]);
        return summary;
      },
    }),
    salesRegisterFile: isolationCase({
      arrange,
      act: async (intruder) => {
        const file = await salesRegisterFile(intruder.ctx, { format: "csv" });
        expect(new TextDecoder().decode(file.bytes)).not.toContain("Shah Stores");
        return file.filename;
      },
    }),
    hsnFile: isolationCase({
      arrange,
      act: async (intruder) => {
        const file = await hsnFile(intruder.ctx, {});
        expect(new TextDecoder().decode(file.bytes)).not.toContain("3917");
        return file.filename;
      },
    }),
  });
});
