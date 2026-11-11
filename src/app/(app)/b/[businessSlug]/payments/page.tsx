import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { VoidPayment } from "@/components/payment/void-payment";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { paymentListQuerySchema } from "@/lib/validation/payments";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { formatIndianDate } from "@/server/domain/fy";
import { formatINR } from "@/server/domain/money";
import { listPayments } from "@/server/services/payment.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments");
  return { title: t("title") };
}

type Params = PageProps<"/b/[businessSlug]/payments">;

async function Payments({ params, searchParams }: Pick<Params, "params" | "searchParams">) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const query = paymentListQuerySchema.parse(await searchParams);
  const t = await getTranslations("payments");
  const tModes = await getTranslations("payments.modes");
  const page = await listPayments(ctx, query);
  const canVoid = can(ctx, "payment:void");
  const base = `/b/${businessSlug}/payments`;
  const href = (extra: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      customer: query.customer,
      from: query.from,
      to: query.to,
      ...extra,
    };
    const search = new URLSearchParams(
      Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1])),
    ).toString();
    return search ? `${base}?${search}` : base;
  };
  const filtered = Boolean(query.customer ?? query.from ?? query.to);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button asChild size="lg">
          <Link href={query.customer ? `${base}/new?customer=${query.customer}` : `${base}/new`}>
            {t("record")}
          </Link>
        </Button>
      </div>

      <form action={base} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        {query.customer ? <input type="hidden" name="customer" value={query.customer} /> : null}
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payments-from">{t("from")}</Label>
            <Input
              id="payments-from"
              type="date"
              name="from"
              defaultValue={query.from ?? ""}
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="payments-to">{t("to")}</Label>
            <Input
              id="payments-to"
              type="date"
              name="to"
              defaultValue={query.to ?? ""}
              className="h-9"
            />
          </div>
        </div>
        <Button type="submit" size="lg" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      {filtered ? (
        <Link
          href={href({ customer: undefined, from: undefined, to: undefined })}
          className="text-sm underline"
        >
          {t("clearFilters")}
        </Link>
      ) : null}

      {page.items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border" data-testid="payment-list">
          {page.items.map(({ payment, customerName, allocatedPaise, allocations }) => {
            const voided = payment.voidedAt !== null;
            const onAccount = payment.amountPaise - allocatedPaise;
            return (
              <li key={payment.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className={voided ? "font-medium line-through" : "font-medium"}>
                      {customerName ?? t("walkIn")}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {[
                        formatIndianDate(payment.paymentDate),
                        tModes(payment.mode),
                        payment.reference,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span
                    className={
                      voided ? "font-medium tabular-nums line-through" : "font-medium tabular-nums"
                    }
                  >
                    {formatINR(payment.amountPaise)}
                  </span>
                </div>
                {voided ? (
                  <p className="text-sm text-destructive">
                    {t("voided", { reason: payment.voidReason ?? "" })}
                  </p>
                ) : (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted-foreground">
                      {t("appliedSummary", {
                        applied: formatINR(allocatedPaise),
                        onAccount: formatINR(onAccount),
                      })}
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {allocations.map((allocation) => (
                        <li
                          key={allocation.invoiceId ?? "opening"}
                          className="flex justify-between gap-3"
                        >
                          {allocation.invoiceId ? (
                            <Link
                              href={`/b/${businessSlug}/invoices/${allocation.invoiceId}`}
                              className="underline underline-offset-4"
                            >
                              {allocation.invoiceNumber}
                            </Link>
                          ) : (
                            <span>{t("openingBalance")}</span>
                          )}
                          <span className="tabular-nums">{formatINR(allocation.amountPaise)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {canVoid && !voided ? (
                  <div>
                    <VoidPayment
                      businessSlug={businessSlug}
                      paymentId={payment.id}
                      amount={formatINR(payment.amountPaise)}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {page.nextCursor || query.cursor ? (
        <nav className="flex gap-4 text-sm" aria-label={t("pages")}>
          {query.cursor ? (
            <Link href={href({})} className="underline underline-offset-4">
              {t("firstPage")}
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link href={href({ cursor: page.nextCursor })} className="underline underline-offset-4">
              {t("nextPage")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

export default async function PaymentsPage({ params, searchParams }: Params) {
  const t = await getTranslations("payments");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <Payments params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
