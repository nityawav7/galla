import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { NotFoundError } from "@/lib/errors";
import { requireTenant } from "@/server/auth/session";
import { amountInWords } from "@/server/domain/amount-in-words";
import { formatIndianDate } from "@/server/domain/fy";
import { formatINR } from "@/server/domain/money";
import { formatQuantity } from "@/server/domain/quantity";
import { findState } from "@/server/domain/states";
import { getCreditNote } from "@/server/services/credit-note.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("creditNotes");
  return { title: t("detailTitle") };
}

async function CreditNoteDetail({
  params,
}: {
  params: Promise<{ businessSlug: string; creditNoteId: string }>;
}) {
  const { businessSlug, creditNoteId } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("creditNotes");
  const view = await getTranslations("invoices.view");
  const { creditNote, lines, invoice } = await getCreditNote(ctx, creditNoteId).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );
  const supplier = creditNote.supplierSnapshot;
  const recipient = creditNote.customerSnapshot;
  const place = findState(creditNote.placeOfSupplyStateCode);
  const tax =
    creditNote.cgstPaise + creditNote.sgstPaise + creditNote.utgstPaise + creditNote.igstPaise;

  return (
    <>
      <Link
        href={`/b/${businessSlug}/invoices/${invoice.id}`}
        className="text-sm underline underline-offset-4"
      >
        {t("backToInvoice", { number: invoice.number ?? "" })}
      </Link>
      <article className="flex flex-col gap-5 rounded-xl border bg-card p-4 text-sm shadow-sm">
        <header className="flex flex-col gap-1 border-b pb-3">
          <h2 className="text-lg font-semibold">{t("documentTitle")}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-muted-foreground">{t("number")}</dt>
            <dd className="font-medium whitespace-nowrap">{creditNote.number}</dd>
            <dt className="text-muted-foreground">{t("date")}</dt>
            <dd>{formatIndianDate(creditNote.noteDate)}</dd>
            <dt className="text-muted-foreground">{t("againstInvoice")}</dt>
            <dd className="whitespace-nowrap">{invoice.number}</dd>
            <dt className="text-muted-foreground">{view("placeOfSupply")}</dt>
            <dd>{place ? `${place.name} (${place.code})` : creditNote.placeOfSupplyStateCode}</dd>
            <dt className="text-muted-foreground">{t("reason")}</dt>
            <dd>{creditNote.reason}</dd>
          </dl>
        </header>
        <div className="grid gap-4 md:grid-cols-2">
          <section aria-labelledby="note-supplier">
            <h3 id="note-supplier" className="text-xs font-medium text-muted-foreground uppercase">
              {view("from")}
            </h3>
            <p className="font-medium">{supplier.tradeName ?? supplier.legalName}</p>
            {supplier.gstin ? <p>{view("gstin", { gstin: supplier.gstin })}</p> : null}
          </section>
          <section aria-labelledby="note-recipient">
            <h3 id="note-recipient" className="text-xs font-medium text-muted-foreground uppercase">
              {view("billedTo")}
            </h3>
            <p className="font-medium">
              {recipient.name.length > 0 ? recipient.name : view("walkIn")}
            </p>
            {recipient.gstin ? <p>{view("gstin", { gstin: recipient.gstin })}</p> : null}
          </section>
        </div>
        <ul className="flex flex-col divide-y">
          {lines.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-3 py-2">
              <span className="flex flex-col">
                <span>{line.description}</span>
                <span className="text-xs text-muted-foreground">
                  {formatQuantity(line.qtyMilli)} {line.unit} · {line.hsnSac ?? "—"}
                </span>
              </span>
              <span className="font-medium">{formatINR(line.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>
        <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1">
          <dt>{view("taxable")}</dt>
          <dd className="text-right">{formatINR(creditNote.taxablePaise)}</dd>
          {tax > 0n ? (
            <>
              <dt>{view("gst")}</dt>
              <dd className="text-right">{formatINR(tax)}</dd>
            </>
          ) : null}
          {creditNote.roundOffPaise !== 0n ? (
            <>
              <dt>{view("roundOff")}</dt>
              <dd className="text-right">{formatINR(creditNote.roundOffPaise)}</dd>
            </>
          ) : null}
          <dt className="font-semibold">{t("total")}</dt>
          <dd className="text-right font-semibold" data-testid="credit-note-total">
            {formatINR(creditNote.grandTotalPaise)}
          </dd>
        </dl>
        <p className="text-xs">{amountInWords(creditNote.grandTotalPaise)}</p>
        <p className="text-right text-xs text-muted-foreground">{view("signatory")}</p>
      </article>
    </>
  );
}

export default async function CreditNotePage({
  params,
}: PageProps<"/b/[businessSlug]/credit-notes/[creditNoteId]">) {
  const t = await getTranslations("creditNotes");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("detailTitle")}</h1>
      <Suspense>
        <CreditNoteDetail params={params} />
      </Suspense>
    </>
  );
}
