import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CustomerForm } from "@/components/forms/customer-form";
import { EMPTY_CUSTOMER_FORM } from "@/lib/validation/customers";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("newTitle") };
}

async function NewCustomer({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("customers");
  return (
    <>
      <Link href={`/b/${businessSlug}/customers`} className="text-sm underline underline-offset-4">
        {t("back")}
      </Link>
      {can(ctx, "catalog:write") ? (
        <CustomerForm businessSlug={businessSlug} defaultValues={EMPTY_CUSTOMER_FORM} />
      ) : (
        <p className="text-muted-foreground">{t("readOnly")}</p>
      )}
    </>
  );
}

export default async function NewCustomerPage({
  params,
}: PageProps<"/b/[businessSlug]/customers/new">) {
  const t = await getTranslations("customers");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("newTitle")}</h1>
      <Suspense>
        <NewCustomer params={params} />
      </Suspense>
    </>
  );
}
