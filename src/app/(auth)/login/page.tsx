import { type Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { TryDemo } from "@/components/demo/try-demo";
import { LoginForm } from "@/components/forms/login-form";
import { APP_NAME } from "@/lib/config";
import { isGoogleEnabled } from "@/server/auth/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.login");
  return { title: t("title") };
}

export default async function LoginPage() {
  const t = await getTranslations("auth.login");
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle", { app: APP_NAME })}</p>
      </header>
      {/* The form reads ?next=, which needs a Suspense boundary on a static page. */}
      <Suspense>
        <LoginForm googleEnabled={isGoogleEnabled()} />
      </Suspense>
      <TryDemo />
      <p className="text-sm text-muted-foreground">
        {t("noAccount", { app: APP_NAME })}{" "}
        <Link
          href="/signup"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("signUpLink")}
        </Link>
      </p>
    </>
  );
}
