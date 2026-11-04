import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

/** The signed-in user for this request, or null. Reads the session from the database. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, name, email, emailVerified } = session.user;
  return { id, name, email, emailVerified };
}

/** For pages and server actions that need a user: redirects to /login without one. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
