import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { POST as authPost } from "@/app/api/auth/[...all]/route";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { EMPTY_BUSINESS_FORM } from "@/lib/validation/business";
import { type TenantContext } from "@/server/authz/context";
import { getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { invitations } from "@/server/db/schema";
import { clearTestOutbox, readTestOutbox } from "@/server/notifications/email";
import { createBusiness } from "@/server/services/business.service";
import {
  acceptInvite,
  cancelInvitation,
  declineInvite,
  getInviteDetails,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  updateMemberRole,
} from "@/server/services/member.service";
import { resolveTenant } from "@/server/services/tenant.service";

import { type SignedInUser, signedInUser } from "../support/sessions";
import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";

interface Owner extends SignedInUser {
  ctx: TenantContext;
  slug: string;
  businessName: string;
}

async function ownerWithBusiness(): Promise<Owner> {
  const user = await signedInUser({ name: "Ramesh <Owner>" });
  const businessName = `Shop & Sons ${randomUUID().slice(0, 6)}`;
  const { businessId, slug } = await createBusiness(user.id, {
    ...EMPTY_BUSINESS_FORM,
    legalName: businessName,
    addressLine1: "12 Station Road",
    city: "Pune",
    pincode: "411001",
    stateCode: "27",
    gstScheme: "UNREGISTERED",
  });
  return { ...user, ctx: { userId: user.id, businessId, role: "OWNER" }, slug, businessName };
}

const invitationIdFrom = (link: string) => link.split("/invite/")[1] ?? "";

async function invited(owner: Owner, role: "STAFF" | "ACCOUNTANT" | "OWNER" = "STAFF") {
  const invitee = await signedInUser({ name: "Sunita Staff" });
  const { link } = await inviteMember(owner.ctx, owner.headers, { email: invitee.email, role });
  return { invitee, invitationId: invitationIdFrom(link), link };
}

async function joined(owner: Owner, role: "STAFF" | "ACCOUNTANT" | "OWNER" = "STAFF") {
  const { invitee, invitationId } = await invited(owner, role);
  await acceptInvite(invitee.id, invitee.headers, invitationId);
  const member = (await listMembers(owner.ctx)).find((row) => row.userId === invitee.id);
  if (!member) throw new Error("invitee did not join");
  return { invitee, memberId: member.memberId };
}

beforeEach(() => {
  clearTestOutbox();
});

describe("inviteMember", () => {
  it("creates a 7-day invite, emails the link and audits it", async () => {
    const owner = await ownerWithBusiness();
    const before = Date.now();
    const { invitee, invitationId, link } = await invited(owner);

    expect(link).toMatch(/^http:\/\/localhost:3000\/invite\/[0-9a-f-]{36}$/);
    const [pending] = await listInvitations(owner.ctx);
    expect(pending).toMatchObject({ id: invitationId, email: invitee.email, role: "STAFF" });
    const expiresInDays = ((pending?.expiresAt.getTime() ?? 0) - before) / 86_400_000;
    expect(expiresInDays).toBeGreaterThan(6.99);
    expect(expiresInDays).toBeLessThan(7.01);

    const email = readTestOutbox().find((sent) => sent.to === invitee.email);
    expect(email?.text).toContain(link);
    expect(email?.subject).toContain(owner.businessName);
    // Names typed by users are escaped in the HTML version.
    expect(email?.html).toContain("Ramesh &#60;Owner&#62;");
    expect(email?.html).not.toContain("<Owner>");

    const [audit] = await listAuditLogs(getDb(), owner.ctx, { entity: "invitation" });
    expect(audit).toMatchObject({ action: "invitation.created", actorUserId: owner.id });
  });

  it.each(["ACCOUNTANT", "STAFF"] as const)("is owner-only: %s is forbidden", async (role) => {
    const owner = await ownerWithBusiness();
    await expect(
      inviteMember({ ...owner.ctx, role }, owner.headers, {
        email: "x@example.com",
        role: "STAFF",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates the input", async () => {
    const owner = await ownerWithBusiness();
    await expect(
      inviteMember(owner.ctx, owner.headers, { email: "not-an-email", role: "BOSS" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to invite someone who is already a member", async () => {
    const owner = await ownerWithBusiness();
    const { invitee } = await joined(owner);
    const error = await inviteMember(owner.ctx, owner.headers, {
      email: invitee.email,
      role: "STAFF",
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ConflictError);
    expect((error as ConflictError).message).toBe("alreadyMember");
  });

  it("re-inviting the same email sends again instead of failing", async () => {
    const owner = await ownerWithBusiness();
    const { invitee } = await invited(owner);
    await inviteMember(owner.ctx, owner.headers, { email: invitee.email, role: "STAFF" });
    expect(readTestOutbox().filter((sent) => sent.to === invitee.email)).toHaveLength(2);
    expect(await listInvitations(owner.ctx)).toHaveLength(1);
  });
});

describe("accepting an invite", () => {
  it("joins the business with the invited role and audits it", async () => {
    const owner = await ownerWithBusiness();
    const { invitee, invitationId } = await invited(owner, "ACCOUNTANT");

    expect(await getInviteDetails(invitee.headers, invitationId)).toMatchObject({
      businessName: owner.businessName,
      role: "ACCOUNTANT",
      inviterEmail: owner.email,
    });
    expect(await acceptInvite(invitee.id, invitee.headers, invitationId)).toEqual({
      slug: owner.slug,
    });

    const tenant = await resolveTenant(invitee.id, owner.slug);
    expect(tenant?.ctx).toMatchObject({ businessId: owner.ctx.businessId, role: "ACCOUNTANT" });
    expect(await listInvitations(owner.ctx)).toEqual([]);
    const [audit] = await listAuditLogs(getDb(), owner.ctx, { entity: "member" });
    expect(audit).toMatchObject({ action: "member.joined", actorUserId: invitee.id });
  });

  it("needs a verified email first", async () => {
    const owner = await ownerWithBusiness();
    const invitee = await signedInUser({ verified: false });
    const { link } = await inviteMember(owner.ctx, owner.headers, {
      email: invitee.email,
      role: "STAFF",
    });
    const error = await acceptInvite(invitee.id, invitee.headers, invitationIdFrom(link)).catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).message).toBe("verifyFirst");
    expect(await resolveTenant(invitee.id, owner.slug)).toBeNull();
  });

  it("is not found for anyone but the invited email", async () => {
    const owner = await ownerWithBusiness();
    const { invitationId } = await invited(owner);
    const stranger = await signedInUser();
    await expect(getInviteDetails(stranger.headers, invitationId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(acceptInvite(stranger.id, stranger.headers, invitationId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await resolveTenant(stranger.id, owner.slug)).toBeNull();
  });

  it("is not found once expired", async () => {
    const owner = await ownerWithBusiness();
    const { invitee, invitationId } = await invited(owner);
    await getDb()
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, invitationId));
    await expect(acceptInvite(invitee.id, invitee.headers, invitationId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("is not found for a malformed id (never a database error)", async () => {
    const invitee = await signedInUser();
    await expect(getInviteDetails(invitee.headers, "not-a-uuid")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("can be declined, which is audited", async () => {
    const owner = await ownerWithBusiness();
    const { invitee, invitationId } = await invited(owner);
    await declineInvite(invitee.id, invitee.headers, invitationId);
    expect(await listInvitations(owner.ctx)).toEqual([]);
    expect(await resolveTenant(invitee.id, owner.slug)).toBeNull();
    const [audit] = await listAuditLogs(getDb(), owner.ctx, { entity: "invitation" });
    expect(audit).toMatchObject({ action: "invitation.declined", actorUserId: invitee.id });
  });
});

describe("cancelInvitation", () => {
  it("withdraws the invite so its link stops working", async () => {
    const owner = await ownerWithBusiness();
    const { invitee, invitationId } = await invited(owner);
    await cancelInvitation(owner.ctx, owner.headers, invitationId);
    expect(await listInvitations(owner.ctx)).toEqual([]);
    await expect(acceptInvite(invitee.id, invitee.headers, invitationId)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("changing and removing members", () => {
  it("changes a role and audits before and after", async () => {
    const owner = await ownerWithBusiness();
    const { invitee, memberId } = await joined(owner);
    await updateMemberRole(owner.ctx, owner.headers, memberId, "ACCOUNTANT");
    expect((await resolveTenant(invitee.id, owner.slug))?.ctx.role).toBe("ACCOUNTANT");
    const [audit] = await listAuditLogs(getDb(), owner.ctx, { entity: "member" });
    expect(audit).toMatchObject({
      action: "member.role_changed",
      diff: { before: { role: "STAFF" }, after: { role: "ACCOUNTANT" } },
    });
  });

  it("removes a member, who then gets not found", async () => {
    const owner = await ownerWithBusiness();
    const { invitee, memberId } = await joined(owner);
    await removeMember(owner.ctx, owner.headers, memberId);
    expect(await resolveTenant(invitee.id, owner.slug)).toBeNull();
    const [audit] = await listAuditLogs(getDb(), owner.ctx, { entity: "member" });
    expect(audit).toMatchObject({ action: "member.removed" });
  });

  it("never leaves a business without an owner", async () => {
    const owner = await ownerWithBusiness();
    const ownerMember = (await listMembers(owner.ctx)).find((row) => row.userId === owner.id);
    const ownerMemberId = ownerMember?.memberId ?? "";
    for (const attempt of [
      updateMemberRole(owner.ctx, owner.headers, ownerMemberId, "STAFF"),
      removeMember(owner.ctx, owner.headers, ownerMemberId),
    ]) {
      const error = await attempt.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(ConflictError);
      expect((error as ConflictError).message).toBe("lastOwner");
    }
    expect((await resolveTenant(owner.id, owner.slug))?.ctx.role).toBe("OWNER");
  });

  it("lets a second owner take over, after which the first can step down", async () => {
    const owner = await ownerWithBusiness();
    await joined(owner, "OWNER");
    const ownerMember = (await listMembers(owner.ctx)).find((row) => row.userId === owner.id);
    await updateMemberRole(owner.ctx, owner.headers, ownerMember?.memberId ?? "", "STAFF");
    expect((await resolveTenant(owner.id, owner.slug))?.ctx.role).toBe("STAFF");
  });

  it.each(["ACCOUNTANT", "STAFF"] as const)("is owner-only: %s is forbidden", async (role) => {
    const owner = await ownerWithBusiness();
    const { memberId } = await joined(owner);
    await expect(
      updateMemberRole({ ...owner.ctx, role }, owner.headers, memberId, "OWNER"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      removeMember({ ...owner.ctx, role }, owner.headers, memberId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("Better Auth's organization endpoints over HTTP", () => {
  it("are blocked, so nothing can skip the checks and the audit log", async () => {
    const owner = await ownerWithBusiness();
    const response = await authPost(
      new Request("http://localhost:3000/api/auth/organization/invite-member", {
        method: "POST",
        headers: { cookie: owner.headers.get("cookie") ?? "", "content-type": "application/json" },
        body: JSON.stringify({
          email: "sneaky@example.com",
          role: "OWNER",
          organizationId: owner.ctx.businessId,
        }),
      }),
    );
    expect(response.status).toBe(404);
    expect(await listInvitations(owner.ctx)).toEqual([]);
  });
});

describe("member.service tenant isolation", () => {
  itIsolatesTenants({
    listMembers: isolationCase({
      arrange: () => Promise.resolve(undefined),
      act: (intruder) => listMembers(intruder.ctx),
    }),
    listInvitations: isolationCase({
      arrange: () => Promise.resolve(undefined),
      act: (intruder) => listInvitations(intruder.ctx),
    }),
    cancelInvitation: isolationCase({
      arrange: async () => {
        const owner = await ownerWithBusiness();
        return (await invited(owner)).invitationId;
      },
      act: (intruder, invitationId) => cancelInvitation(intruder.ctx, new Headers(), invitationId),
    }),
    updateMemberRole: isolationCase({
      arrange: async () => {
        const owner = await ownerWithBusiness();
        return (await joined(owner)).memberId;
      },
      act: (intruder, memberId) => updateMemberRole(intruder.ctx, new Headers(), memberId, "OWNER"),
    }),
    removeMember: isolationCase({
      arrange: async () => {
        const owner = await ownerWithBusiness();
        return (await joined(owner)).memberId;
      },
      act: (intruder, memberId) => removeMember(intruder.ctx, new Headers(), memberId),
    }),
  });
});
