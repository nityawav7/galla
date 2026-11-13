import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { APP_NAME, SOURCE_URL } from "@/lib/config";

/** The public pages: landing, Privacy and Terms, with the "not tax advice" footer. */
export default async function MarketingLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("footer");
  const landing = await getTranslations("landing");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {APP_NAME}
          </Link>
          <Link href="/login" className="text-sm font-medium underline-offset-4 hover:underline">
            {landing("signIn")}
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 py-10">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm text-muted-foreground">
          <p>{t("disclaimer")}</p>
          <nav aria-label={APP_NAME} className="flex flex-wrap gap-4">
            <Link href="/privacy" className="underline-offset-4 hover:underline">
              {t("privacy")}
            </Link>
            <Link href="/terms" className="underline-offset-4 hover:underline">
              {t("terms")}
            </Link>
            <a href={SOURCE_URL} className="underline-offset-4 hover:underline" rel="noopener">
              {t("github")}
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
