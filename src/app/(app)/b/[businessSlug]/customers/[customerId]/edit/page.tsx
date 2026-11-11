import { type Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { CustomerArchiveToggle } from "@/components/catalog/archive-toggle";
import { CustomerList } from "@/components/catalog/customer-list";
import { CustomerForm } from "@/components/forms/customer-form";
import { NotFoundError } from "@/lib/errors";
import { type CustomerFormValues } from "@/lib/validation/customers";
import { requireTenant } from "@/server/auth/session";
import { type TenantContext } from "@/server/authz/context";
import { can } from "@/server/authz/permissions";
import { type Customer } from "@/server/db/repos/customers.repo";
import { formatRupees } from "@/server/domain/money";
import { formatIndianPhone } from "@/server/domain/phone";
import { getCustomer } from "@/server/services/customer.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customers");
  return { title: t("editTitle") };
}

function toFormValues(customer: Customer): CustomerFormValues {
  const balance = customer.openingBalancePaise;
  const billingStateCode = customer.billingStateCode ?? "";
  return {
    name: customer.name,
    phone: customer.phoneE164 ? formatIndianPhone(customer.phoneE164) : "",
    email: customer.email ?? "",
    gstin: customer.gstin ?? "",
    billingAddressLine1: customer.billingAddressLine1 ?? "",
    billingAddressLine2: customer.billingAddressLine2 ?? "",
    billingCity: customer.billingCity ?? "",
    billingPincode: customer.billingPincode ?? "",
    billingStateCode,
    shippingAddressLine1: customer.shippingAddressLine1 ?? "",
    shippingAddressLine2: customer.shippingAddressLine2 ?? "",
    shippingCity: customer.shippingCity ?? "",
    shippingPincode: customer.shippingPincode ?? "",
    shippingStateCode: customer.shippingStateCode ?? "",
    balanceType: balance < 0n ? "ADVANCE" : "OWES",
    openingBalance: balance === 0n ? "" : formatRupees(balance < 0n ? -balance : balance),
    creditDays: customer.creditDays === 0 ? "" : String(customer.creditDays),
    // A saved mismatch was confirmed once already, so it stays ticked for the next save.
    stateOverride: Boolean(
      customer.gstin && billingStateCode && customer.gstin.slice(0, 2) !== billingStateCode,
    ),
    confirmDuplicatePhone: false,
  };
}

async function customerOr404(ctx: TenantContext, customerId: string): Promise<Customer> {
  try {
    return await getCustomer(ctx, customerId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

async function EditCustomer({
  params,
}: {
  params: Promise<{ businessSlug: string; customerId: string }>;
}) {
  const { businessSlug, customerId } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("customers");
  const customer = await customerOr404(ctx, customerId);
  const backLink = (
    <Link
      href={`/b/${businessSlug}/customers/${customer.id}`}
      className="text-sm underline underline-offset-4"
    >
      {t("ledger.backToCustomer")}
    </Link>
  );
  if (!can(ctx, "catalog:write")) {
    return (
      <>
        {backLink}
        <CustomerList businessSlug={businessSlug} customers={[customer]} />
        <p className="text-sm text-muted-foreground">{t("readOnly")}</p>
      </>
    );
  }
  return (
    <>
      {backLink}
      {customer.archivedAt ? <p className="text-sm font-medium">{t("archivedNotice")}</p> : null}
      <CustomerForm
        key={customer.updatedAt.toISOString()}
        businessSlug={businessSlug}
        customerId={customer.id}
        defaultValues={toFormValues(customer)}
      />
      <CustomerArchiveToggle
        businessSlug={businessSlug}
        id={customer.id}
        archived={customer.archivedAt !== null}
      />
    </>
  );
}

export default async function EditCustomerPage({
  params,
}: PageProps<"/b/[businessSlug]/customers/[customerId]/edit">) {
  const t = await getTranslations("customers");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("editTitle")}</h1>
      <Suspense>
        <EditCustomer params={params} />
      </Suspense>
    </>
  );
}
