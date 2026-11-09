import { type Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { InvoiceBuilder } from "@/components/invoice/builder/invoice-builder";
import { NotFoundError } from "@/lib/errors";
import { type CustomerOption, toCustomerOption } from "@/lib/invoice-options";
import { draftSchema } from "@/lib/validation/invoices";
import { requireTenant } from "@/server/auth/session";
import { type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { istDateFromInstant } from "@/server/domain/fy";
import { getCustomer } from "@/server/services/customer.service";
import { getBuilderOptions, getInvoice } from "@/server/services/invoice.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("editTitle") };
}

async function customerFor(ctx: TenantContext, id: string | null): Promise<CustomerOption | null> {
  if (!id) return null;
  try {
    return toCustomerOption(await getCustomer(ctx, id));
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

async function EditInvoice({
  params,
}: {
  params: Promise<{ businessSlug: string; invoiceId: string }>;
}) {
  const { businessSlug, invoiceId } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("invoices");
  const detail = await getInvoice(ctx, invoiceId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { invoice } = detail;
  if (invoice.status !== "DRAFT") redirect(`/b/${businessSlug}/invoices/${invoice.id}`);
  if (!can(ctx, "invoice:issue")) return <p className="text-muted-foreground">{t("readOnly")}</p>;
  const draft = draftSchema.parse(invoice.draft ?? {});
  const [options, customer] = await Promise.all([
    getBuilderOptions(ctx),
    customerFor(ctx, draft.customerId),
  ]);
  return (
    <>
      <Link href={`/b/${businessSlug}/invoices`} className="text-sm underline underline-offset-4">
        {t("back")}
      </Link>
      <InvoiceBuilder
        key={`${invoice.id}-${String(invoice.version)}`}
        businessSlug={businessSlug}
        options={options}
        today={istDateFromInstant(now())}
        initial={{ id: invoice.id, version: invoice.version, draft, customer }}
      />
    </>
  );
}

export default async function EditInvoicePage({
  params,
}: PageProps<"/b/[businessSlug]/invoices/[invoiceId]/edit">) {
  const t = await getTranslations("invoices");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("editTitle")}</h1>
      <Suspense>
        <EditInvoice params={params} />
      </Suspense>
    </>
  );
}
