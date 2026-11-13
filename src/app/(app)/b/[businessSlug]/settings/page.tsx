import { type Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SettingsForm } from "@/components/forms/settings-form";
import { defaultShareTemplate } from "@/lib/share-templates";
import { type BusinessFormValues } from "@/lib/validation/business";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { type Business } from "@/server/db/repos/businesses.repo";
import { formatIndianPhone } from "@/server/domain/phone";
import { canSendEmail } from "@/server/notifications/email";
import { getBusiness } from "@/server/services/business.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: t("title") };
}

function toFormValues(business: Business): BusinessFormValues {
  return {
    legalName: business.legalName,
    tradeName: business.tradeName ?? "",
    addressLine1: business.addressLine1 ?? "",
    addressLine2: business.addressLine2 ?? "",
    city: business.city ?? "",
    pincode: business.pincode ?? "",
    stateCode: business.stateCode,
    phone: business.phoneE164 ? formatIndianPhone(business.phoneE164) : "",
    email: business.email ?? "",
    gstScheme: business.gstScheme,
    gstin: business.gstin ?? "",
    invoicePrefix: business.invoicePrefix,
    creditNotePrefix: business.creditNotePrefix,
    upiVpa: business.upiVpa ?? "",
    hsnDigitsRequired: business.hsnDigitsRequired === 6 ? "6" : "4",
    // The form shows the message that will be sent, the default included.
    whatsappTemplateEn: business.whatsappTemplateEn ?? defaultShareTemplate("en"),
    whatsappTemplateHi: business.whatsappTemplateHi ?? defaultShareTemplate("hi"),
    emailReminders: business.emailReminders,
    ownerDigest: business.ownerDigest,
  };
}

async function Settings({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { ctx } = await requireTenant(businessSlug);
  const t = await getTranslations("settings");
  if (!can(ctx, "business:manage")) {
    return <p className="text-muted-foreground">{t("ownerOnly")}</p>;
  }
  const business = await getBusiness(ctx);
  return (
    <SettingsForm
      businessSlug={businessSlug}
      defaultValues={toFormValues(business)}
      defaultTemplates={{ en: defaultShareTemplate("en"), hi: defaultShareTemplate("hi") }}
      emailReady={canSendEmail()}
      readOnly={business.isDemo}
    />
  );
}

export default async function SettingsPage({ params }: PageProps<"/b/[businessSlug]/settings">) {
  const t = await getTranslations("settings");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <Settings params={params} />
      </Suspense>
    </>
  );
}
