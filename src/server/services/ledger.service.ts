import { z } from "zod";

import { AGING_LIMITS } from "@/lib/config";
import { NotFoundError } from "@/lib/errors";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { type Customer, findCustomerById } from "@/server/db/repos/customers.repo";
import {
  customerBalances,
  ledgerCreditNotes,
  ledgerInvoices,
  type LedgerInvoiceRow,
  ledgerPayments,
  type LedgerPaymentRow,
} from "@/server/db/repos/ledger.repo";
import { customerCreditSums } from "@/server/db/repos/payments.repo";
import { istDateFromInstant } from "@/server/domain/fy";
import { balancePaise } from "@/server/domain/invoice/status";
import { type Aging, ageReceivables } from "@/server/domain/ledger/aging";
import { type CustomerCredit, customerCredit } from "@/server/domain/ledger/customer-credit";
import { buildLedger, type Ledger } from "@/server/domain/ledger/ledger";
import { LEDGER_PERIODS, type LedgerPeriod, periodStart } from "@/server/domain/ledger/period";

import { requireId } from "./ids";
import { parseInput } from "./validate";

/*
 * The customer ledger, udhaar (SPEC §4.9, F7): opening balance + invoices − payments − credit
 * notes with a running balance, the aging of what is still due, and money on account. The ledger
 * page and the statement PDF both read it. Reads only, so no audit row.
 */

export interface OpenInvoiceView {
  id: string;
  number: string;
  invoiceDate: string;
  dueDate: string | null;
  balancePaise: bigint;
}

export interface CustomerLedger {
  customer: Customer;
  ledger: Ledger;
  aging: Aging;
  credit: CustomerCredit;
  /** Oldest first: the invoices with something still due. */
  openInvoices: OpenInvoiceView[];
  /** Mode and reference of each payment row, by payment id. */
  payments: Record<string, Pick<LedgerPaymentRow, "mode" | "reference">>;
  /** Today in Asia/Kolkata (the aging date). */
  today: string;
  /** The first day shown (earlier rows are brought forward), or null for all time. */
  from: string | null;
}

const ledgerQuerySchema = z.object({
  /** Show rows from this date; earlier ones fold into the balance brought forward. */
  from: z.iso.date({ error: "dateInvalid" }).nullable().default(null),
  /** Or a named period up to today (decision 10); wins over `from`. */
  period: z.enum(LEDGER_PERIODS).optional(),
});

export type { LedgerPeriod };

function openInvoices(rows: readonly LedgerInvoiceRow[]): OpenInvoiceView[] {
  return rows
    .map((row) => ({
      id: row.id,
      number: row.number,
      invoiceDate: row.invoiceDate,
      dueDate: row.dueDate,
      balancePaise: balancePaise(row),
    }))
    .filter((row) => row.balancePaise > 0n);
}

export async function getCustomerLedger(
  ctx: TenantContext,
  customerId: string,
  query: unknown = {},
): Promise<CustomerLedger> {
  assertCan(ctx, "records:view");
  const parsed = parseInput(ledgerQuerySchema, query);
  const db = getDb();
  const customer = await findCustomerById(db, ctx, requireId(customerId, "Customer"));
  if (!customer) throw new NotFoundError("Customer");

  const [invoices, creditNotes, payments, sums] = await Promise.all([
    ledgerInvoices(db, ctx, customer.id),
    ledgerCreditNotes(db, ctx, customer.id),
    ledgerPayments(db, ctx, customer.id),
    customerCreditSums(db, ctx, customer.id),
  ]);
  const today = istDateFromInstant(now());
  const from = parsed.period ? periodStart(parsed.period, today) : parsed.from;
  const credit = customerCredit({ openingBalancePaise: customer.openingBalancePaise, ...sums });
  const ledger = buildLedger(
    {
      openingBalancePaise: customer.openingBalancePaise,
      openingDate: istDateFromInstant(customer.createdAt),
      invoices: invoices.map((row) => ({
        id: row.id,
        number: row.number,
        date: row.invoiceDate,
        grandTotalPaise: row.grandTotalPaise,
      })),
      creditNotes: creditNotes.map((row) => ({
        id: row.id,
        number: row.number,
        date: row.noteDate,
        grandTotalPaise: row.grandTotalPaise,
      })),
      payments: payments.map((row) => ({
        id: row.id,
        date: row.paymentDate,
        amountPaise: row.amountPaise,
      })),
    },
    from,
  );
  const open = openInvoices(invoices);
  const aging = ageReceivables(
    {
      openInvoices: open,
      openingOwedPaise: credit.openingOwedPaise,
      onAccountPaise: credit.onAccountPaise,
      today,
    },
    AGING_LIMITS,
  );
  return {
    customer,
    ledger,
    aging,
    credit,
    openInvoices: open,
    payments: Object.fromEntries(
      payments.map((row) => [row.id, { mode: row.mode, reference: row.reference }]),
    ),
    today,
    from,
  };
}

const UUID = z.uuid();

/** Each customer's ledger balance, for a page of the customer list. Unknown ids are skipped. */
export async function getCustomerBalances(
  ctx: TenantContext,
  customerIds: readonly string[],
): Promise<Map<string, bigint>> {
  assertCan(ctx, "records:view");
  const ids = customerIds.filter((id) => UUID.safeParse(id).success);
  return customerBalances(getDb(), ctx, ids);
}
