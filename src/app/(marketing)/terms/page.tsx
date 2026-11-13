import { type Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LegalPage, LegalSection } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("terms");
  return { title: t("title") };
}

const ITEMS = ["free", "yours", "data", "fair", "accounts", "demo", "law"] as const;

/** The terms of use (SPEC §10). Plain language, not lawyer-reviewed. */
export default async function TermsPage() {
  const t = await getTranslations("terms");
  return (
    <LegalPage title={t("title")}>
      <p>{t("intro")}</p>
      <LegalSection title={t("title")} items={ITEMS.map((key) => t(`items.${key}`))} />
    </LegalPage>
  );
}
