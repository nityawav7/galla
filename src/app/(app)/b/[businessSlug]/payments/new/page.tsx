import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { z } from "zod";

import { RecordPaymentForm } from "@/components/payment/record-payment-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NotFoundError } from "@/lib/errors";
import { type PaymentFormOptions } from "@/lib/payment-view";
import { OPENING_BALANCE } from "@/lib/validation/payments";
import { requireTenant } from "@/server/auth/session";
import { type TenantContext } from "@/server/authz/context";
import { formatINR } from "@/server/domain/money";
import { listCustomers } from "@/server/services/customer.service";
import { getPaymentOptions, type PaymentOptions } from "@/server/services/payment.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments");
  return { title: t("newTitle") };
}

type Params = PageProps<"/b/[businessSlug]/payments/new">;

const querySchema = z.object({
  customer: z.uuid().optional().catch(undefined),
  invoice: z.uuid().optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  /** Opened from the customer page: "Done" goes back there. */
  back: z.literal("customer").optional().catch(undefined),
});

function toFormOptions(options: PaymentOptions): PaymentFormOptions {
  return {
    customer: options.customer,
    invoiceId: options.invoiceId,
    openItems: options.openItems.map((item) => ({
      key: item.invoiceId ?? OPENING_BALANCE,
      number: item.number,
      invoiceDate: item.invoiceDate,
      dueDate: item.dueDate,
      balancePaise: item.balancePaise.toString(),
    })),
    onAccountPaise: options.credit.onAccountPaise.toString(),
    today: options.today,
  };
}

async function optionsOr404(
  ctx: TenantContext,
  query: { customer?: string | undefined; invoice?: string | undefined },
): Promise<PaymentOptions> {
  try {
    return await getPaymentOptions(ctx, {
      customerId: query.customer ?? null,
      invoiceId: query.invoice ?? null,
    });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** No customer yet: search and pick one (a plain GET form, no script needed). */
async function ChooseCustomer({
  ctx,
  businessSlug,
  q,
}: {
  ctx: TenantContext;
  businessSlug: string;
  q: string | undefined;
}) {
  const t = await getTranslations("payments.form");
  const page = await listCustomers(ctx, { q });
  const base = `/b/${businessSlug}/payments/new`;
  return (
    <div className="flex flex-col gap-4">
      <form role="search" action={base} className="flex flex-col gap-1.5">
        <Label htmlFor="payment-customer-search">{t("chooseCustomer")}</Label>
        <div className="flex gap-2">
          <Input
            id="payment-customer-search"
            type="search"
            name="q"
            defaultValue={q ?? ""}
            placeholder={t("customerSearchPlaceholder")}
            className="h-9"
          />
          <Button type="submit" variant="secondary">
            {t("search")}
          </Button>
        </div>
      </form>
      {page.items.length === 0 ? (
        <p className="text-muted-foreground">{t("noCustomers")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {page.items.slice(0, 20).map((customer) => (
            <li key={customer.id}>
              <Link
                href={`${base}?customer=${customer.id}`}
                className="block p-3 font-medium hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                {customer.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function NewPayment({ params, searchParams }: Pick<Params, "params" | "searchParams">) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const query = querySchema.parse(await searchParams);
  const t = await getTranslations("payments.form");
  if (!query.customer && !query.invoice) {
    return <ChooseCustomer ctx={ctx} businessSlug={businessSlug} q={query.q} />;
  }
  const options = await optionsOr404(ctx, query);
  const customerId = options.customer?.id ?? "";
  const returnHref = query.invoice
    ? `/b/${businessSlug}/invoices/${query.invoice}`
    : query.back === "customer"
      ? `/b/${businessSlug}/customers/${customerId}`
      : `/b/${businessSlug}/payments?customer=${customerId}`;
  if (options.customer === null && options.openItems.length === 0) {
    return (
      <>
        <p>{t("nothingDueWalkIn")}</p>
        <Link href={returnHref} className="text-sm underline underline-offset-4">
          {t("back")}
        </Link>
      </>
    );
  }
  return (
    <>
      <Link href={returnHref} className="text-sm underline underline-offset-4">
        {t("back")}
      </Link>
      {options.credit.onAccountPaise > 0n ? (
        <p className="rounded-lg border p-3 text-sm">
          {t("hasAdvance", { amount: formatINR(options.credit.onAccountPaise) })}
        </p>
      ) : null}
      <RecordPaymentForm
        businessSlug={businessSlug}
        options={toFormOptions(options)}
        returnHref={returnHref}
      />
    </>
  );
}

export default async function NewPaymentPage({ params, searchParams }: Params) {
  const t = await getTranslations("payments");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("newTitle")}</h1>
      <Suspense>
        <NewPayment params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
