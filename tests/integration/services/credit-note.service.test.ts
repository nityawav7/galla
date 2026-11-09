import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type DraftLine, type InvoiceDraftValues } from "@/lib/validation/invoices";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { findInvoiceById } from "@/server/db/repos/invoices.repo";
import { creditNotes } from "@/server/db/schema";
import {
  cancelInvoice,
  createCreditNote,
  getCreditNote,
} from "@/server/services/credit-note.service";
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

const db = () => getDb();

function line(overrides: Partial<DraftLine> = {}): Partial<DraftLine> {
  return {
    productId: null,
    description: "PVC pipe",
    hsnSac: "3917",
    unit: "NOS",
    qty: "3",
    unitPrice: "99.99",
    discount: "10",
    rateBp: 1800,
    priceIncludesTax: false,
    ...overrides,
  };
}

async function tenantAs(role: Role = "OWNER", overrides: Parameters<typeof createTenant>[0] = {}) {
  const owner = await createTenant(overrides);
  return { ...owner, ctx: { ...owner.ctx, role } };
}

/** Issues a two-line invoice: 3 × ₹99.99 − ₹10 and 2 × ₹45.50, intra-state, round-off on. */
async function issued(tenant: Tenant, draft?: InvoiceDraftValues): Promise<Invoice> {
  const created = await createDraft(
    tenant.ctx,
    draft ?? {
      lines: [line(), line({ description: "Elbow", qty: "2", unitPrice: "45.50", discount: "" })],
    },
  );
  const result = await issueInvoice(tenant.ctx, created.id, { version: created.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

async function linesOf(tenant: Tenant, invoice: Invoice) {
  return (await getInvoice(tenant.ctx, invoice.id)).lines;
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

// --- cancel -------------------------------------------------------------------------------

describe("cancelInvoice", () => {
  it("cancels an issued invoice, keeps its number, and audits the reason", async () => {
    const tenant = await tenantAs();
    const invoice = await issued(tenant);
    const cancelled = await cancelInvoice(tenant.ctx, invoice.id, { reason: "Wrong customer" });
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      number: invoice.number,
      cancelReason: "Wrong customer",
      grandTotalPaise: invoice.grandTotalPaise,
    });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    const audit = await listAuditLogs(db(), tenant.ctx, { entityId: invoice.id });
    expect(audit[0]).toMatchObject({
      action: "invoice.cancelled",
      diff: { after: { status: "CANCELLED", reason: "Wrong customer" } },
    });
  });

  it.each<Role>(["STAFF", "ACCOUNTANT"])("refuses %s", async (role) => {
    const owner = await tenantAs();
    const invoice = await issued(owner);
    await expect(
      cancelInvoice({ ...owner.ctx, role }, invoice.id, { reason: "Wrong customer" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("needs a reason", async () => {
    const tenant = await tenantAs();
    const invoice = await issued(tenant);
    expect(await issuesOf(cancelInvoice(tenant.ctx, invoice.id, { reason: "  " }))).toEqual([
      { path: "reason", message: "cancelReasonRequired" },
    ]);
  });

  it("refuses a draft, an already cancelled invoice and one with a credit note", async () => {
    const tenant = await tenantAs();
    const draft = await createDraft(tenant.ctx, { lines: [line()] });
    expect(await conflictOf(cancelInvoice(tenant.ctx, draft.id, { reason: "Oops" }))).toBe(
      "invoiceNotIssued",
    );

    const invoice = await issued(tenant);
    await cancelInvoice(tenant.ctx, invoice.id, { reason: "Duplicate bill" });
    expect(await conflictOf(cancelInvoice(tenant.ctx, invoice.id, { reason: "Again" }))).toBe(
      "invoiceCancelled",
    );

    const credited = await issued(tenant);
    const [first] = await linesOf(tenant, credited);
    await createCreditNote(tenant.ctx, credited.id, {
      reason: "Goods returned",
      lines: [{ invoiceLineId: first?.id ?? "", qty: "1" }],
    });
    expect(await conflictOf(cancelInvoice(tenant.ctx, credited.id, { reason: "Oops" }))).toBe(
      "invoiceHasCredits",
    );
  });
});

// --- credit notes ---------------------------------------------------------------------------

describe("createCreditNote", () => {
  it("returns one unit at the line's own amounts, in its own CN series", async () => {
    const tenant = await tenantAs();
    const invoice = await issued(tenant);
    const [pipe] = await linesOf(tenant, invoice);
    const note = await createCreditNote(tenant.ctx, invoice.id, {
      reason: "Goods returned",
      lines: [{ invoiceLineId: pipe?.id ?? "", qty: "1" }],
    });
    expect(note).toMatchObject({
      number: expect.stringMatching(/^CN\/\d{2}-\d{2}\/0001$/) as unknown,
      invoiceId: invoice.id,
      reason: "Goods returned",
      isInterState: false,
      placeOfSupplyStateCode: "27",
      taxablePaise: 9666n,
      cgstPaise: 870n,
      sgstPaise: 870n,
      roundOffPaise: 0n,
      grandTotalPaise: 11406n,
      supplierSnapshot: { legalName: "Test Traders" },
    });

    const detail = await getCreditNote(tenant.ctx, note.id);
    expect(detail.invoice).toEqual({ id: invoice.id, number: invoice.number });
    expect(detail.lines).toMatchObject([
      {
        position: 1,
        invoiceLineId: pipe?.id,
        description: "PVC pipe",
        qtyMilli: 1000n,
        unitPricePaise: 9999n,
        discountPaise: 333n,
        lineTotalPaise: 11406n,
      },
    ]);
    expect((await findInvoiceById(db(), tenant.ctx, invoice.id))?.amountCreditedPaise).toBe(11406n);
    const audit = await listAuditLogs(db(), tenant.ctx, { entityId: note.id });
    expect(audit.map((row) => row.action)).toEqual(["creditNote.issued"]);
  });

  it("partial returns, then the rest, add up to the invoice exactly (with its round-off)", async () => {
    const tenant = await tenantAs();
    const invoice = await issued(tenant);
    expect(invoice.roundOffPaise).not.toBe(0n);
    const [pipe, elbow] = await linesOf(tenant, invoice);
    const ids = { pipe: pipe?.id ?? "", elbow: elbow?.id ?? "" };

    const first = await createCreditNote(tenant.ctx, invoice.id, {
      reason: "Part return",
      lines: [{ invoiceLineId: ids.pipe, qty: "1" }],
    });
    const second = await createCreditNote(tenant.ctx, invoice.id, {
      reason: "Rest returned",
      lines: [
        { invoiceLineId: ids.pipe, qty: "2" },
        { invoiceLineId: ids.elbow, qty: "2" },
      ],
    });
    expect(first.roundOffPaise).toBe(0n);
    expect(second.roundOffPaise).toBe(invoice.roundOffPaise);
    expect(first.grandTotalPaise + second.grandTotalPaise).toBe(invoice.grandTotalPaise);
    expect(second.number).toMatch(/\/0002$/);

    const detail = await getInvoice(tenant.ctx, invoice.id);
    expect(detail.invoice.amountCreditedPaise).toBe(invoice.grandTotalPaise);
    expect(detail.creditNotes.map((note) => note.id)).toEqual([second.id, first.id]);
    expect(detail.returnedMilli.get(ids.pipe)).toBe(3000n);

    // Nothing is left to return.
    expect(
      await issuesOf(
        createCreditNote(tenant.ctx, invoice.id, {
          reason: "Again",
          lines: [{ invoiceLineId: ids.elbow, qty: "0.001" }],
        }),
      ),
    ).toEqual([{ path: "lines.0.qty", message: "returnTooMany" }]);
  });

  it("numbers credit notes apart from invoices, with the business's prefix", async () => {
    const tenant = await tenantAs("OWNER", { invoicePrefix: "GAL", creditNotePrefix: "GCN" });
    const invoice = await issued(tenant);
    const [pipe] = await linesOf(tenant, invoice);
    const note = await createCreditNote(tenant.ctx, invoice.id, {
      reason: "Returned",
      lines: [{ invoiceLineId: pipe?.id ?? "", qty: "1" }],
    });
    expect(invoice.number).toMatch(/^GAL\/.+\/0001$/);
    expect(note.number).toMatch(/^GCN\/.+\/0001$/);
  });

  it("refuses bad input: too many, zero, unknown or repeated lines, no reason", async () => {
    const tenant = await tenantAs();
    const invoice = await issued(tenant);
    const other = await issued(tenant);
    const [pipe] = await linesOf(tenant, invoice);
    const [otherLine] = await linesOf(tenant, other);
    const id = pipe?.id ?? "";

    expect(
      await issuesOf(
        createCreditNote(tenant.ctx, invoice.id, {
          reason: "Returned",
          lines: [{ invoiceLineId: id, qty: "3.001" }],
        }),
      ),
    ).toEqual([{ path: "lines.0.qty", message: "returnTooMany" }]);
    expect(
      await issuesOf(
        createCreditNote(tenant.ctx, invoice.id, {
          reason: "Returned",
          lines: [{ invoiceLineId: id, qty: "0" }],
        }),
      ),
    ).toEqual([{ path: "lines.0.qty", message: "qtyPositive" }]);
    expect(
      await issuesOf(
        createCreditNote(tenant.ctx, invoice.id, {
          reason: "Returned",
          lines: [
            { invoiceLineId: otherLine?.id ?? "", qty: "1" },
            { invoiceLineId: id, qty: "1" },
            { invoiceLineId: id, qty: "1" },
          ],
        }),
      ),
    ).toEqual([
      { path: "lines.0.invoiceLineId", message: "lineNotOnInvoice" },
      { path: "lines.2.invoiceLineId", message: "duplicateLine" },
    ]);
    expect(
      await issuesOf(createCreditNote(tenant.ctx, invoice.id, { reason: "", lines: [] })),
    ).toEqual([
      { path: "reason", message: "creditReasonRequired" },
      { path: "lines", message: "creditLinesRequired" },
    ]);
    // Nothing was issued, so the CN series is untouched.
    const notes = await db()
      .select()
      .from(creditNotes)
      .where(eq(creditNotes.businessId, tenant.business.id));
    expect(notes).toEqual([]);
  });

  it("refuses a cancelled invoice and a draft", async () => {
    const tenant = await tenantAs();
    const invoice = await issued(tenant);
    const [pipe] = await linesOf(tenant, invoice);
    await cancelInvoice(tenant.ctx, invoice.id, { reason: "Wrong customer" });
    const input = { reason: "Returned", lines: [{ invoiceLineId: pipe?.id ?? "", qty: "1" }] };
    expect(await conflictOf(createCreditNote(tenant.ctx, invoice.id, input))).toBe(
      "invoiceCancelled",
    );
    const draft = await createDraft(tenant.ctx, { lines: [line()] });
    expect(await conflictOf(createCreditNote(tenant.ctx, draft.id, input))).toBe(
      "invoiceNotIssued",
    );
  });

  it("never credits more than the balance, even when two notes race", async () => {
    const tenant = await tenantAs();
    const invoice = await issued(tenant, { lines: [line({ qty: "1", discount: "" })] });
    const [only] = await linesOf(tenant, invoice);
    const input = { reason: "Returned", lines: [{ invoiceLineId: only?.id ?? "", qty: "1" }] };
    const outcomes = await Promise.allSettled([
      createCreditNote(tenant.ctx, invoice.id, input),
      createCreditNote(tenant.ctx, invoice.id, input),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const after = await findInvoiceById(db(), tenant.ctx, invoice.id);
    expect(after?.amountCreditedPaise).toBe(invoice.grandTotalPaise);
  });

  it("refuses a partial note that would exceed the balance after round-off", async () => {
    // ₹100.40 sub-total rounds down to ₹100.00: returning all but a 40-paise remainder
    // would credit ₹100.10 against ₹100.00 owed.
    const tenant = await tenantAs();
    const invoice = await issued(tenant, {
      lines: [
        line({ qty: "1", unitPrice: "100", rateBp: 0, discount: "" }),
        line({ description: "Washer", qty: "4", unitPrice: "0.10", rateBp: 0, discount: "" }),
      ],
    });
    expect(invoice.grandTotalPaise).toBe(10000n);
    const [big, small] = await linesOf(tenant, invoice);
    expect(
      await issuesOf(
        createCreditNote(tenant.ctx, invoice.id, {
          reason: "Returned",
          lines: [
            { invoiceLineId: big?.id ?? "", qty: "1" },
            { invoiceLineId: small?.id ?? "", qty: "1" },
          ],
        }),
      ),
    ).toEqual([{ path: "lines", message: "creditExceedsBalance" }]);
  });

  it("credits a bill of supply without tax", async () => {
    const tenant = await tenantAs("OWNER", { gstScheme: "COMPOSITION" });
    const invoice = await issued(tenant, { lines: [line({ qty: "2", discount: "" })] });
    const [only] = await linesOf(tenant, invoice);
    const note = await createCreditNote(tenant.ctx, invoice.id, {
      reason: "Returned",
      lines: [{ invoiceLineId: only?.id ?? "", qty: "1" }],
    });
    expect(note).toMatchObject({ cgstPaise: 0n, igstPaise: 0n, taxablePaise: 9999n });
  });

  it.each<Role>(["STAFF", "ACCOUNTANT"])("refuses %s, who can still read it", async (role) => {
    const owner = await tenantAs();
    const invoice = await issued(owner);
    const [pipe] = await linesOf(owner, invoice);
    const ctx = { ...owner.ctx, role };
    await expect(
      createCreditNote(ctx, invoice.id, {
        reason: "Returned",
        lines: [{ invoiceLineId: pipe?.id ?? "", qty: "1" }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const note = await createCreditNote(owner.ctx, invoice.id, {
      reason: "Returned",
      lines: [{ invoiceLineId: pipe?.id ?? "", qty: "1" }],
    });
    expect((await getCreditNote(ctx, note.id)).creditNote.id).toBe(note.id);
    await expect(getCreditNote(ctx, "nope")).rejects.toBeInstanceOf(NotFoundError);
  });
});

// --- isolation ----------------------------------------------------------------------------

describe("tenant isolation", () => {
  const unchanged = async (owner: Tenant, invoice: Invoice) => {
    const now = await findInvoiceById(db(), owner.ctx, invoice.id);
    expect(now).toMatchObject({ status: "ISSUED", amountCreditedPaise: 0n });
  };

  itIsolatesTenants({
    cancelInvoice: isolationCase({
      arrange: (owner) => issued(owner),
      act: (intruder, invoice) => cancelInvoice(intruder.ctx, invoice.id, { reason: "Mine now" }),
      verify: unchanged,
    }),
    createCreditNote: isolationCase({
      arrange: async (owner) => {
        const invoice = await issued(owner);
        const [first] = await linesOf(owner, invoice);
        return { id: invoice.id, invoice, lineId: first?.id ?? "" };
      },
      act: (intruder, { id, lineId }) =>
        createCreditNote(intruder.ctx, id, {
          reason: "Returned",
          lines: [{ invoiceLineId: lineId, qty: "1" }],
        }),
      verify: (owner, { invoice }) => unchanged(owner, invoice),
    }),
    getCreditNote: isolationCase({
      arrange: async (owner) => {
        const invoice = await issued(owner);
        const [first] = await linesOf(owner, invoice);
        return createCreditNote(owner.ctx, invoice.id, {
          reason: "Returned",
          lines: [{ invoiceLineId: first?.id ?? "", qty: "1" }],
        });
      },
      act: (intruder, note) => getCreditNote(intruder.ctx, note.id),
    }),
  });
});
