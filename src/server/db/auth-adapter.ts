import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { getDb } from "./client";
import {
  accounts,
  businesses,
  invitations,
  members,
  sessions,
  users,
  verifications,
} from "./schema";

/**
 * Better Auth reads and writes its tables through this adapter. It lives in db/ so the
 * schema stays out of the rest of the app (ADR 0003). Keys are Better Auth's model names;
 * field renames (organization.name → legalName, …) are configured in auth.ts.
 */
export function authDatabase() {
  return drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      organization: businesses,
      member: members,
      invitation: invitations,
    },
  });
}
