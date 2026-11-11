"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { voidPaymentAction } from "@/app/(app)/b/[businessSlug]/payments/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isValidationKey } from "@/lib/validation/messages";
import { isPaymentErrorKey, VOID_REASONS } from "@/lib/validation/payments";

/** Owner-only "Void payment" with a reason (ADR 0010); the payment stays listed, struck through. */
export function VoidPayment({
  businessSlug,
  paymentId,
  amount,
}: {
  businessSlug: string;
  paymentId: string;
  /** Already formatted. */
  amount: string;
}) {
  const t = useTranslations("payments.void");
  const validation = useTranslations("validation");
  const paymentErrors = useTranslations("payments.errors");
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
    const result = await voidPaymentAction(businessSlug, paymentId, { reason });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
      return;
    }
    const issue = result.error.issues?.[0]?.message;
    if (issue && isValidationKey(issue)) setError(validation(issue));
    else if (isPaymentErrorKey(result.error.message)) setError(paymentErrors(result.error.message));
    else setError(errors("generic"));
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t("button")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>{t("title", { amount })}</DialogTitle>
          <DialogDescription>{t("explain")}</DialogDescription>
          <div className="flex flex-wrap gap-2">
            {VOID_REASONS.map((key) => (
              <Button
                key={key}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setReason(t(`reasons.${key}`));
                }}
              >
                {t(`reasons.${key}`)}
              </Button>
            ))}
          </div>
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
              {busy ? t("voiding") : t("confirm")}
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
