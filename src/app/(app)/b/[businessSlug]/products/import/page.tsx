import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProductImport } from "@/components/catalog/product-import";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("productsTitle") };
}

async function Import({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("products");
  return (
    <>
      <Link href={`/b/${businessSlug}/products`} className="text-sm underline underline-offset-4">
        {t("back")}
      </Link>
      {can(ctx, "catalog:write") ? (
        <ProductImport businessSlug={businessSlug} />
      ) : (
        <p className="text-muted-foreground">{t("readOnly")}</p>
      )}
    </>
  );
}

export default async function ImportProductsPage({
  params,
}: PageProps<"/b/[businessSlug]/products/import">) {
  const t = await getTranslations("import");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("productsTitle")}</h1>
      <Suspense>
        <Import params={params} />
      </Suspense>
    </>
  );
}
