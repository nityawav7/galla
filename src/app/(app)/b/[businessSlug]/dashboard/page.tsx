import { type Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { requireTenant } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

async function Welcome({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { membership } = await requireTenant(businessSlug);
  const t = await getTranslations("dashboard");
  return (
    <>
      <p className="text-lg">
        {t("welcome", { name: membership.tradeName ?? membership.legalName })}
      </p>
      <p className="text-muted-foreground">{t("comingSoon")}</p>
    </>
  );
}

// Placeholder until the real dashboard (Phase 9).
export default async function DashboardPage({ params }: PageProps<"/b/[businessSlug]/dashboard">) {
  const t = await getTranslations("dashboard");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <Welcome params={params} />
      </Suspense>
    </>
  );
}
