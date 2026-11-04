import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { type ReactNode, Suspense } from "react";

import { SignOutButton } from "@/components/forms/sign-out-button";
import { requireTenant } from "@/server/auth/session";
import { listBusinessesForUser } from "@/server/services/tenant.service";

async function TenantShell({
  params,
  children,
}: {
  params: Promise<{ businessSlug: string }>;
  children: ReactNode;
}) {
  const { businessSlug } = await params;
  // 404 for non-members. The proxy already answered them with a real 404 status; this is
  // the second check, in case a request ever reaches the page without it.
  const { membership, user } = await requireTenant(businessSlug);
  const businesses = await listBusinessesForUser(user.id);
  const t = await getTranslations();
  const base = `/b/${membership.slug}`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-col">
            <span className="font-semibold">{membership.tradeName ?? membership.legalName}</span>
            <span className="text-xs text-muted-foreground">{t(`roles.${membership.role}`)}</span>
          </div>
          <div className="flex items-center gap-3">
            {businesses.length > 1 ? (
              <Link href="/b" className="text-sm underline-offset-4 hover:underline">
                {t("shell.switchBusiness")}
              </Link>
            ) : null}
            <SignOutButton />
          </div>
        </div>
        <nav aria-label={t("shell.nav")} className="mx-auto flex w-full max-w-5xl gap-4 px-4 pb-2">
          <Link
            href={`${base}/dashboard`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {t("shell.dashboard")}
          </Link>
          <Link
            href={`${base}/settings`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {t("shell.settings")}
          </Link>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-6">
        {children}
      </main>
    </div>
  );
}

export default function TenantLayout({ params, children }: LayoutProps<"/b/[businessSlug]">) {
  return (
    <Suspense>
      <TenantShell params={params}>{children}</TenantShell>
    </Suspense>
  );
}
