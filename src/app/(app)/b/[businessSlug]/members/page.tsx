import { type Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import {
  type InvitationRow,
  MembersPanel,
  type MemberRow,
} from "@/components/members/members-panel";
import { requireTenant } from "@/server/auth/session";
import { can } from "@/server/authz/permissions";
import { inviteLink, listInvitations, listMembers } from "@/server/services/member.service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members");
  return { title: t("title") };
}

const expiryFormat = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

async function Members({ params }: { params: Promise<{ businessSlug: string }> }) {
  const { businessSlug } = await params;
  const { ctx, membership } = await requireTenant(businessSlug);
  const canManage = can(ctx, "business:manage") && !membership.isDemo;
  const members: MemberRow[] = (await listMembers(ctx)).map((member) => ({
    memberId: member.memberId,
    name: member.name,
    email: member.email,
    role: member.role,
    isYou: member.userId === ctx.userId,
  }));
  const invitations: InvitationRow[] = canManage
    ? (await listInvitations(ctx)).map((invitation) => ({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expires: expiryFormat.format(invitation.expiresAt),
        link: inviteLink(invitation.id),
      }))
    : [];
  return (
    <MembersPanel
      businessSlug={businessSlug}
      canManage={canManage}
      demo={membership.isDemo}
      members={members}
      invitations={invitations}
    />
  );
}

export default async function MembersPage({ params }: PageProps<"/b/[businessSlug]/members">) {
  const t = await getTranslations("members");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <Suspense>
        <Members params={params} />
      </Suspense>
    </>
  );
}
