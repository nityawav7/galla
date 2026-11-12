"use server";

import { headers } from "next/headers";

import { type ActionResult } from "@/lib/action-result";
import { runMutation } from "@/server/action";
import { requireTenant } from "@/server/auth/session";
import {
  cancelInvitation,
  inviteMember,
  removeMember,
  updateMemberRole,
} from "@/server/services/member.service";

// Thin: membership from the URL's slug; member.service checks the role and validates.

export async function inviteMemberAction(
  businessSlug: string,
  values: unknown,
): Promise<ActionResult<{ link: string }>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    const { link } = await inviteMember(ctx, await headers(), values);
    return { link };
  });
}

export async function cancelInvitationAction(
  businessSlug: string,
  invitationId: string,
): Promise<ActionResult<null>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await cancelInvitation(ctx, await headers(), invitationId);
    return null;
  });
}

export async function updateMemberRoleAction(
  businessSlug: string,
  memberId: string,
  role: unknown,
): Promise<ActionResult<null>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await updateMemberRole(ctx, await headers(), memberId, role);
    return null;
  });
}

export async function removeMemberAction(
  businessSlug: string,
  memberId: string,
): Promise<ActionResult<null>> {
  return runMutation(async () => {
    const { ctx } = await requireTenant(businessSlug);
    await removeMember(ctx, await headers(), memberId);
    return null;
  });
}
