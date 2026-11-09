"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { cancelInvoiceAction } from "@/app/(app)/b/[businessSlug]/invoices/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isInvoiceErrorKey } from "@/lib/validation/invoices";
import { isValidationKey } from "@/lib/validation/messages";

/** Owner-only "Cancel invoice" with a required reason (SPEC §4.8). The number is kept. */
export function CancelInvoice({
  businessSlug,
  invoiceId,
  number,
}: {
  businessSlug: string;
  invoiceId: string;
  number: string;
}) {
  const t = useTranslations("invoices.cancel");
  const validation = useTranslations("validation");
  const invoiceErrors = useTranslations("invoices.errors");
  const errors = useTranslations("errors");
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await cancelInvoiceAction(businessSlug, invoiceId, { reason });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    const issue = result.error.issues?.[0]?.message;
    if (issue && isValidationKey(issue)) setError(validation(issue));
    else if (isInvoiceErrorKey(result.error.message)) setError(invoiceErrors(result.error.message));
    else setError(errors("generic"));
  };

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="lg"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t("title", { number })}</DialogTitle>
          <DialogDescription>{t("explain")}</DialogDescription>
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            {t("gstr1Warning")}
          </p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-reason`} className="text-sm font-medium">
              {t("reason")}
            </label>
            <textarea
              id={`${id}-reason`}
              rows={2}
              maxLength={200}
              value={reason}
              aria-invalid={error !== null}
              aria-describedby={error ? `${id}-error` : undefined}
              onChange={(event) => {
                setReason(event.target.value);
              }}
              className="rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
            />
            {error ? (
              <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              size="lg"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? t("cancelling") : t("confirm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setOpen(false);
              }}
            >
              {t("keep")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
