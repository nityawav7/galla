import { type Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { auditQuerySchema } from "@/lib/validation/audit";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { AUDIT_CATEGORIES, type AuditValue } from "@/server/domain/audit/describe";
import { formatIndianDate } from "@/server/domain/fy";
import { formatINR } from "@/server/domain/money";
import { formatRatePercent } from "@/server/domain/tax-rate";
import {
  type AuditActor,
  type AuditItem,
  type AuditLink,
  getAuditFilterOptions,
  listAuditEntries,
} from "@/server/services/audit.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return { title: t("title") };
}

type Params = PageProps<"/b/[businessSlug]/audit">;
type Translate = Awaited<ReturnType<typeof getTranslations<"audit">>>;

const SELECT_CLASS =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm";

function formatValue(value: AuditValue, t: Translate): string {
  switch (value.kind) {
    case "empty":
      return t("values.empty");
    case "text":
      return value.text;
    case "money":
      return formatINR(value.paise);
    case "rate":
      return formatRatePercent(value.bp);
    case "date":
      return formatIndianDate(value.date);
    case "bool":
      return value.value ? t("values.yes") : t("values.no");
    case "count":
      return String(value.value);
    case "enum":
      switch (value.group) {
        case "mode":
          return t(`values.mode.${value.value}`);
        case "role":
          return t(`values.role.${value.value}`);
        case "status":
          return t(`values.status.${value.value}`);
        case "gstScheme":
          return t(`values.gstScheme.${value.value}`);
        case "type":
          return t(`values.type.${value.value}`);
        case "locale":
          return t(`values.locale.${value.value}`);
        case "source":
          return t(`values.source.${value.value}`);
      }
  }
}

function actorName(actor: AuditActor, t: Translate): string {
  return actor.kind === "member" ? actor.name : t(`actor.${actor.kind}`);
}

function sentence(item: AuditItem, t: Translate): string {
  if (!item.action) return t("actions.other");
  const subject = item.subject ?? (item.category ? t(`fallback.${item.category}`) : "");
  return t(`actions.${item.action}`, { subject });
}

function hrefOf(link: AuditLink, base: string): string {
  switch (link.kind) {
    case "invoice":
      return `${base}/invoices/${link.id}`;
    case "creditNote":
      return `${base}/credit-notes/${link.id}`;
    case "customer":
      return `${base}/customers/${link.id}`;
    case "product":
      return `${base}/products/${link.id}`;
    case "settings":
      return `${base}/settings`;
    case "members":
      return `${base}/members`;
  }
}

/** SPEC F11: who changed what and when, for owners and accountants. */
async function Activity({ params, searchParams }: Pick<Params, "params" | "searchParams">) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("audit");
  if (!can(ctx, "audit:view")) {
    return <p className="text-muted-foreground">{t("notAllowed")}</p>;
  }
  const query = auditQuerySchema.parse(await searchParams);
  const [page, options, locale] = await Promise.all([
    listAuditEntries(ctx, query),
    getAuditFilterOptions(ctx),
    getLocale(),
  ]);
  const when = new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  });
  const base = `/b/${businessSlug}`;
  const filters = {
    from: query.from,
    to: query.to,
    category: query.category,
    actor: query.actor,
  };
  const href = (cursor?: string) => {
    const search = new URLSearchParams(
      Object.entries({ ...filters, cursor }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
      ),
    ).toString();
    return search ? `${base}/audit?${search}` : `${base}/audit`;
  };
  const filtered = Object.values(filters).some(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      <form
        action={`${base}/audit`}
        className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1.5fr_1.5fr_auto] sm:items-end"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-from">{t("filters.from")}</Label>
          <Input
            id="audit-from"
            type="date"
            name="from"
            defaultValue={query.from ?? ""}
            className="h-9"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="audit-to">{t("filters.to")}</Label>
          <Input
            id="audit-to"
            type="date"
            name="to"
            defaultValue={query.to ?? ""}
            className="h-9"
          />
        </div>
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <Label htmlFor="audit-category">{t("filters.category")}</Label>
          <select
            id="audit-category"
            name="category"
            defaultValue={query.category ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">{t("filters.allCategories")}</option>
            {AUDIT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`categories.${category}`)}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
          <Label htmlFor="audit-actor">{t("filters.actor")}</Label>
          <select
            id="audit-actor"
            name="actor"
            defaultValue={query.actor ?? ""}
            className={SELECT_CLASS}
          >
            <option value="">{t("filters.allActors")}</option>
            {options.members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="lg" variant="secondary" className="col-span-2 sm:col-span-1">
          {t("filters.apply")}
        </Button>
      </form>
      {filtered ? (
        <Link href={`${base}/audit`} className="text-sm underline">
          {t("filters.clear")}
        </Link>
      ) : null}

      {page.items.length === 0 ? (
        <p className="text-muted-foreground">{filtered ? t("emptyFiltered") : t("empty")}</p>
      ) : (
        <ol
          className="flex flex-col divide-y rounded-lg border"
          aria-label={t("list")}
          data-testid="audit-list"
        >
          {page.items.map((item) => {
            const text = sentence(item, t);
            return (
              <li key={item.id} className="flex flex-col gap-1 p-3" data-testid="audit-entry">
                {item.link ? (
                  <Link
                    href={hrefOf(item.link, base)}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {text}
                  </Link>
                ) : (
                  <span className="font-medium">{text}</span>
                )}
                <span className="text-sm text-muted-foreground">
                  <time dateTime={item.at.toISOString()}>{when.format(item.at)}</time>
                  {" · "}
                  {actorName(item.actor, t)}
                </span>
                {item.changes.length + item.details.length > 0 ? (
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm break-words whitespace-pre-wrap">
                    {item.changes.map((change) => (
                      <li key={`change-${change.field}`}>
                        {t("change", {
                          field: t(`fields.${change.field}`),
                          before: formatValue(change.before, t),
                          after: formatValue(change.after, t),
                        })}
                      </li>
                    ))}
                    {item.details.map((detail) => (
                      <li key={`detail-${detail.field}`} className="text-muted-foreground">
                        {t("detail", {
                          field: t(`fields.${detail.field}`),
                          value: formatValue(detail.value, t),
                        })}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {page.nextCursor || query.cursor ? (
        <nav className="flex gap-4 text-sm" aria-label={t("pages")}>
          {query.cursor ? (
            <Link href={href()} className="underline underline-offset-4">
              {t("firstPage")}
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link href={href(page.nextCursor)} className="underline underline-offset-4">
              {t("nextPage")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

export default async function ActivityPage({ params, searchParams }: Params) {
  const t = await getTranslations("audit");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <Activity params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
