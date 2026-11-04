import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import { type ResolvedTenant, resolveTenant } from "@/server/services/tenant.service";

import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

/**
 * The signed-in user for this request, or null. Reads the session from the database once
 * per request (`cache`), however many layouts and pages ask.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email, emailVerified } = session.user;
  return { id, name, email, emailVerified };
});

/** For pages and server actions that need a user: redirects to /login without one. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For everything under /b/{slug}: the user's TenantContext there, or a 404 if they are not
 * a member (SPEC F1). Server actions call this themselves; they never trust the layout.
 */
export const requireTenant = cache(
  async (slug: string): Promise<ResolvedTenant & { user: SessionUser }> => {
    const user = await requireUser();
    const tenant = await resolveTenant(user.id, slug);
    if (!tenant) notFound();
    return { ...tenant, user };
  },
);
