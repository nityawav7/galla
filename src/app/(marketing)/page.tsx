import { type Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { TryDemo } from "@/components/demo/try-demo";
import { Button } from "@/components/ui/button";
import { APP_NAME, SOURCE_URL } from "@/lib/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("landing");
  return { title: { absolute: `${APP_NAME} — ${t("metaTitle")}` }, description: t("lead") };
}

const PROBLEMS = ["one", "two", "three"] as const;
const FEATURES = ["invoice", "share", "ledger"] as const;
/** Made from the demo shop by `pnpm landing:screenshots` (390 × 844 at 2×). */
const SCREENS = ["dashboard", "invoice", "public"] as const;

/** The landing page (SPEC F12, §10): what Galla does, real screenshots, and the demo. */
export default async function HomePage() {
  const t = await getTranslations("landing");
  return (
    <>
      <section className="flex flex-col gap-5">
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          {t("heading")}
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">{t("lead")}</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link href="/signup">{t("createAccount")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/login">{t("signIn")}</Link>
          </Button>
        </div>
        <div className="max-w-xl">
          <TryDemo />
        </div>
      </section>

      <section aria-labelledby="problems" className="flex flex-col gap-4">
        <h2 id="problems" className="text-2xl font-semibold tracking-tight">
          {t("problemTitle")}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {PROBLEMS.map((key) => (
            <li key={key} className="rounded-lg border p-4 text-sm">
              {t(`problems.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="features" className="flex flex-col gap-4">
        <h2 id="features" className="text-2xl font-semibold tracking-tight">
          {t("featuresTitle")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((key) => (
            <article key={key} className="flex flex-col gap-2 rounded-lg border p-4">
              <h3 className="font-semibold">{t(`features.${key}Title`)}</h3>
              <p className="text-sm text-muted-foreground">{t(`features.${key}Body`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section aria-labelledby="screens" className="flex flex-col gap-4">
        <h2 id="screens" className="text-2xl font-semibold tracking-tight">
          {t("screensTitle")}
        </h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {SCREENS.map((key) => (
            <figure key={key} className="flex flex-col gap-2">
              <Image
                src={`/landing/${key}.jpg`}
                alt={t(`screens.${key}`)}
                width={390}
                height={844}
                unoptimized
                className="h-auto w-full rounded-xl border"
              />
              <figcaption className="text-sm text-muted-foreground">
                {t(`screens.${key}`)}
              </figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section aria-labelledby="open-source" className="flex flex-col gap-3">
        <h2 id="open-source" className="text-2xl font-semibold tracking-tight">
          {t("openSourceTitle")}
        </h2>
        <p className="max-w-2xl text-muted-foreground">{t("openSourceBody")}</p>
        <div>
          <Button asChild variant="outline">
            <a href={SOURCE_URL} rel="noopener">
              {t("github")}
            </a>
          </Button>
        </div>
      </section>
    </>
  );
}
