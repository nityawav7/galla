import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CreditNoteForm, type ReturnableLine } from "@/components/invoice/credit-note-form";
import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { balancePaise } from "@/server/domain/invoice/status";
import { getInvoice } from "@/server/services/invoice.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("creditNotes");
  return { title: t("newTitle") };
}

async function NewCreditNote({
  params,
}: {
  params: Promise<{ businessSlug: string; invoiceId: string }>;
}) {
  const { businessSlug, invoiceId } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("creditNotes");
  const { invoice, lines, returnedMilli } = await getInvoice(ctx, invoiceId).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );
  const back = (
    <Link
      href={`/b/${businessSlug}/invoices/${invoice.id}`}
      className="text-sm underline underline-offset-4"
    >
      {t("backToInvoice", { number: invoice.number ?? "" })}
    </Link>
  );
  if (!can(ctx, "invoice:cancel")) {
    return (
      <>
        {back}
        <p className="text-muted-foreground">{t("ownerOnly")}</p>
      </>
    );
  }
  if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
    return (
      <>
        {back}
        <p className="text-muted-foreground">{t("notAllowed")}</p>
      </>
    );
  }
  // Amounts cross to the client as strings (JSON has no bigint).
  const returnable: ReturnableLine[] = lines.map((line) => ({
    id: line.id,
    description: line.description,
    unit: line.unit,
    qtyMilli: line.qtyMilli.toString(),
    returnedMilli: (returnedMilli.get(line.id) ?? 0n).toString(),
    discountPaise: line.discountPaise.toString(),
    taxablePaise: line.taxablePaise.toString(),
    cgstPaise: line.cgstPaise.toString(),
    sgstPaise: line.sgstPaise.toString(),
    utgstPaise: line.utgstPaise.toString(),
    igstPaise: line.igstPaise.toString(),
    lineTotalPaise: line.lineTotalPaise.toString(),
  }));
  return (
    <>
      {back}
      <CreditNoteForm
        businessSlug={businessSlug}
        invoiceId={invoice.id}
        lines={returnable}
        roundOffPaise={invoice.roundOffPaise.toString()}
        balancePaise={balancePaise(invoice).toString()}
      />
    </>
  );
}

export default async function NewCreditNotePage({
  params,
}: PageProps<"/b/[businessSlug]/invoices/[invoiceId]/credit-notes/new">) {
  const t = await getTranslations("creditNotes");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("newTitle")}</h1>
      <Suspense>
        <NewCreditNote params={params} />
      </Suspense>
    </>
  );
}
