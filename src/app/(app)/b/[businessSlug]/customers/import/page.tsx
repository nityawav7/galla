import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CustomerImport } from "@/components/catalog/customer-import";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("import");
  return { title: t("customersTitle") };
}

async function Import({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("customers");
  return (
    <>
      <Link href={`/b/${businessSlug}/customers`} className="text-sm underline underline-offset-4">
        {t("back")}
      </Link>
      {can(ctx, "catalog:write") ? (
        <CustomerImport businessSlug={businessSlug} />
      ) : (
        <p className="text-muted-foreground">{t("readOnly")}</p>
      )}
    </>
  );
}

export default async function ImportCustomersPage({
  params,
}: PageProps<"/b/[businessSlug]/customers/import">) {
  const t = await getTranslations("import");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("customersTitle")}</h1>
      <Suspense>
        <Import params={params} />
      </Suspense>
    </>
  );
}
