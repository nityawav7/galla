import { sql } from "drizzle-orm";

import { type Database, getDb } from "./client";

export type Pingable = Pick<Database, "execute">;

/** The cheapest possible round trip, for health checks. */
export async function pingDatabase(db: Pingable = getDb()): Promise<void> {
  await db.execute(sql`select 1`);
}
