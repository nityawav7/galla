import { type Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ValidationError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { isValidationKey } from "@/lib/validation/messages";
import { type ReportPeriodQuery, reportPageQuerySchema } from "@/lib/validation/reports";
import { requireTenant } from "@/server/auth/session";
import { type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/permissions";
import { formatIndianDate } from "@/server/domain/fy";
import { formatRate } from "@/server/domain/invoice/printable";
import { formatINR } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/quantity";
import { REPORT_PRESETS } from "@/server/domain/reports/period";
import { getGstr1Options } from "@/server/services/gstr1.service";
import {
  getHsnSummary,
  getSalesRegister,
  type ReportPeriod,
} from "@/server/services/report.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");
  return { title: t("title") };
}

type Params = PageProps<"/b/[businessSlug]/reports">;

/** The period asked for, or this month with the reason when it can't be used. */
async function load(ctx: TenantContext, query: ReportPeriodQuery) {
  try {
    const [register, hsn] = await Promise.all([
      getSalesRegister(ctx, query),
      getHsnSummary(ctx, query),
    ]);
    return { register, hsn, problem: null };
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const fallback = { preset: "thisMonth" as const };
    const [register, hsn] = await Promise.all([
      getSalesRegister(ctx, fallback),
      getHsnSummary(ctx, fallback),
    ]);
    return { register, hsn, problem: error.issues[0]?.message ?? null };
  }
}

function periodQuery(period: ReportPeriod): string {
  return period.preset ? `preset=${period.preset}` : `from=${period.from}&to=${period.to}`;
}

