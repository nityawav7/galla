"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { emailInvoiceAction } from "@/app/(app)/b/[businessSlug]/invoices/actions";
import { Button } from "@/components/ui/button";
import { track } from "@/lib/observability/track";

type State = "idle" | "sending" | "sent" | "tooMany" | "failed";

/**
 * "Email invoice" (SPEC F9): sends the invoice's link to the customer's saved email. Shown only
 * when the server said it can be sent; it can be sent again (30 an hour per business).
 */
export function EmailInvoice({
  businessSlug,
  invoiceId,
}: {
  businessSlug: string;
  invoiceId: string;
}) {
  const t = useTranslations("invoices.emailInvoice");
  const [state, setState] = useState<State>("idle");

  const send = async () => {
    setState("sending");
    const result = await emailInvoiceAction(businessSlug, invoiceId);
    if (result.ok) {
      track("invoice_emailed");
      setState("sent");
    } else setState(result.error.code === "RATE_LIMITED" ? "tooMany" : "failed");
  };

  const message =
    state === "sent"
      ? t("sent")
      : state === "tooMany"
        ? t("tooMany")
        : state === "failed"
          ? t("failed")
          : "";

  return (
    <div className="flex flex-col gap-1">
      <div>
        <Button
          type="button"
          size="lg"
          variant="outline"
          disabled={state === "sending"}
          onClick={() => void send()}
        >
          {state === "sending" ? t("sending") : t("button")}
        </Button>
      </div>
      <p
        role="status"
        data-testid="email-invoice-status"
        className={
          state === "tooMany" || state === "failed"
            ? "text-sm text-destructive"
            : "text-sm text-muted-foreground"
        }
      >
        {message}
      </p>
    </div>
  );
}
