import { createTranslator } from "next-intl";

import { NotFoundError, ValidationError } from "@/lib/errors";
import { B2CL_THRESHOLD_PAISE } from "@/lib/gst-config";
import { gstr1QuerySchema } from "@/lib/validation/reports";
import messages from "@/messages/en.json";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { type Business, getCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { gstr1Invoices, gstr1Notes } from "@/server/db/repos/gstr1.repo";
import { istDateFromInstant } from "@/server/domain/fy";
import { buildGstr1, type Gstr1Report } from "@/server/domain/gstr1/build";
import { type Gstr1Period, gstr1Periods, parseGstr1Period } from "@/server/domain/gstr1/period";
import { type DownloadFile } from "@/server/reports/files";
import { gstr1Workbook } from "@/server/reports/gstr1-workbook";

import { parseInput } from "./validate";

/*
 * The GSTR-1 helper for the CA (SPEC §4.10, ADR 0013): a month or quarter's invoices and credit
 * notes, sorted into the offline tool's tables. Only a regular GST business files GSTR-1
 * (decision 12 of the Phase 9 plan); composition dealers and unregistered shops get none.
 * Owner and accountant (`reports:export`). Reads only, so no audit row.
 */

export interface Gstr1Options {
  /** False for composition and unregistered businesses. */
  available: boolean;
  /** "2026-11", newest first. */
  months: string[];
  /** "26-27-Q3", newest first. */
  quarters: string[];
}

async function businessOf(ctx: TenantContext): Promise<Business> {
  const business = await getCurrentBusiness(getDb(), ctx);
  if (!business) throw new NotFoundError("Business");
  return business;
}

export async function getGstr1Options(ctx: TenantContext): Promise<Gstr1Options> {
  assertCan(ctx, "reports:export");
  const business = await businessOf(ctx);
  return {
    available: business.gstScheme === "REGULAR" && business.gstin !== null,
    ...gstr1Periods(istDateFromInstant(now())),
  };
}

/** The tables for a period, before they become a workbook. */
export async function getGstr1(
  ctx: TenantContext,
  value: string,
): Promise<{ period: Gstr1Period; report: Gstr1Report; business: Business }> {
  assertCan(ctx, "reports:export");
  const period = parseGstr1Period(value);
  if (!period)
    throw new ValidationError("Choose a month or quarter", [
      { path: "period", message: "dateInvalid" },
    ]);
  const business = await businessOf(ctx);
  if (business.gstScheme !== "REGULAR" || business.gstin === null) {
    throw new ValidationError("Only a regular GST business files GSTR-1", [
      { path: "period", message: "gstr1NotRegular" },
    ]);
  }
  const db = getDb();
  const [invoices, notes] = await Promise.all([
    gstr1Invoices(db, ctx, period),
    gstr1Notes(db, ctx, period),
  ]);
  return {
    period,
    business,
    report: buildGstr1({ invoices, notes, b2clThresholdPaise: B2CL_THRESHOLD_PAISE }),
  };
}

function periodLabel(period: Gstr1Period): string {
  const month = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const name = (date: string) => month.format(new Date(`${date}T00:00:00Z`));
  if (period.kind === "month") return name(period.from);
  const t = createTranslator({ locale: "en", messages, namespace: "reports.gstr1.readme" });
  return t("quarterPeriod", {
    quarter: period.value.slice(6),
    fy: period.value.slice(0, 5),
    from: name(period.from),
    to: name(period.to),
  });
}

/** The workbook for `?period=2026-11` or `?period=26-27-Q3`. */
export async function gstr1File(ctx: TenantContext, input: unknown): Promise<DownloadFile> {
  const { period: value } = parseInput(gstr1QuerySchema, input);
  const { period, report, business } = await getGstr1(ctx, value);
  return gstr1Workbook(report, {
    businessName: business.tradeName ?? business.legalName,
    gstin: business.gstin ?? "",
    periodLabel: periodLabel(period),
    periodValue: period.value,
    generatedAt: new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata",
    }).format(now()),
  });
}