/** SPEC F8: the sales register and HSN summary for a period, on screen and to download. */
async function ReportsView({ params, searchParams }: Pick<Params, "params" | "searchParams">) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("reports");
  const validation = await getTranslations("validation");
  if (!can(ctx, "reports:export")) {
    return <p className="text-muted-foreground">{t("notAllowed")}</p>;
  }
  const query = reportPageQuerySchema.parse(await searchParams);
  const [{ register, hsn, problem }, gstr1, locale] = await Promise.all([
    load(ctx, query),
    getGstr1Options(ctx),
    getLocale(),
  ]);
  const monthName = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const { period, totals } = register;
  const base = `/b/${businessSlug}/reports`;
  const files = (path: string, extra = "") => `${base}/${path}?${periodQuery(period)}${extra}`;
  const gst = totals.cgstPaise + totals.sgstPaise + totals.utgstPaise + totals.igstPaise;
  const missingHsn = hsn.rows.some((row) => row.hsn === null);

  return (
    <>
      <section aria-labelledby="period" className="flex flex-col gap-3">
        <h2 id="period" className="sr-only">
          {t("period.label")}
        </h2>
        <nav aria-label={t("period.label")} className="flex flex-wrap gap-2">
          {REPORT_PRESETS.map((preset) => (
            <Link
              key={preset}
              href={`${base}?preset=${preset}`}
              aria-current={period.preset === preset ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                period.preset === preset && "border-primary bg-primary text-primary-foreground",
              )}
            >
              {t(`period.${preset}`)}
            </Link>
          ))}
        </nav>
        <form
          action={base}
          className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-from">{t("period.from")}</Label>
            <Input
              id="report-from"
              type="date"
              name="from"
              defaultValue={period.from}
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="report-to">{t("period.to")}</Label>
            <Input id="report-to" type="date" name="to" defaultValue={period.to} className="h-9" />
          </div>
          <Button type="submit" variant="secondary" size="lg" className="col-span-2 sm:col-span-1">
            {t("period.apply")}
          </Button>
        </form>
        {problem && isValidationKey(problem) ? (
          <p role="alert" className="text-sm text-destructive">
            {validation(problem)}
          </p>
        ) : null}
        <p className="text-sm font-medium" data-testid="report-period">
          {t("period.showing", {
            from: formatIndianDate(period.from),
            to: formatIndianDate(period.to),
          })}
        </p>
      </section>

      <section aria-labelledby="register" className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 id="register" className="text-lg font-semibold">
          {t("register.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("register.hint")}</p>
        <dl
          className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3"
          data-testid="register-summary"
        >
          <div>
            <dt className="text-muted-foreground">{t("register.invoices")}</dt>
            <dd className="font-medium tabular-nums">{totals.invoices}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("register.cancelled")}</dt>
            <dd className="font-medium tabular-nums">{totals.cancelled}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("register.creditNotes")}</dt>
            <dd className="font-medium tabular-nums">{totals.creditNotes}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("register.taxable")}</dt>
            <dd className="font-medium tabular-nums">{formatINR(totals.taxablePaise)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("register.gst")}</dt>
            <dd className="font-medium tabular-nums">{formatINR(gst)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("register.total")}</dt>
            <dd className="font-medium tabular-nums">{formatINR(totals.totalPaise)}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg" variant="outline">
            <a href={files("sales-register", "&format=csv")} download>
              {t("register.csv")}
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={files("sales-register", "&format=xlsx")} download>
              {t("register.xlsx")}
            </a>
          </Button>
        </div>
      </section>

      <section aria-labelledby="hsn" className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="hsn" className="text-lg font-semibold">
            {t("hsn.title")}
          </h2>
          <Button asChild size="lg" variant="outline">
            <a href={files("hsn")} download>
              {t("hsn.csv")}
            </a>
          </Button>
        </div>
        {missingHsn ? <p className="text-sm text-destructive">{t("hsn.noHsnHint")}</p> : null}
        {hsn.rows.length === 0 ? (
          <p className="text-muted-foreground">{t("hsn.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm" data-testid="hsn-summary">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-2 font-medium">
                    {t("hsn.hsn")}
                  </th>
                  <th scope="col" className="py-2 pr-2 font-medium">
                    {t("hsn.uqc")}
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right font-medium">
                    {t("hsn.rate")}
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right font-medium">
                    {t("hsn.quantity")}
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right font-medium">
                    {t("hsn.taxable")}
                  </th>
                  <th scope="col" className="py-2 pr-2 text-right font-medium">
                    {t("hsn.tax")}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t("hsn.total")}
                  </th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {hsn.rows.map((row) => (
                  <tr
                    key={`${row.hsn ?? ""}-${row.uqc}-${String(row.rateBp)}`}
                    className="border-b"
                  >
                    <td className="py-2 pr-2">{row.hsn ?? t("hsn.noHsn")}</td>
                    <td className="py-2 pr-2">{row.uqc}</td>
                    <td className="py-2 pr-2 text-right">{formatRate(row.rateBp)}</td>
                    <td className="py-2 pr-2 text-right">{formatQuantity(row.qtyMilli)}</td>
                    <td className="py-2 pr-2 text-right">{formatINR(row.taxablePaise)}</td>
                    <td className="py-2 pr-2 text-right">
                      {formatINR(row.igstPaise + row.cgstPaise + row.sgstPaise)}
                    </td>
                    <td className="py-2 text-right">{formatINR(row.totalPaise)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="font-medium tabular-nums">
                <tr>
                  <th scope="row" colSpan={4} className="py-2 pr-2 text-left">
                    {t("hsn.totals")}
                  </th>
                  <td className="py-2 pr-2 text-right">{formatINR(hsn.totals.taxablePaise)}</td>
                  <td className="py-2 pr-2 text-right">
                    {formatINR(hsn.totals.igstPaise + hsn.totals.cgstPaise + hsn.totals.sgstPaise)}
                  </td>
                  <td className="py-2 text-right">{formatINR(hsn.totals.totalPaise)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="gstr1" className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 id="gstr1" className="text-lg font-semibold">
          {t("gstr1.title")}
        </h2>
        {gstr1.available ? (
          <>
            <p className="text-sm text-muted-foreground">{t("gstr1.hint")}</p>
            <p className="text-sm font-medium">{t("gstr1.label")}</p>
            <form action={`${base}/gstr1`} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="gstr1-period">{t("gstr1.period")}</Label>
                <select
                  id="gstr1-period"
                  name="period"
                  defaultValue={gstr1.months[1] ?? gstr1.months[0]}
                  className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
                >
                  <optgroup label={t("gstr1.months")}>
                    {gstr1.months.map((value) => (
                      <option key={value} value={value}>
                        {monthName.format(new Date(`${value}-01T00:00:00Z`))}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t("gstr1.quarters")}>
                    {gstr1.quarters.map((value) => (
                      <option key={value} value={value}>
                        {t("gstr1.quarterLabel", {
                          quarter: value.slice(6),
                          fy: value.slice(0, 5),
                        })}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <Button type="submit" size="lg" variant="outline">
                {t("gstr1.download")}
              </Button>
            </form>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("gstr1.notRegular")}</p>
        )}
      </section>
    </>
  );
}

export default async function ReportsPage({ params, searchParams }: Params) {
  const t = await getTranslations("reports");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <ReportsView params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
