import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProductArchiveToggle } from "@/components/catalog/archive-toggle";
import { ProductList } from "@/components/catalog/product-list";
import { ProductForm } from "@/components/forms/product-form";
import { NotFoundError } from "@/lib/errors";
import { type ProductFormValues } from "@/lib/validation/products";
import { requireTenant } from "@/server/auth/session";
import { type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/permissions";
import { type Product } from "@/server/db/repos/products.repo";
import { formatRupees } from "@/server/domain/money";
import { getBusiness } from "@/server/services/business.service";
import { getProduct, getProductFormOptions } from "@/server/services/product.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products");
  return { title: t("editTitle") };
}

function toFormValues(product: Product): ProductFormValues {
  return {
    name: product.name,
    hsnSac: product.hsnSac ?? "",
    unit: product.unit,
    price: formatRupees(product.pricePaise),
    rateBp: String(product.rateBp),
    priceIncludesTax: product.priceIncludesTax,
    sku: product.sku ?? "",
  };
}

async function productOr404(ctx: TenantContext, productId: string): Promise<Product> {
  try {
    return await getProduct(ctx, productId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

async function EditProduct({
  params,
}: {
  params: Promise<{ businessSlug: string; productId: string }>;
}) {
  const { businessSlug, productId } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("products");
  const product = await productOr404(ctx, productId);
  const backLink = (
    <Link href={`/b/${businessSlug}/products`} className="text-sm underline underline-offset-4">
      {t("back")}
    </Link>
  );
  if (!can(ctx, "catalog:write")) {
    return (
      <>
        {backLink}
        <ProductList businessSlug={businessSlug} products={[product]} />
        <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      </>
    );
  }
  const [options, business] = await Promise.all([
    getProductFormOptions(ctx, product.rateBp),
    getBusiness(ctx),
  ]);
  return (
    <>
      {backLink}
      {product.archivedAt ? <p className="text-sm font-medium">{t("archivedNotice")}</p> : null}
      <ProductForm
        key={product.updatedAt.toISOString()}
        businessSlug={businessSlug}
        productId={product.id}
        defaultValues={toFormValues(product)}
        options={options}
        chargesGst={business.gstScheme === "REGULAR"}
      />
      <ProductArchiveToggle
        businessSlug={businessSlug}
        id={product.id}
        archived={product.archivedAt !== null}
      />
    </>
  );
}

export default async function ProductPage({
  params,
}: PageProps<"/b/[businessSlug]/products/[productId]">) {
  const t = await getTranslations("products");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("editTitle")}</h1>
      <Suspense>
        <EditProduct params={params} />
      </Suspense>
    </>
  );
}
