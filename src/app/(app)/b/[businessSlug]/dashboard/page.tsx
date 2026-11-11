import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { AgingBar } from "@/components/customer/aging-bar";
import { BarList } from "@/components/dashboard/bar-list";
import { DailyChart } from "@/components/dashboard/daily-chart";
import { requireTenant } from "@/server/auth/session";
import { formatINR } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/quantity";
import { getDashboard } from "@/server/services/dashboard.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

function Card({
  label,
  value,
  detail,
  href,
  testId,
}: {
  label: string;
  value: string;
  detail?: string | null;
  href?: string;
  testId: string;
}) {
  const body: ReactNode = (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-lg font-semibold tabular-nums" data-testid={testId}>
        {value}
      </span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </>
  );
  return (
    <li className="rounded-lg border">
      {href ? (
        <Link
          href={href}
          className="flex h-full flex-col gap-0.5 p-3 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        >
          {body}
        </Link>
      ) : (
        <div className="flex h-full flex-col gap-0.5 p-3">{body}</div>
      )}
    </li>
  );
}

/** SPEC F8: what came in, what is owed, and what is late, at a glance on a phone. */
async function DashboardView({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { ctx, membership } = await requireTenant(businessSlug);
  const t = await getTranslations("dashboard");
  const { counts, money } = await getDashboard(ctx);
  const base = `/b/${businessSlug}`;

  return (
    <>
      <p className="text-muted-foreground">
        {t("welcome", { name: membership.tradeName ?? membership.legalName })}
      </p>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {money ? (
          <>
            <Card
              label={t("cards.today")}
              value={formatINR(money.todaySalesPaise)}
              testId="card-today"
            />
            <Card
              label={t("cards.month")}
              value={formatINR(money.monthSalesPaise)}
              testId="card-month"
            />
            {money.monthGstPaise !== null ? (
              <Card
                label={t("cards.gst")}
                value={formatINR(money.monthGstPaise)}
                testId="card-gst"
              />
            ) : null}
            <Card
              label={t("cards.receivable")}
              value={formatINR(money.receivablePaise)}
              detail={
                money.advancesPaise > 0n
                  ? t("cards.advances", { amount: formatINR(money.advancesPaise) })
                  : null
              }
              href={`${base}/customers`}
              testId="card-receivable"
            />
            <Card
              label={t("cards.overdue")}
              value={formatINR(money.overduePaise)}
              detail={t("cards.overdueInvoices", { count: counts.overdueInvoices })}
              href={`${base}/invoices?status=OVERDUE`}
              testId="card-overdue"
            />
            <Card
              label={t("cards.recovered")}
              value={formatINR(money.recovery.recoveredPaise)}
              detail={
                money.recovery.reminders === 0
                  ? t("cards.recoveredNone")
                  : t("cards.recoveredDetail", {
                      count: money.recovery.reminders,
                      amount: formatINR(money.recovery.remindedPaise),
                    })
              }
              testId="card-recovered"
            />
          </>
        ) : (
          <>
            <Card
              label={t("cards.invoicesToday")}
              value={String(counts.invoicesToday)}
              testId="card-invoices-today"
            />
            <Card
              label={t("cards.invoicesMonth")}
              value={String(counts.invoicesThisMonth)}
              testId="card-invoices-month"
            />
            <Card
              label={t("cards.overdueCount")}
              value={String(counts.overdueInvoices)}
              href={`${base}/invoices?status=OVERDUE`}
              testId="card-overdue-count"
            />
          </>
        )}
      </ul>

      {money ? (
        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border p-4 md:col-span-2">
            <DailyChart days={money.daily} />
          </section>
          <section className="rounded-lg border p-4">
            <BarList
              title={t("charts.topProducts")}
              empty={t("charts.empty")}
              testId="top-products"
              items={money.topProducts.map((product) => ({
                key: product.key,
                label: product.name,
                value: formatINR(product.value),
                size: product.value,
              }))}
            />
          </section>
          <section className="rounded-lg border p-4">
            <BarList
              title={t("charts.topDebtors")}
              empty={t("charts.noDebtors")}
              testId="top-debtors"
              items={money.topDebtors.map((debtor) => ({
                key: debtor.customerId,
                label: debtor.name,
                value: formatINR(debtor.balancePaise),
                size: debtor.balancePaise,
                href: `${base}/customers/${debtor.customerId}`,
              }))}
            />
          </section>
          <section className="rounded-lg border p-4 md:col-span-2">
            <AgingBar aging={money.aging} />
          </section>
        </div>
      ) : (
        <section className="rounded-lg border p-4">
          <BarList
            title={t("charts.topProductsQty")}
            empty={t("charts.empty")}
            testId="top-products"
            items={counts.topProducts.map((product) => ({
              key: product.key,
              label: product.name,
              value: `${formatQuantity(product.value)} ${product.unit}`,
              size: product.value,
            }))}
          />
        </section>
      )}
    </>
  );
}

export default async function DashboardPage({ params }: PageProps<"/b/[businessSlug]/dashboard">) {
  const t = await getTranslations("dashboard");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <DashboardView params={params} />
      </Suspense>
    </>
  );
}
