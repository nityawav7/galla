import { NotFoundError } from "@/lib/errors";
import { inviteSchema, roleSchema } from "@/lib/validation/members";
import { authBaseUrl, getAuth } from "@/server/auth/auth";
import { callAuth } from "@/server/auth/call";
import { type Role, type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import {
  findInvitationById,
  type Invitation,
  listPendingInvitations,
} from "@/server/db/repos/invitations.repo";
import {
  findMemberById,
  listMembersWithUsers,
  listMemberships,
  type MemberWithUser,
} from "@/server/db/repos/members.repo";

import { parseInput } from "./validate";

/*
 * Invites and members (SPEC F1, §2.1). Better Auth stores invitations and memberships and
 * enforces its own rules (expiry, recipient email, the last owner). Its HTTP endpoints for
 * organizations are blocked, so these functions are the only way in: they check permissions
 * here and write the audit row right after Better Auth's write (ADR 0004).
 *
 * `requestHeaders` carries the caller's session cookie, which Better Auth checks again.
 */

export type { Invitation, MemberWithUser };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids come from URLs and forms; a malformed one is simply not found (never a DB error). */
function requireId(id: string, entity: string): string {
  if (!UUID.test(id)) throw new NotFoundError(entity);
  return id;
}

export function inviteLink(invitationId: string): string {
  return `${authBaseUrl()}/invite/${invitationId}`;
}

export function listMembers(ctx: TenantContext): Promise<MemberWithUser[]> {
  assertCan(ctx, "records:view");
  return listMembersWithUsers(getDb(), ctx);
}

export function listInvitations(ctx: TenantContext): Promise<Invitation[]> {
  assertCan(ctx, "business:manage");
  return listPendingInvitations(getDb(), ctx);
}

/** Emails the invite (7 days). Inviting someone already invited sends a fresh invite. */
export async function inviteMember(
  ctx: TenantContext,
  requestHeaders: Headers,
  input: unknown,
): Promise<{ invitationId: string; link: string }> {
  assertCan(ctx, "business:manage");
  const { email, role } = parseInput(inviteSchema, input);
  const invitation = await callAuth(() =>
    getAuth().api.createInvitation({
      headers: requestHeaders,
      body: { email, role, organizationId: ctx.businessId, resend: true },
    }),
  );
  await insertAuditLog(getDb(), ctx, {
    entity: "invitation",
    entityId: invitation.id,
    action: "invitation.created",
    diff: { after: { email, role } },
  });
  return { invitationId: invitation.id, link: inviteLink(invitation.id) };
}

export async function cancelInvitation(
  ctx: TenantContext,
  requestHeaders: Headers,
  invitationId: string,
): Promise<void> {
  assertCan(ctx, "business:manage");
  const invitation = await findInvitationById(getDb(), ctx, requireId(invitationId, "Invitation"));
  if (!invitation) throw new NotFoundError("Invitation");
  await callAuth(() =>
    getAuth().api.cancelInvitation({ headers: requestHeaders, body: { invitationId } }),
  );
  await insertAuditLog(getDb(), ctx, {
    entity: "invitation",
    entityId: invitationId,
    action: "invitation.cancelled",
    diff: { before: { email: invitation.email, role: invitation.role } },
  });
}

export async function updateMemberRole(
  ctx: TenantContext,
  requestHeaders: Headers,
  memberId: string,
  input: unknown,
): Promise<void> {
  assertCan(ctx, "business:manage");
  const role: Role = parseInput(roleSchema, input);
  const member = await findMemberById(getDb(), ctx, requireId(memberId, "Member"));
  if (!member) throw new NotFoundError("Member");
  if (member.role === role) return;
  await callAuth(() =>
    getAuth().api.updateMemberRole({
      headers: requestHeaders,
      body: { memberId, role, organizationId: ctx.businessId },
    }),
  );
  await insertAuditLog(getDb(), ctx, {
    entity: "member",
    entityId: memberId,
    action: "member.role_changed",
    diff: { before: { role: member.role }, after: { role } },
  });
}

export async function removeMember(
  ctx: TenantContext,
  requestHeaders: Headers,
  memberId: string,
): Promise<void> {
  assertCan(ctx, "business:manage");
  const member = await findMemberById(getDb(), ctx, requireId(memberId, "Member"));
  if (!member) throw new NotFoundError("Member");
  await callAuth(() =>
    getAuth().api.removeMember({
      headers: requestHeaders,
      body: { memberIdOrEmail: memberId, organizationId: ctx.businessId },
    }),
  );
  await insertAuditLog(getDb(), ctx, {
    entity: "member",
    entityId: memberId,
    action: "member.removed",
    diff: { before: { userId: member.userId, role: member.role } },
  });
}

export interface InviteDetails {
  businessName: string;
  role: Role;
  inviterEmail: string;
}

/** For the invite page. Only the invited, signed-in, verified user can see it. */
export async function getInviteDetails(
  requestHeaders: Headers,
  invitationId: string,
): Promise<InviteDetails> {
  requireId(invitationId, "Invitation");
  const invitation = await callAuth(() =>
    getAuth().api.getInvitation({ headers: requestHeaders, query: { id: invitationId } }),
  );
  return {
    businessName: invitation.organizationName,
    role: parseInput(roleSchema, invitation.role),
    inviterEmail: invitation.inviterEmail,
  };
}

/** Joins the business. Returns its slug for the redirect to its dashboard. */
export async function acceptInvite(
  userId: string,
  requestHeaders: Headers,
  invitationId: string,
): Promise<{ slug: string }> {
  requireId(invitationId, "Invitation");
  const result = await callAuth(() =>
    getAuth().api.acceptInvitation({ headers: requestHeaders, body: { invitationId } }),
  );
  const { member } = result;
  const ctx: TenantContext = {
    userId,
    businessId: member.organizationId,
    role: parseInput(roleSchema, member.role),
  };
  await insertAuditLog(getDb(), ctx, {
    entity: "member",
    entityId: member.id,
    action: "member.joined",
    diff: { after: { invitationId, role: ctx.role } },
  });
  const membership = (await listMemberships(getDb(), userId)).find(
    (candidate) => candidate.businessId === member.organizationId,
  );
  if (!membership) throw new NotFoundError("Business");
  return { slug: membership.slug };
}

export async function declineInvite(
  userId: string,
  requestHeaders: Headers,
  invitationId: string,
): Promise<void> {
  requireId(invitationId, "Invitation");
  const result = await callAuth(() =>
    getAuth().api.rejectInvitation({ headers: requestHeaders, body: { invitationId } }),
  );
  const businessId = result.invitation?.organizationId;
  if (!businessId) return;
  // The decliner is not a member; the row belongs to the inviting business and names the
  // decliner as actor. (The role is not stored; insertAuditLog only takes the ids.)
  await insertAuditLog(
    getDb(),
    { userId, businessId, role: "STAFF" },
    { entity: "invitation", entityId: invitationId, action: "invitation.declined" },
  );
}
