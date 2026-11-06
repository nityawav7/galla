import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { StatusBadge } from "@/components/invoice/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { INVOICE_LIST_STATUSES, invoiceListQuerySchema } from "@/lib/validation/invoices";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { now } from "@/server/clock";
import { formatIndianDate, istDateFromInstant } from "@/server/domain/fy";
import { displayStatus } from "@/server/domain/invoice/status";
import { formatINR } from "@/server/domain/money";
import { listInvoices } from "@/server/services/invoice.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invoices");
  return { title: t("title") };
}

type Params = PageProps<"/b/[businessSlug]/invoices">;

async function Invoices({ params, searchParams }: Pick<Params, "params" | "searchParams">) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const query = invoiceListQuerySchema.parse(await searchParams);
  const t = await getTranslations("invoices");
  const page = await listInvoices(ctx, query);
  const today = istDateFromInstant(now());
  const base = `/b/${businessSlug}/invoices`;
  const href = (extra: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      status: query.status,
      from: query.from,
      to: query.to,
      customer: query.customer,
      q: query.q,
      ...extra,
    };
    const search = new URLSearchParams(
      Object.entries(merged).filter((entry): entry is [string, string] => Boolean(entry[1])),
    ).toString();
    return search ? `${base}?${search}` : base;
  };
  const filtered = Boolean(query.customer ?? query.q ?? query.from ?? query.to);

  return (
    <div className="flex flex-col gap-4">
      {can(ctx, "invoice:issue") ? (
        <div>
          <Button asChild size="lg">
            <Link href={`${base}/new`}>{t("new")}</Link>
          </Button>
        </div>
      ) : null}

      <nav aria-label={t("filters")} className="flex gap-2 overflow-x-auto pb-1 whitespace-nowrap">
        {[undefined, ...INVOICE_LIST_STATUSES].map((status) => (
          <Link
            key={status ?? "ALL"}
            href={href({ status })}
            aria-current={query.status === status ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-sm",
              query.status === status && "border-primary bg-primary text-primary-foreground",
            )}
          >
            {t(`filter.${status ?? "ALL"}`)}
          </Link>
        ))}
      </nav>

      <form
        role="search"
        action={base}
        className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      >
        {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
        {query.customer ? <input type="hidden" name="customer" value={query.customer} /> : null}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="invoice-search">{t("search")}</Label>
          <Input
            id="invoice-search"
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder={t("searchPlaceholder")}
            className="h-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:contents">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-from">{t("from")}</Label>
            <Input
              id="invoice-from"
              type="date"
              name="from"
              defaultValue={query.from ?? ""}
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invoice-to">{t("to")}</Label>
            <Input
              id="invoice-to"
              type="date"
              name="to"
              defaultValue={query.to ?? ""}
              className="h-9"
            />
          </div>
        </div>
        <Button type="submit" size="lg" variant="secondary">
          {t("apply")}
        </Button>
      </form>
      {filtered ? (
        <Link
          href={href({ customer: undefined, q: undefined, from: undefined, to: undefined })}
          className="text-sm underline"
        >
          {t("clearFilters")}
        </Link>
      ) : null}

      {page.items.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {page.items.map(({ invoice, customerName }) => {
            const status = displayStatus({ ...invoice, today });
            const target =
              invoice.status === "DRAFT" ? `${base}/${invoice.id}/edit` : `${base}/${invoice.id}`;
            return (
              <li key={invoice.id}>
                <Link
                  href={target}
                  className="flex items-center justify-between gap-3 px-3 py-3 hover:bg-muted"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{invoice.number ?? t("draftLabel")}</span>
                    <span className="truncate text-sm text-muted-foreground">
                      {customerName || t("walkIn")} · {formatIndianDate(invoice.invoiceDate)}
                    </span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="font-medium">{formatINR(invoice.grandTotalPaise)}</span>
                    <StatusBadge status={status} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {page.nextCursor || query.cursor ? (
        <nav className="flex gap-4 text-sm" aria-label={t("pages")}>
          {query.cursor ? (
            <Link href={href({})} className="underline underline-offset-4">
              {t("firstPage")}
            </Link>
          ) : null}
          {page.nextCursor ? (
            <Link href={href({ cursor: page.nextCursor })} className="underline underline-offset-4">
              {t("nextPage")}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

export default async function InvoicesPage({ params, searchParams }: Params) {
  const t = await getTranslations("invoices");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <Invoices params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
