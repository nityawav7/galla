import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ProductForm } from "@/components/forms/product-form";
import { EMPTY_PRODUCT_FORM } from "@/lib/validation/products";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { getBusiness } from "@/server/services/business.service";
import { getProductFormOptions } from "@/server/services/product.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("products");
  return { title: t("newTitle") };
}

async function NewProduct({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("products");
  const backLink = (
    <Link href={`/b/${businessSlug}/products`} className="text-sm underline underline-offset-4">
      {t("back")}
    </Link>
  );
  if (!can(ctx, "catalog:write")) {
    return (
      <>
        {backLink}
        <p className="text-muted-foreground">{t("readOnly")}</p>
      </>
    );
  }
  const [options, business] = await Promise.all([getProductFormOptions(ctx), getBusiness(ctx)]);
  return (
    <>
      {backLink}
      <ProductForm
        businessSlug={businessSlug}
        defaultValues={EMPTY_PRODUCT_FORM}
        options={options}
        chargesGst={business.gstScheme === "REGULAR"}
      />
    </>
  );
}

export default async function NewProductPage({
  params,
}: PageProps<"/b/[businessSlug]/products/new">) {
  const t = await getTranslations("products");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("newTitle")}</h1>
      <Suspense>
        <NewProduct params={params} />
      </Suspense>
    </>
  );
}
