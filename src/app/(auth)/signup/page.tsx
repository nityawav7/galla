import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SignupForm } from "@/components/forms/signup-form";
import { isGoogleEnabled } from "@/server/auth/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.signup");
  return { title: t("title") };
}

export default async function SignupPage() {
  const t = await getTranslations("auth.signup");
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>
      <SignupForm googleEnabled={isGoogleEnabled()} />
      <p className="text-sm text-muted-foreground">
        {t("haveAccount")}{" "}
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("signInLink")}
        </Link>
      </p>
    </>
  );
}
