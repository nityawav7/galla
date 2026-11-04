import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SignOutButton } from "@/components/forms/sign-out-button";
import { requireUser } from "@/server/auth/session";
import { listBusinessesForUser } from "@/server/services/tenant.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  return { title: t("title") };
}

/** Where sign-in lands: onboarding for a new user, straight in with one business, else a list. */
async function BusinessPicker() {
  const user = await requireUser();
  const businesses = await listBusinessesForUser(user.id);
  const [only] = businesses;
  if (!only) redirect("/onboarding");
  if (businesses.length === 1) redirect(`/b/${only.slug}/dashboard`);

  const t = await getTranslations();
  return (
    <>
      <p className="text-sm text-muted-foreground">{t("home.signedInAs", { name: user.name })}</p>
      <ul className="flex flex-col gap-2">
        {businesses.map((business) => (
          <li key={business.businessId}>
            <Link
              href={`/b/${business.slug}/dashboard`}
              className="flex items-center justify-between rounded-lg border p-4 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <span className="font-medium">{business.tradeName ?? business.legalName}</span>
              <span className="text-sm text-muted-foreground">{t(`roles.${business.role}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Link href="/onboarding" className="text-sm font-medium underline-offset-4 hover:underline">
          {t("home.addBusiness")}
        </Link>
      </div>
      <div>
        <SignOutButton />
      </div>
    </>
  );
}

export default async function BusinessesPage() {
  const t = await getTranslations("home");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <BusinessPicker />
      </Suspense>
    </main>
  );
}
