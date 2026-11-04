import { type Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { SignOutButton } from "@/components/forms/sign-out-button";
import { InviteDecision, VerifyEmailForInvite } from "@/components/members/invite-steps";
import { isAppError } from "@/lib/errors";
import { getSessionUser } from "@/server/auth/session";
import { getInviteDetails, type InviteDetails } from "@/server/services/member.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("invite");
  return { title: t("title") };
}

async function loadDetails(token: string): Promise<InviteDetails | undefined> {
  try {
    return await getInviteDetails(await headers(), token);
  } catch (error) {
    // Expired, cancelled or someone else's invite: all look the same.
    if (isAppError(error)) return undefined;
    throw error;
  }
}

async function InviteStep({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations();
  const user = await getSessionUser();
  const next = encodeURIComponent(`/invite/${token}`);

  if (!user) {
    return (
      <>
        <p>{t("invite.signedOut")}</p>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/login?next=${next}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {t("invite.signIn")}
          </Link>
          <Link
            href={`/signup?next=${next}`}
            className="font-medium underline-offset-4 hover:underline"
          >
            {t("invite.signUp")}
          </Link>
        </div>
      </>
    );
  }

  const signedInAs = (
    <div className="flex flex-col gap-2 border-t pt-4">
      <p className="text-sm text-muted-foreground">
        {t("invite.signedInAs", { email: user.email })}
      </p>
      <div>
        <SignOutButton />
      </div>
    </div>
  );

  if (!user.emailVerified) {
    return (
      <>
        <VerifyEmailForInvite email={user.email} />
        {signedInAs}
      </>
    );
  }

  const details = await loadDetails(token);
  if (!details) {
    return (
      <>
        <p>{t("invite.invalid")}</p>
        {signedInAs}
      </>
    );
  }
  return (
    <>
      <p>
        {t("invite.details", {
          inviter: details.inviterEmail,
          business: details.businessName,
          role: t(`roles.${details.role}`),
        })}
      </p>
      <InviteDecision token={token} />
      {signedInAs}
    </>
  );
}

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const t = await getTranslations("invite");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <InviteStep params={params} />
      </Suspense>
    </>
  );
}
