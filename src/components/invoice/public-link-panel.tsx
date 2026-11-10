"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import {
  regeneratePublicLinkAction,
  revokePublicLinkAction,
} from "@/app/(app)/b/[businessSlug]/invoices/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { type ShareInfo } from "@/server/services/share.service";

import { WhatsAppShare } from "./whatsapp-share";

/*
 * The customer's link to an issued invoice (SPEC F5, ADR 0009). Owners and staff see and copy
 * it; only the owner turns it off or replaces it, each after a confirmation.
 */

/** The link in a read-only field (easy to select on a phone) and a Copy button. */
export function CopyLink({ url }: { url: string }) {
  const t = useTranslations("invoices.link");
  const id = useId();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      setState("failed");
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={`${id}-link`} className="text-sm font-medium">
        {t("label")}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${id}-link`}
          readOnly
          value={url}
          data-testid="public-link"
          onFocus={(event) => {
            event.target.select();
          }}
          className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button type="button" size="lg" variant="outline" onClick={() => void copy()}>
          {t("copy")}
        </Button>
      </div>
      <p aria-live="polite" className="text-sm text-muted-foreground">
        {state === "copied" ? t("copied") : state === "failed" ? t("copyFailed") : ""}
      </p>
    </div>
  );
}

type Pending = "turnOff" | "newLink" | null;

export function PublicLinkPanel({
  businessSlug,
  invoiceId,
  url: initialUrl,
  canManage,
  share,
}: {
  businessSlug: string;
  invoiceId: string;
  url: string | null;
  canManage: boolean;
  /** WhatsApp sharing (SPEC F6), offered while the link is on. */
  share: ShareInfo | null;
}) {
  const t = useTranslations("invoices.link");
  const errors = useTranslations("errors");
  const [url, setUrl] = useState(initialUrl);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    const result =
      pending === "turnOff"
        ? await revokePublicLinkAction(businessSlug, invoiceId)
        : await regeneratePublicLinkAction(businessSlug, invoiceId);
    setBusy(false);
    if (!result.ok) {
      setError(errors("generic"));
      return;
    }
    setUrl(result.data.url);
    setPending(null);
  };

  return (
    <section
      aria-labelledby="public-link-heading"
      className="flex flex-col gap-2 rounded-xl border p-4"
    >
      <h2 id="public-link-heading" className="font-semibold">
        {t("title")}
      </h2>
      {url ? (
        <>
          <p className="text-sm text-muted-foreground">{t("hint")}</p>
          {share ? <WhatsAppShare share={share} url={url} /> : null}
          <CopyLink url={url} />
        </>
      ) : (
        <p role="status" className="text-sm">
          {t("off")}
        </p>
      )}
      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {url ? (
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => {
                setPending("turnOff");
              }}
            >
              {t("turnOff")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => {
              setPending("newLink");
            }}
          >
            {url ? t("newLink") : t("turnOn")}
          </Button>
        </div>
      ) : null}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{pending === "turnOff" ? t("turnOffTitle") : t("newLinkTitle")}</DialogTitle>
          <DialogDescription>
            {pending === "turnOff" ? t("turnOffBody") : t("newLinkBody")}
          </DialogDescription>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              variant={pending === "turnOff" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy
                ? t("working")
                : pending === "turnOff"
                  ? t("confirmTurnOff")
                  : t("confirmNewLink")}
            </Button>
            <Button
              type="button"
              size="lg"
              variant="outline"
              onClick={() => {
                setPending(null);
              }}
            >
              {t("keep")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
