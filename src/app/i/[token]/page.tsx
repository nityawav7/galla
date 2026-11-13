import { type Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { InvoiceView } from "@/components/invoice/invoice-view";
import { UpiQr } from "@/components/invoice/upi-qr";
import { Button } from "@/components/ui/button";
import { APP_NAME } from "@/lib/config";
import { NotFoundError } from "@/lib/errors";
import { getSharedInvoice } from "@/server/services/public-invoice.service";

/*
 * The public invoice link (SPEC F5, ADR 0009). No sign-in: the token in the URL is the secret.
 * The proxy has already rate-limited this request, answered 404 for a dead link and set
 * noindex, no-referrer and no-store headers; the page repeats noindex for crawlers that only
 * read HTML.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicInvoice");
  return {
    title: t("metaTitle"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

async function SharedInvoice({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("publicInvoice");
  const shared = await getSharedInvoice(token).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { invoice, lines, status, payment, shopName, sample } = shared;
  const cancelled = invoice.status === "CANCELLED";
  const pdf = `/i/${token}/pdf`;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("heading", { shop: shopName })}</h1>
      {sample ? (
        <p
          role="note"
          data-testid="sample-invoice"
          className="rounded-lg border-2 border-destructive p-3 text-sm font-semibold text-destructive"
        >
          {t("sample")}
        </p>
      ) : null}
      {cancelled ? (
        <p
          role="status"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
        >
          {t("cancelled")}
        </p>
      ) : null}
      {payment ? (
        <section
          aria-labelledby="pay-heading"
          className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm"
        >
          <div>
            <h2 id="pay-heading" className="text-sm text-muted-foreground">
              {t("amountDue")}
            </h2>
            <p className="text-3xl font-semibold" data-testid="amount-due">
              {payment.amount}
            </p>
          </div>
          {/* UPI apps live on phones; a desktop visitor scans the QR instead. */}
          <div className="flex flex-col gap-1 md:hidden">
            <Button asChild size="lg">
              <a href={payment.upiLink}>{t("payWithUpi", { amount: payment.amount })}</a>
            </Button>
            <p className="text-xs text-muted-foreground">{t("payHint")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <UpiQr
              link={payment.upiLink}
              label={t("qrLabel", { amount: payment.amount, vpa: payment.vpa })}
            />
            <div className="flex flex-col gap-1 text-sm">
              <p>{t("scanToPay", { amount: payment.amount })}</p>
              <p className="text-muted-foreground">{t("upiId", { vpa: payment.vpa })}</p>
            </div>
          </div>
        </section>
      ) : !cancelled ? (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {t("nothingDue")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild size="lg" variant="outline">
          <a href={`${pdf}?download=1`} download>
            {t("download")}
          </a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href={`${pdf}?format=80mm&download=1`} download>
            {t("downloadThermal")}
          </a>
        </Button>
      </div>
      <InvoiceView invoice={invoice} lines={lines} status={status} />
      <p className="text-xs text-muted-foreground">{t("footer", { app: APP_NAME })}</p>
    </>
  );
}

export default function SharedInvoicePage({ params }: PageProps<"/i/[token]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <Suspense>
        <SharedInvoice params={params} />
      </Suspense>
    </main>
  );
}
