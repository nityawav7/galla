import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProductList } from "@/components/catalog/product-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { listQuerySchema } from "@/lib/validation/products";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { listProducts } from "@/server/services/product.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products");
  return { title: t("title") };
}

type Params = PageProps<"/b/[businessSlug]/products">;

async function Products({ params, searchParams }: Pick<Params, "params" | "searchParams">) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const query = listQuerySchema.parse(await searchParams);
  const t = await getTranslations("products");
  const page = await listProducts(ctx, query);
  const base = `/b/${businessSlug}/products`;
  const withQuery = (extra: Record<string, string>) => {
    const search = new URLSearchParams({
      ...(query.q ? { q: query.q } : {}),
      ...(query.archived ? { archived: "1" } : {}),
      ...extra,
    });
    const text = search.toString();
    return text ? `${base}?${text}` : base;
  };

  return (
    <div className="flex flex-col gap-4">
      {query.archived ? <h2 className="text-lg font-semibold">{t("archivedTitle")}</h2> : null}
      {can(ctx, "catalog:write") ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="lg">
            <Link href={`${base}/new`}>{t("add")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`${base}/import`}>{t("import")}</Link>
          </Button>
        </div>
      ) : null}
      <form role="search" action={base} className="flex flex-col gap-1.5">
        <Label htmlFor="product-search">{t("search")}</Label>
        <div className="flex gap-2">
          <Input
            id="product-search"
            type="search"
            name="q"
            defaultValue={query.q ?? ""}
            placeholder={t("searchPlaceholder")}
            className="h-9"
          />
          {query.archived ? <input type="hidden" name="archived" value="1" /> : null}
          <Button type="submit" size="lg" variant="secondary">
            {t("searchButton")}
          </Button>
        </div>
        {query.q ? (
          <Link href={query.archived ? `${base}?archived=1` : base} className="text-sm underline">
            {t("clearSearch")}
          </Link>
        ) : null}
      </form>

      {page.items.length > 0 ? (
        <ProductList businessSlug={businessSlug} products={page.items} />
      ) : (
        <p className="text-muted-foreground">
          {query.q
            ? t("noMatches", { q: query.q })
            : query.archived
              ? t("emptyArchived")
              : t("empty")}
        </p>
      )}

      <nav className="flex flex-wrap gap-4 text-sm" aria-label={t("title")}>
        {query.cursor ? (
          <Link href={withQuery({})} className="underline underline-offset-4">
            {t("firstPage")}
          </Link>
        ) : null}
        {page.nextCursor ? (
          <Link
            href={withQuery({ cursor: page.nextCursor })}
            className="underline underline-offset-4"
          >
            {t("nextPage")}
          </Link>
        ) : null}
        <Link
          href={query.archived ? base : `${base}?archived=1`}
          className="text-muted-foreground underline underline-offset-4"
        >
          {query.archived ? t("showActive") : t("showArchived")}
        </Link>
      </nav>
    </div>
  );
}

export default async function ProductsPage({ params, searchParams }: Params) {
  const t = await getTranslations("products");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <Products params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
