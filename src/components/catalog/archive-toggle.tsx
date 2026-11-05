"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  archiveProductAction,
  restoreProductAction,
} from "@/app/(app)/b/[businessSlug]/products/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface ArchiveToggleProps {
  businessSlug: string;
  productId: string;
  archived: boolean;
}

/** Archive or restore a product. Archiving never deletes: past invoices keep their copy. */
export function ProductArchiveToggle({ businessSlug, productId, archived }: ArchiveToggleProps) {
  const t = useTranslations("products");
  const errors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const result = archived
        ? await restoreProductAction(businessSlug, productId)
        : await archiveProductAction(businessSlug, productId);
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.error.code === "CONFLICT" ? t("restoreConflict") : errors("generic"));
    });
  };

  return (
    <section className="flex flex-col gap-2 border-t pt-4" aria-live="polite">
      {archived ? <p className="text-sm font-medium">{t("archivedNotice")}</p> : null}
      <p className="text-xs text-muted-foreground">{t("archiveHint")}</p>
      <div>
        <Button
          type="button"
          variant={archived ? "outline" : "destructive"}
          disabled={pending}
          onClick={toggle}
        >
          {archived ? t("restore") : t("archive")}
        </Button>
      </div>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
