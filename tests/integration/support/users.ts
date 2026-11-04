import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

import { uniqueSlug } from "./tenants";

/** A user row without going through Better Auth (no password, no session). */
export async function createUser(name = "Test User"): Promise<{ id: string; email: string }> {
  const email = `${uniqueSlug("user")}@example.com`;
  const [row] = await getDb().insert(users).values({ name, email }).returning();
  if (!row) throw new Error("insert returned no row");
  return { id: row.id, email };
}
