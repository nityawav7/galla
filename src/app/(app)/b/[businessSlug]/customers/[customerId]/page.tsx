import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { AgingBar } from "@/components/customer/aging-bar";
import { ApplyAdvance } from "@/components/customer/apply-advance";
import { LedgerRows } from "@/components/customer/ledger-rows";
import { ReminderShare } from "@/components/customer/reminder-share";
import { Button } from "@/components/ui/button";
import { LEDGER_PAGE_ROWS } from "@/lib/config";
import { NotFoundError } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { requireTenant } from "@/server/auth/session";
import { type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/permissions";
import { LEDGER_PERIODS, type LedgerPeriod } from "@/server/domain/ledger/period";
import { formatINR } from "@/server/domain/money";
import { formatIndianPhone } from "@/server/domain/phone";
import { type CustomerLedger, getCustomerLedger } from "@/server/services/ledger.service";
import { getReminderInfo } from "@/server/services/reminder.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers.ledger");
  return { title: t("history") };
}

type Params = PageProps<"/b/[businessSlug]/customers/[customerId]">;

const querySchema = z.object({
  period: z.enum(LEDGER_PERIODS).catch("fy"),
  /** "all": every row of the period, not just the latest LEDGER_PAGE_ROWS. */
  rows: z.literal("all").optional().catch(undefined),
});

async function ledgerOr404(
  ctx: TenantContext,
  customerId: string,
  period: LedgerPeriod,
): Promise<CustomerLedger> {
  try {
    return await getCustomerLedger(ctx, customerId, { period });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** SPEC F7: the customer's udhaar, what is due and how late, and what to do about it. */
async function CustomerAccount({ params, searchParams }: Pick<Params, "params" | "searchParams">) {
  const { businessSlug, customerId } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const query = querySchema.parse(await searchParams);
  const t = await getTranslations("customers.ledger");
  const tCustomers = await getTranslations("customers");
  const view = await ledgerOr404(ctx, customerId, query.period);
  const { customer, ledger, aging, credit } = view;
  const base = `/b/${businessSlug}/customers/${customer.id}`;
  const reminder = can(ctx, "invoice:share") ? await getReminderInfo(ctx, customer.id) : null;
  const balance = ledger.closingPaise;
  const canApply =
    can(ctx, "payment:record") &&
    credit.onAccountPaise > 0n &&
    (view.openInvoices.length > 0 || credit.openingOwedPaise > 0n);

  const hidden = query.rows === "all" ? 0 : Math.max(0, ledger.rows.length - LEDGER_PAGE_ROWS);
  const shown = ledger.rows.slice(hidden);
  const earlier = hidden > 0 ? ledger.rows[hidden - 1] : undefined;
  const periodHref = (period: LedgerPeriod) =>
    period === "fy" ? base : `${base}?period=${period}`;

  return (
    <>
      <Link href={`/b/${businessSlug}/customers`} className="text-sm underline underline-offset-4">
        {tCustomers("back")}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[
            customer.phoneE164 ? formatIndianPhone(customer.phoneE164) : null,
            customer.gstin,
            t("creditDays", { days: customer.creditDays }),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {customer.archivedAt ? (
          <p className="text-sm font-medium">{tCustomers("archivedNotice")}</p>
        ) : null}
      </div>

      <section className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="balance">
        <p
          id="balance"
          className="text-xl font-semibold tabular-nums"
          data-testid="customer-balance"
        >
          {balance > 0n
            ? t("owesYou", { amount: formatINR(balance) })
            : balance < 0n
              ? t("hasAdvance", { amount: formatINR(-balance) })
              : t("settled")}
        </p>
        {aging.overduePaise > 0n ? (
          <p className="text-sm font-medium text-destructive">
            {t("overdue", { amount: formatINR(aging.overduePaise) })}
          </p>
        ) : null}
        <AgingBar aging={aging} />
      </section>

      <div className="flex flex-wrap gap-2">
        {can(ctx, "payment:record") ? (
          <Button asChild size="lg">
            <Link href={`/b/${businessSlug}/payments/new?customer=${customer.id}&back=customer`}>
              {t("recordPayment")}
            </Link>
          </Button>
        ) : null}
        <Button asChild size="lg" variant="outline">
          <a
            href={`${base}/statement?period=${query.period}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("statement")}
            <span className="sr-only"> {t("statementOpensInNewTab")}</span>
          </a>
        </Button>
        {can(ctx, "catalog:write") ? (
          <Button asChild size="lg" variant="outline">
            <Link href={`${base}/edit`}>{t("edit")}</Link>
          </Button>
        ) : null}
      </div>
      {reminder ? (
        <ReminderShare businessSlug={businessSlug} customerId={customer.id} reminder={reminder} />
      ) : null}
      {canApply ? (
        <ApplyAdvance
          businessSlug={businessSlug}
          customerId={customer.id}
          onAccountPaise={credit.onAccountPaise.toString()}
        />
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="history">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="history" className="text-lg font-semibold">
            {t("history")}
          </h2>
          <nav aria-label={t("period.label")} className="flex flex-wrap gap-2">
            {LEDGER_PERIODS.map((period) => (
              <Link
                key={period}
                href={periodHref(period)}
                aria-current={period === query.period ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm",
                  period === query.period && "border-primary bg-primary text-primary-foreground",
                )}
              >
                {t(`period.${period}`)}
              </Link>
            ))}
          </nav>
        </div>
        {hidden > 0 ? (
          <Link
            href={`${periodHref(query.period)}${query.period === "fy" ? "?" : "&"}rows=all`}
            className="text-sm underline underline-offset-4"
          >
            {t("earlierRows", { count: hidden })}
          </Link>
        ) : null}
        <LedgerRows
          businessSlug={businessSlug}
          customerId={customer.id}
          broughtForward={
            hidden > 0
              ? { date: shown[0]?.date ?? view.today, balancePaise: earlier?.balancePaise ?? 0n }
              : ledger.broughtForwardPaise === null || ledger.broughtForwardPaise === 0n
                ? null
                : { date: view.from ?? view.today, balancePaise: ledger.broughtForwardPaise }
          }
          rows={shown}
          payments={view.payments}
        />
      </section>
    </>
  );
}

export default function CustomerPage({ params, searchParams }: Params) {
  return (
    <Suspense>
      <CustomerAccount params={params} searchParams={searchParams} />
    </Suspense>
  );
}
