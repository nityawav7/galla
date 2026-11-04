import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";

import { getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

import { uniqueSlug } from "./tenants";

export interface SignedInUser {
  id: string;
  name: string;
  email: string;
  /** Request headers carrying the session cookie, as a browser would send them. */
  headers: Headers;
}

/** A real Better Auth account, signed in. Verified unless asked otherwise. */
export async function signedInUser({
  name = "Test User",
  email = `${uniqueSlug("user")}@example.com`,
  verified = true,
}: { name?: string; email?: string; verified?: boolean } = {}): Promise<SignedInUser> {
  const password = randomUUID();
  const { user } = await getAuth().api.signUpEmail({ body: { name, email, password } });
  if (verified) {
    await getDb().update(users).set({ emailVerified: true }).where(eq(users.id, user.id));
  }
  const { headers } = await getAuth().api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { id: user.id, name, email: user.email, headers: new Headers({ cookie }) };
}
