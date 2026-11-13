import { hashPassword } from "better-auth/crypto";

import { type Role, type TenantContext } from "@/server/authz/context";
import { atTime, now } from "@/server/clock";
import { ensureDemoBusiness, ensureDemoUsers, wipeDemoBusiness } from "@/server/db/admin/demo";
import { getDb } from "@/server/db/client";
import { insertCustomers } from "@/server/db/repos/customers.repo";
import { findInvoiceLines, findOpenInvoicesForCustomer } from "@/server/db/repos/invoices.repo";
import { insertProducts, type Product } from "@/server/db/repos/products.repo";
import { DEMO_BUSINESS, DEMO_PRODUCTS, DEMO_RATE_BP } from "@/server/demo/catalog";
import { DEMO_SEED, type DemoEvent, demoGstin, demoPlan, type DemoRole } from "@/server/demo/plan";
import { DEMO_USERS, demoPassword } from "@/server/demo/users";
import { istDateFromInstant, istStartOfDay } from "@/server/domain/fy";
import { balancePaise } from "@/server/domain/invoice/status";
import { formatRupees, parseRupees, sumPaise } from "@/server/domain/money";
import { cancelInvoice, createCreditNote } from "@/server/services/credit-note.service";
import { createDraft, issueInvoice } from "@/server/services/invoice.service";
import { recordPayment } from "@/server/services/payment.service";

/** The shop opens at 10:00 IST; each event of a day is a minute after the last. */
const OPENING_MS = 10 * 60 * 60 * 1000;
/** Customers settle in round amounts, and never less than this. */
const MIN_PAYMENT_PAISE = 10_000n;

export interface DemoResetSummary {
  date: string;
  businessId: string;
  invoices: number;
  cancelled: number;
  creditNotes: number;
  payments: number;
  /** Planned payments skipped because the customer owed less than ₹100 by then. */
  skippedPayments: number;
  ms: number;
}

interface Replay {
  ctx: (role: DemoRole) => TenantContext;
  products: Product[];
  customerIds: string[];
  /** Issued invoices by their plan index. */
  invoices: Map<number, { id: string; walkIn: boolean; grandTotalPaise: bigint }>;
  summary: DemoResetSummary;
}

function draftLines(replay: Replay, event: Extract<DemoEvent, { kind: "invoice" }>) {
  return event.lines.map((line) => {
    const product = replay.products[line.product];
    if (!product) throw new Error(`demo product ${String(line.product)} is missing`);
    return {
      productId: product.id,
      description: product.name,
      hsnSac: product.hsnSac,
      unit: product.unit,
      qty: line.qty,
      unitPrice: formatRupees(product.pricePaise),
      discount: "",
      rateBp: product.rateBp,
      priceIncludesTax: product.priceIncludesTax,
    };
  });
}

async function issue(replay: Replay, event: Extract<DemoEvent, { kind: "invoice" }>, date: string) {
  const ctx = replay.ctx(event.by);
  const customerId = event.customer === null ? null : replay.customerIds[event.customer];
  if (customerId === undefined)
    throw new Error(`demo customer ${String(event.customer)} is missing`);
  const draft = await createDraft(ctx, {
    customerId,
    walkInName: event.walkInName,
    lines: draftLines(replay, event),
  });
  let result = await issueInvoice(ctx, draft.id, {
    version: draft.version,
    acknowledgedWarnings: [],
  });
  // A warning (say, a large sale without the buyer's address) is acknowledged, as a person would.
  if (result.status === "needsConfirmation") {
    result = await issueInvoice(ctx, draft.id, {
      version: draft.version,
      acknowledgedWarnings: result.warnings,
    });
  }
  if (result.status !== "issued") throw new Error(`demo invoice on ${date} was not issued`);
  replay.invoices.set(event.invoice, {
    id: result.invoice.id,
    walkIn: customerId === null,
    grandTotalPaise: result.invoice.grandTotalPaise,
  });
  replay.summary.invoices += 1;
}

async function apply(replay: Replay, event: DemoEvent, date: string): Promise<void> {
  switch (event.kind) {
    case "invoice":
      await issue(replay, event, date);
      return;
    case "counterPayment": {
      const invoice = replay.invoices.get(event.invoice);
      if (!invoice) throw new Error("counter payment before its invoice");
      const amount = formatRupees(invoice.grandTotalPaise);
      await recordPayment(replay.ctx(event.by), {
        customerId: null,
        amount,
        paymentDate: date,
        mode: event.mode,
        allocation: { kind: "MANUAL", items: [{ invoiceId: invoice.id, amount }] },
      });
      replay.summary.payments += 1;
      return;
    }
    case "payment": {
      const ctx = replay.ctx(event.by);
      const customerId = replay.customerIds[event.customer];
      if (!customerId) throw new Error("payment from a missing customer");
      const owed = sumPaise(
        (await findOpenInvoicesForCustomer(getDb(), ctx, customerId)).map((invoice) =>
          balancePaise(invoice),
        ),
      );
      // Round amounts, like people pay: all of it, or about half rounded down to ₹10.
      const amount = event.share === "all" ? owed : (owed / 2n / 1000n) * 1000n;
      if (amount < MIN_PAYMENT_PAISE) {
        replay.summary.skippedPayments += 1;
        return;
      }
      await recordPayment(ctx, {
        customerId,
        amount: formatRupees(amount),
        paymentDate: date,
        mode: event.mode,
        reference: event.mode === "CHEQUE" || event.mode === "BANK_TRANSFER" ? "DEMO" : "",
        allocation: { kind: "AUTO" },
      });
      replay.summary.payments += 1;
      return;
    }
    case "cancel": {
      const invoice = replay.invoices.get(event.invoice);
      if (!invoice) throw new Error("cancelling an invoice that wasn't issued");
      await cancelInvoice(replay.ctx("OWNER"), invoice.id, { reason: event.reason });
      replay.summary.cancelled += 1;
      return;
    }
    case "creditNote": {
      const invoice = replay.invoices.get(event.invoice);
      if (!invoice) throw new Error("a return for an invoice that wasn't issued");
      const ctx = replay.ctx("OWNER");
      const line = (await findInvoiceLines(getDb(), ctx, invoice.id))[event.line];
      if (!line) throw new Error("a return for a line that isn't on the invoice");
      await createCreditNote(ctx, invoice.id, {
        reason: event.reason,
        lines: [{ invoiceLineId: line.id, qty: "1" }],
        // A walk-in has no account to keep the money: it is handed back at the counter.
        ...(invoice.walkIn ? { refund: { mode: "CASH" } } : {}),
      });
      replay.summary.creditNotes += 1;
      return;
    }
  }
}

