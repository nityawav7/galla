import { AGING_LIMITS } from "@/lib/config";
import { NotFoundError } from "@/lib/errors";
import { type TenantContext } from "@/server/authz/context";
import { assertCan, can } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import {
  customerPaymentsSince,
  dailyNetSales,
  openingOwed,
  openInvoiceBalances,
  overdueInvoiceCount,
  productSales,
  receivables,
  remindersSince,
  type SalesWindow,
  salesTotals,
} from "@/server/db/repos/dashboard.repo";
import { type Recovery, recoveredAfterReminders } from "@/server/domain/dashboard/recovery";
import { dailySeries, type DayValue } from "@/server/domain/dashboard/series";
import { topN } from "@/server/domain/dashboard/top";
import { addDays, istDateFromInstant } from "@/server/domain/fy";
import { type Aging, ageReceivables } from "@/server/domain/ledger/aging";

/*
 * The dashboard (SPEC F8, decisions 4–9 of the Phase 9 plan). Every role sees counts; money only
 * with `dashboard:viewTotals` (owner and accountant), decided here so a staff member's browser
 * never receives a rupee amount. Reads only, so no audit row.
 */

export const DASHBOARD_DAYS = 30;
export const DASHBOARD_TOP = 5;

export interface TopProduct {
  key: string;
  name: string;
  unit: string;
  /** Net taxable value (owner and accountant) or net quantity (staff), last 30 days. */
  value: bigint;
}

export interface DashboardCounts {
  invoicesToday: number;
  invoicesThisMonth: number;
  overdueInvoices: number;
  /** By quantity, last 30 days. */
  topProducts: TopProduct[];
}

export interface DashboardMoney {
  todaySalesPaise: bigint;
  monthSalesPaise: bigint;
  /** Null for composition and unregistered businesses, which collect no GST. */
  monthGstPaise: bigint | null;
  receivablePaise: bigint;
  advancesPaise: bigint;
  overduePaise: bigint;
  recovery: Recovery;
  daily: DayValue[];
  /** By net taxable value, last 30 days. */
  topProducts: TopProduct[];
  topDebtors: { customerId: string; name: string; balancePaise: bigint }[];
  aging: Aging;
}

export interface Dashboard {
  today: string;
  counts: DashboardCounts;
  /** Null for staff (no `dashboard:viewTotals`). */
  money: DashboardMoney | null;
}

function windowFor(today: string): SalesWindow {
  return {
    today,
    monthStart: `${today.slice(0, 8)}01`,
    since: addDays(today, -(DASHBOARD_DAYS - 1)),
  };
}

async function recovery(ctx: TenantContext, today: string, at: Date): Promise<Recovery> {
  const db = getDb();
  const since = new Date(at.getTime() - DASHBOARD_DAYS * 24 * 60 * 60 * 1000);
  const reminders = (await remindersSince(db, ctx, since)).map((row) => ({
    customerId: row.customerId,
    date: istDateFromInstant(row.at),
    overduePaise: row.overduePaise,
  }));
  const customers = [...new Set(reminders.map((row) => row.customerId))];
  const first = reminders.reduce((min, row) => (row.date < min ? row.date : min), today);
  const payments = await customerPaymentsSince(db, ctx, customers, first);
  return recoveredAfterReminders(reminders, payments);
}

export async function getDashboard(ctx: TenantContext): Promise<Dashboard> {
  assertCan(ctx, "records:view");
  const db = getDb();
  const at = now();
  const today = istDateFromInstant(at);
  const window = windowFor(today);
  const [totals, products, overdueInvoices] = await Promise.all([
    salesTotals(db, ctx, window),
    productSales(db, ctx, window),
    overdueInvoiceCount(db, ctx, today),
  ]);
  const ranked = (by: "taxablePaise" | "qtyMilli") =>
    topN(
      products.map((product) => ({ ...product, label: product.name, value: product[by] })),
      DASHBOARD_TOP,
    ).map(({ key, name, unit, value }) => ({ key, name, unit, value }));
  const counts: DashboardCounts = {
    invoicesToday: totals.invoicesToday,
    invoicesThisMonth: totals.invoicesThisMonth,
    overdueInvoices,
    topProducts: ranked("qtyMilli"),
  };
  if (!can(ctx, "dashboard:viewTotals")) return { today, counts, money: null };

  const [business, days, owed, open, owing, recovered] = await Promise.all([
    getCurrentBusiness(db, ctx),
    dailyNetSales(db, ctx, window),
    receivables(db, ctx, DASHBOARD_TOP),
    openInvoiceBalances(db, ctx),
    openingOwed(db, ctx),
    recovery(ctx, today, at),
  ]);
  if (!business) throw new NotFoundError("Business");
  const aging = ageReceivables(
    { openInvoices: open, openingOwedPaise: owing, onAccountPaise: 0n, today },
    AGING_LIMITS,
  );
  return {
    today,
    counts,
    money: {
      todaySalesPaise: totals.todayPaise,
      monthSalesPaise: totals.monthPaise,
      monthGstPaise: business.gstScheme === "REGULAR" ? totals.monthTaxPaise : null,
      receivablePaise: owed.receivablePaise,
      advancesPaise: owed.advancesPaise,
      overduePaise: aging.overduePaise,
      recovery: recovered,
      daily: dailySeries(days, today, DASHBOARD_DAYS),
      topProducts: ranked("taxablePaise"),
      topDebtors: owed.topDebtors,
      aging,
    },
  };
}
