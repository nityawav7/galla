import { getTranslations } from "next-intl/server";
import { type ReactNode } from "react";

import { ISSUES_URL, LEGAL_UPDATED } from "@/lib/config";
import { formatIndianDate } from "@/server/domain/fy";

/** The frame of the Privacy and Terms pages: title, date, the "not lawyer-reviewed" note. */
export async function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const t = await getTranslations("legal");
  return (
    <article className="flex max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {t("updated", { date: formatIndianDate(LEGAL_UPDATED) })}
        </p>
        <p className="rounded-lg border p-3 text-sm">{t("notReviewed")}</p>
      </header>
      {children}
      <p className="text-sm">
        <a href={ISSUES_URL} className="underline underline-offset-4" rel="noopener">
          {t("contact")}
        </a>
      </p>
    </article>
  );
}

export function LegalSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xl font-semibold">{title}</h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
