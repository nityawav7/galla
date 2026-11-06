"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  archiveCustomerAction,
  restoreCustomerAction,
} from "@/app/(app)/b/[businessSlug]/customers/actions";
import {
  archiveProductAction,
  restoreProductAction,
} from "@/app/(app)/b/[businessSlug]/products/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type ActionResult } from "@/lib/action-result";

interface ArchiveToggleProps {
  archived: boolean;
  archive: () => Promise<ActionResult<null>>;
  restore: () => Promise<ActionResult<null>>;
  labels: {
    archive: string;
    restore: string;
    hint: string;
    notice: string;
    conflict: string;
  };
}

/** Archive or restore. Archiving never deletes: past invoices keep their own copy. */
function ArchiveToggle({ archived, archive, restore, labels }: ArchiveToggleProps) {
  const errors = useTranslations("errors");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    setError(null);
    startTransition(async () => {
      const result = archived ? await restore() : await archive();
      if (result.ok) {
        router.refresh();
        return;
      }
      setError(result.error.code === "CONFLICT" ? labels.conflict : errors("generic"));
    });
  };

  return (
    <section className="flex flex-col gap-2 border-t pt-4" aria-live="polite">
      {archived ? <p className="text-sm font-medium">{labels.notice}</p> : null}
      <p className="text-xs text-muted-foreground">{labels.hint}</p>
      <div>
        <Button
          type="button"
          variant={archived ? "outline" : "destructive"}
          disabled={pending}
          onClick={toggle}
        >
          {archived ? labels.restore : labels.archive}
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

interface EntityToggleProps {
  businessSlug: string;
  id: string;
  archived: boolean;
}

export function ProductArchiveToggle({ businessSlug, id, archived }: EntityToggleProps) {
  const t = useTranslations("products");
  return (
    <ArchiveToggle
      archived={archived}
      archive={() => archiveProductAction(businessSlug, id)}
      restore={() => restoreProductAction(businessSlug, id)}
      labels={{
        archive: t("archive"),
        restore: t("restore"),
        hint: t("archiveHint"),
        notice: t("archivedNotice"),
        conflict: t("restoreConflict"),
      }}
    />
  );
}

export function CustomerArchiveToggle({ businessSlug, id, archived }: EntityToggleProps) {
  const t = useTranslations("customers");
  return (
    <ArchiveToggle
      archived={archived}
      archive={() => archiveCustomerAction(businessSlug, id)}
      restore={() => restoreCustomerAction(businessSlug, id)}
      labels={{
        archive: t("archive"),
        restore: t("restore"),
        hint: t("archiveHint"),
        notice: t("archivedNotice"),
        conflict: t("restoreConflict"),
      }}
    />
  );
}
