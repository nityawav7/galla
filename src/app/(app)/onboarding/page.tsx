import { type Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { OnboardingWizard } from "@/components/forms/onboarding-wizard";
import { SignOutButton } from "@/components/forms/sign-out-button";
import { requireUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("title") };
}

async function SignedInWizard() {
  await requireUser();
  return <OnboardingWizard />;
}

export default async function OnboardingPage() {
  const t = await getTranslations("onboarding");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <SignOutButton />
      </div>
      <Suspense>
        <SignedInWizard />
      </Suspense>
    </main>
  );
}
