import { MAX_REPORT_DAYS } from "@/lib/config";
import { ValidationError } from "@/lib/errors";
import {
  hsnQuerySchema,
  type ReportFormat,
  type ReportPeriodQuery,
  salesRegisterQuerySchema,
} from "@/lib/validation/reports";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { hsnLines, registerCreditNotes, registerInvoices } from "@/server/db/repos/reports.repo";
import { istDateFromInstant } from "@/server/domain/fy";
import { type HsnRow, hsnSummary, type HsnTotals } from "@/server/domain/reports/hsn";
import { presetRange, rangeProblem, type ReportPreset } from "@/server/domain/reports/period";
import {
  type RegisterRow,
  type RegisterTotals,
  salesRegister,
} from "@/server/domain/reports/register";
import {
  type DownloadFile,
  hsnCsv,
  salesRegisterCsv,
  salesRegisterXlsx,
} from "@/server/reports/files";

import { parseInput } from "./validate";

/*
 * Reports for the owner and the accountant (SPEC F8, `reports:export`): the sales register and the
 * HSN summary for a period of business dates, on screen and as files. Reads only, so no audit row.
 */

export interface ReportPeriod {
  from: string;
  to: string;
  /** Null for a custom range. */
  preset: ReportPreset | null;
}

/** A preset (this month by default) or a custom range; a bad custom range is a field error. */
export function resolvePeriod(query: ReportPeriodQuery, today: string): ReportPeriod {
  if (query.from !== undefined && query.to !== undefined) {
    const problem = rangeProblem(query.from, query.to, MAX_REPORT_DAYS);
    if (problem) {
      throw new ValidationError("Some fields need attention", [{ path: "from", message: problem }]);
    }
    return { from: query.from, to: query.to, preset: null };
  }
  const preset = query.preset ?? "thisMonth";
  return { ...presetRange(preset, today), preset };
}

function today(): string {
  return istDateFromInstant(now());
}

export interface SalesRegister {
  period: ReportPeriod;
  rows: RegisterRow[];
  totals: RegisterTotals;
}

export async function getSalesRegister(
  ctx: TenantContext,
  query: ReportPeriodQuery,
): Promise<SalesRegister> {
  assertCan(ctx, "reports:export");
  const period = resolvePeriod(query, today());
  const db = getDb();
  const [invoices, notes] = await Promise.all([
    registerInvoices(db, ctx, period),
    registerCreditNotes(db, ctx, period),
  ]);
  return { period, ...salesRegister(invoices, notes) };
}

export interface HsnReport {
  period: ReportPeriod;
  rows: HsnRow[];
  totals: HsnTotals;
}

export async function getHsnSummary(
  ctx: TenantContext,
  query: ReportPeriodQuery,
): Promise<HsnReport> {
  assertCan(ctx, "reports:export");
  const period = resolvePeriod(query, today());
  return { period, ...hsnSummary(await hsnLines(getDb(), ctx, period)) };
}

/** The sales register as a download: `?preset=` or `?from=&to=`, `&format=csv|xlsx`. */
export async function salesRegisterFile(ctx: TenantContext, input: unknown): Promise<DownloadFile> {
  const { format, ...query } = parseInput(salesRegisterQuerySchema, input);
  const register = await getSalesRegister(ctx, query);
  const formats: Record<ReportFormat, () => Promise<DownloadFile>> = {
    csv: () => Promise.resolve(salesRegisterCsv(register)),
    xlsx: () => salesRegisterXlsx(register),
  };
  return formats[format]();
}

/** The HSN summary as CSV. */
export async function hsnFile(ctx: TenantContext, input: unknown): Promise<DownloadFile> {
  return hsnCsv(await getHsnSummary(ctx, parseInput(hsnQuerySchema, input)));
}
