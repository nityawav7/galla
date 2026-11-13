import { createHmac } from "node:crypto";

import { env } from "@/lib/env";

/**
 * The two people visitors become in the demo (SPEC F12, ADR 0018). Their emails are on
 * `.invalid`, a domain that can never receive mail, so the demo can't email anyone and nobody
 * can take the accounts over by email. Anything keyed on "is this the demo user" uses
 * `isDemoEmail`.
 */
export const DEMO_EMAIL_DOMAIN = "galla.invalid";

export type DemoRole = "OWNER" | "STAFF";

export interface DemoUser {
  name: string;
  email: string;
  role: DemoRole;
}

export const DEMO_USERS: readonly DemoUser[] = [
  { name: "Demo Owner", email: `demo-owner@${DEMO_EMAIL_DOMAIN}`, role: "OWNER" },
  { name: "Demo Staff", email: `demo-staff@${DEMO_EMAIL_DOMAIN}`, role: "STAFF" },
];

export function demoUser(role: DemoRole): DemoUser {
  const user = DEMO_USERS.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`no demo user for ${role}`);
  return user;
}

export function isDemoEmail(email: unknown): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`);
}

/**
 * The demo users' passwords: derived from BETTER_AUTH_SECRET, so there is nothing new to set up
 * and nobody without the secret can know them. Only the "Try the demo" action signs in with
 * them, on the server.
 */
export function demoPassword(role: DemoRole): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`galla-demo-user:${role}`)
    .digest("base64url");
}