/**
 * Rebuilds the demo business from scratch (SPEC F12, ADR 0018): restores its settings and its
 * two users, empties it, then replays six months of a shop through the real services, each
 * event at its own moment. The same seed and day always give the same shop.
 */
export async function runDemoReset(
  at: Date = now(),
  seed: number = DEMO_SEED,
): Promise<DemoResetSummary> {
  const started = Date.now();
  const db = getDb();
  const today = istDateFromInstant(at);
  const businessId = await ensureDemoBusiness(db, {
    slug: DEMO_BUSINESS.slug,
    legalName: DEMO_BUSINESS.legalName,
    tradeName: DEMO_BUSINESS.tradeName,
    addressLine1: DEMO_BUSINESS.addressLine1,
    addressLine2: DEMO_BUSINESS.addressLine2,
    city: DEMO_BUSINESS.city,
    pincode: DEMO_BUSINESS.pincode,
    stateCode: DEMO_BUSINESS.stateCode,
    gstScheme: DEMO_BUSINESS.gstScheme,
    gstin: demoGstin(DEMO_BUSINESS.stateCode, DEMO_BUSINESS.panBody),
    invoicePrefix: DEMO_BUSINESS.invoicePrefix,
    creditNotePrefix: DEMO_BUSINESS.creditNotePrefix,
    hsnDigitsRequired: DEMO_BUSINESS.hsnDigitsRequired,
  });
  const userIds = await ensureDemoUsers(
    db,
    businessId,
    await Promise.all(
      DEMO_USERS.map(async (user) => ({
        ...user,
        passwordHash: await hashPassword(demoPassword(user.role)),
      })),
    ),
  );
  await wipeDemoBusiness(businessId);

  const ctx = (role: Role): TenantContext => {
    const userId = userIds.get(role);
    if (!userId) throw new Error(`no demo user for ${role}`);
    return { userId, businessId, role };
  };
  const plan = demoPlan(today, seed);
  const opened = istStartOfDay(plan.days[0]?.date ?? today);
  const [products, customers] = await atTime(opened, () =>
    Promise.all([
      insertProducts(
        db,
        ctx("OWNER"),
        DEMO_PRODUCTS.map((product) => ({
          name: product.name,
          hsnSac: product.hsnSac,
          unit: product.unit,
          pricePaise: parseRupees(product.price),
          rateBp: DEMO_RATE_BP,
          priceIncludesTax: product.priceIncludesTax ?? false,
          sku: product.sku,
        })),
      ),
      insertCustomers(
        db,
        ctx("OWNER"),
        plan.customers.map((customer) => ({
          name: customer.name,
          gstin: customer.gstin,
          billingAddressLine1: customer.addressLine1,
          billingCity: customer.city,
          billingPincode: customer.pincode,
          billingStateCode: customer.stateCode,
          creditDays: customer.creditDays,
          openingBalancePaise: 0n,
        })),
      ),
    ]),
  );

  // Products by SKU; customers come back in the order inserted (checked, names can repeat).
  const productBySku = new Map(products.map((product) => [product.sku, product]));
  const orderedProducts = DEMO_PRODUCTS.map((product) => {
    const row = productBySku.get(product.sku);
    if (!row) throw new Error(`demo product ${product.sku} was not inserted`);
    return row;
  });
  if (customers.some((customer, index) => customer.name !== plan.customers[index]?.name)) {
    throw new Error("demo customers came back in a different order");
  }

  const replay: Replay = {
    ctx,
    products: orderedProducts,
    customerIds: customers.map((customer) => customer.id),
    invoices: new Map(),
    summary: {
      date: today,
      businessId,
      invoices: 0,
      cancelled: 0,
      creditNotes: 0,
      payments: 0,
      skippedPayments: 0,
      ms: 0,
    },
  };
  for (const day of plan.days) {
    const opening = istStartOfDay(day.date).getTime() + OPENING_MS;
    for (const [index, event] of day.events.entries()) {
      await atTime(new Date(opening + index * 60_000), () => apply(replay, event, day.date));
    }
  }
  replay.summary.ms = Date.now() - started;
  return replay.summary;
}
