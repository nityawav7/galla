import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Also what non-members of a business see (SPEC F1): it never says the business exists. */
export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground">{t("notFoundBody")}</p>
      <Link href="/b" className="text-sm font-medium underline-offset-4 hover:underline">
        {t("goHome")}
      </Link>
    </main>
  );
}
