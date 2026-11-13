import { type Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LegalPage, LegalSection } from "@/components/legal-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("privacy");
  return { title: t("title") };
}

/** What Galla stores and who handles it (SPEC §10). Plain language, not lawyer-reviewed. */
export default async function PrivacyPage() {
  const t = await getTranslations("privacy");
  return (
    <LegalPage title={t("title")}>
      <p>{t("intro")}</p>
      <LegalSection
        title={t("storeTitle")}
        items={[t("store.account"), t("store.business"), t("store.logs")]}
      />
      <LegalSection
        title={t("useTitle")}
        items={[t("use.service"), t("use.noSale"), t("use.cookies")]}
      />
      <LegalSection
        title={t("servicesTitle")}
        items={[
          t("services.vercel"),
          t("services.neon"),
          t("services.upstash"),
          t("services.sentry"),
          t("services.backblaze"),
        ]}
      />
      <LegalSection title={t("rightsTitle")} items={[t("rights.export"), t("rights.delete")]} />
      <LegalSection title={t("demoTitle")} items={[t("demo")]} />
    </LegalPage>
  );
}
