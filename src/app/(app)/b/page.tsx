import { type Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SignOutButton } from "@/components/forms/sign-out-button";
import { requireUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return { title: t("title") };
}

async function SignedInHome() {
  const user = await requireUser();
  const t = await getTranslations("home");
  return (
    <>
      <p className="text-sm text-muted-foreground">{t("signedInAs", { name: user.name })}</p>
      <p>{t("noBusinessYet")}</p>
      <div>
        <SignOutButton />
      </div>
    </>
  );
}

// Phase 4b turns this into the business picker and sends new users to onboarding.
export default async function BusinessesPage() {
  const t = await getTranslations("home");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <SignedInHome />
      </Suspense>
    </main>
  );
}
