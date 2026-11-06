import { getTranslations } from "next-intl/server";

import { cn } from "@/lib/utils";
import { type DisplayStatus } from "@/server/domain/invoice/status";

const TONES: Record<DisplayStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  ISSUED: "bg-secondary text-secondary-foreground",
  PARTIALLY_PAID: "bg-secondary text-secondary-foreground",
  PAID: "bg-primary/10 text-primary",
  CREDITED: "bg-primary/10 text-primary",
  OVERDUE: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-muted text-muted-foreground line-through",
};

/** The status shown to people (OVERDUE and CREDITED are derived, SPEC §4.8). */
export async function StatusBadge({ status }: { status: DisplayStatus }) {
  const t = await getTranslations("invoices.status");
  return (
    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[status])}>
      {t(status)}
    </span>
  );
}
