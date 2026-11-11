"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { applyAdvanceAction } from "@/app/(app)/b/[businessSlug]/customers/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/server/domain/money";

/**
 * "Apply advance" (SPEC F7): money the customer has on account goes to their oldest dues in one
 * tap. The server decides the split under its row locks; this shows what it did.
 */
export function ApplyAdvance({
  businessSlug,
  customerId,
  onAccountPaise,
}: {
  businessSlug: string;
  customerId: string;
  /** As a string: bigint doesn't cross to the browser. */
  onAccountPaise: string;
}) {
  const t = useTranslations("customers.ledger.apply");
  const errors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await applyAdvanceAction(businessSlug, customerId);
      if (result.ok) {
        setMessage({ ok: true, text: t("applied", { amount: formatINR(BigInt(result.data)) }) });
        router.refresh();
        return;
      }
      setMessage({ ok: false, text: errors("generic") });
    });
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm">{t("hint", { amount: formatINR(BigInt(onAccountPaise)) })}</p>
      <div>
        <Button type="button" variant="secondary" disabled={pending} onClick={apply}>
          {pending ? t("applying") : t("button")}
        </Button>
      </div>
      <div aria-live="polite">
        {message ? (
          message.ok ? (
            <p className="text-sm">{message.text}</p>
          ) : (
            <Alert variant="destructive">
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )
        ) : null}
      </div>
    </div>
  );
}
