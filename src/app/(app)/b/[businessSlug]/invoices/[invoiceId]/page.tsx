import { type Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CancelInvoice } from "@/components/invoice/cancel-invoice";
import { InvoiceView } from "@/components/invoice/invoice-view";
import { PdfActions } from "@/components/invoice/pdf-actions";
import { PublicLinkPanel } from "@/components/invoice/public-link-panel";
import { Button } from "@/components/ui/button";
import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { formatIndianDate, istDateFromInstant } from "@/server/domain/fy";
import { balancePaise, displayStatus } from "@/server/domain/invoice/status";
import { formatINR } from "@/server/domain/money";
import { getInvoice } from "@/server/services/invoice.service";
import { getPublicLink } from "@/server/services/public-link.service";

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
  const { invoice, lines, creditNotes } = await getInvoice(ctx, invoiceId).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );
  if (invoice.status === "DRAFT") redirect(`/b/${businessSlug}/invoices/${invoice.id}/edit`);
  const status = displayStatus({ ...invoice, today: istDateFromInstant(now()) });
  const balance = balancePaise(invoice);
  const owner = can(ctx, "invoice:cancel");
  const live = invoice.status !== "CANCELLED";
  const canCancel =
    owner &&
    invoice.status === "ISSUED" &&
    invoice.amountPaidPaise === 0n &&
    invoice.amountCreditedPaise === 0n;
  return (
    <>
      <Link href={`/b/${businessSlug}/invoices`} className="text-sm underline underline-offset-4">
        {t("back")}
      </Link>
      {invoice.status === "CANCELLED" ? (
        <p
          role="status"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          {t("detail.cancelled", {
            date: invoice.cancelledAt
              ? formatIndianDate(istDateFromInstant(invoice.cancelledAt))
              : "",
            reason: invoice.cancelReason ?? "",
          })}
        </p>
      ) : null}
      {live ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:max-w-sm">
          {invoice.amountCreditedPaise > 0n ? (
            <>
              <dt>{t("detail.credited")}</dt>
              <dd className="text-right">{formatINR(invoice.amountCreditedPaise)}</dd>
            </>
          ) : null}
          <dt className="font-medium">{t("detail.balance")}</dt>
          <dd className="text-right font-medium" data-testid="invoice-balance">
            {formatINR(balance)}
          </dd>
        </dl>
      ) : null}
      {owner && live ? (
        <div className="flex flex-wrap gap-2">
          {balance > 0n ? (
            <Button asChild size="lg" variant="outline">
              <Link href={`/b/${businessSlug}/invoices/${invoice.id}/credit-notes/new`}>
                {t("detail.newCreditNote")}
              </Link>
            </Button>
          ) : null}
          {canCancel ? (
            <CancelInvoice
              businessSlug={businessSlug}
              invoiceId={invoice.id}
              number={invoice.number ?? ""}
            />
          ) : null}
        </div>
      ) : null}
      {owner && live && !canCancel ? (
        <p className="text-sm text-muted-foreground">{t("detail.cannotCancel")}</p>
      ) : null}
      <PdfActions href={`/b/${businessSlug}/invoices/${invoice.id}/pdf`} />
      {can(ctx, "invoice:share") ? (
        <PublicLinkPanel
          businessSlug={businessSlug}
          invoiceId={invoice.id}
          url={(await getPublicLink(ctx, invoice.id)).url}
          canManage={can(ctx, "invoice:manageLink")}
        />
      ) : null}
      <InvoiceView invoice={invoice} lines={lines} status={status} />
      {creditNotes.length > 0 ? (
        <section aria-labelledby="invoice-credit-notes" className="flex flex-col gap-2">
          <h2 id="invoice-credit-notes" className="text-lg font-semibold">
            {t("detail.creditNotes")}
          </h2>
          <ul className="flex flex-col divide-y rounded-lg border">
            {creditNotes.map((note) => (
              <li key={note.id}>
                <Link
                  href={`/b/${businessSlug}/credit-notes/${note.id}`}
                  className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-muted"
                >
                  <span className="flex flex-col">
                    <span className="font-medium">{note.number}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatIndianDate(note.noteDate)} · {note.reason}
                    </span>
                  </span>
                  <span className="font-medium">{formatINR(note.grandTotalPaise)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
