import { type Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { InvoiceView } from "@/components/invoice/invoice-view";
import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/session";
import { now } from "@/server/clock";
import { istDateFromInstant } from "@/server/domain/fy";
import { displayStatus } from "@/server/domain/invoice/status";
import { getInvoice } from "@/server/services/invoice.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("detailTitle") };
}

async function InvoiceDetail({
  params,
}: {
  params: Promise<{ businessSlug: string; invoiceId: string }>;
}) {
  const { businessSlug, invoiceId } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("invoices");
  const { invoice, lines } = await getInvoice(ctx, invoiceId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  if (invoice.status === "DRAFT") redirect(`/b/${businessSlug}/invoices/${invoice.id}/edit`);
  const status = displayStatus({ ...invoice, today: istDateFromInstant(now()) });
  return (
    <>
      <Link href={`/b/${businessSlug}/invoices`} className="text-sm underline underline-offset-4">
        {t("back")}
      </Link>
      <InvoiceView invoice={invoice} lines={lines} status={status} />
    </>
  );
}

export default async function InvoiceDetailPage({
  params,
}: PageProps<"/b/[businessSlug]/invoices/[invoiceId]">) {
  const t = await getTranslations("invoices");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("detailTitle")}</h1>
      <Suspense>
        <InvoiceDetail params={params} />
      </Suspense>
    </>
  );
}
