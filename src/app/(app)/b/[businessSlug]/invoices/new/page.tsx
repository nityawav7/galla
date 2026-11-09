import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { InvoiceBuilder } from "@/components/invoice/builder/invoice-builder";
import { EMPTY_DRAFT } from "@/lib/validation/invoices";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { istDateFromInstant } from "@/server/domain/fy";
import { getBuilderOptions } from "@/server/services/invoice.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("newTitle") };
}

async function NewInvoice({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("invoices");
  if (!can(ctx, "invoice:issue")) return <p className="text-muted-foreground">{t("readOnly")}</p>;
  const options = await getBuilderOptions(ctx);
  const instant = now();
  return (
    <InvoiceBuilder
      // A fresh builder on every visit; the draft row is created once something is typed.
      key={String(instant.getTime())}
      businessSlug={businessSlug}
      options={options}
      today={istDateFromInstant(instant)}
      initial={{ id: null, version: 1, draft: EMPTY_DRAFT, customer: null }}
    />
  );
}

export default async function NewInvoicePage({
  params,
}: PageProps<"/b/[businessSlug]/invoices/new">) {
  const t = await getTranslations("invoices");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("newTitle")}</h1>
      <Suspense>
        <BackLink params={params} />
        <NewInvoice params={params} />
      </Suspense>
    </>
  );
}

async function BackLink({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const t = await getTranslations("invoices");
  return (
    <Link href={`/b/${businessSlug}/invoices`} className="text-sm underline underline-offset-4">
      {t("back")}
    </Link>
  );
}
