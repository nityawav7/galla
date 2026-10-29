import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { checkHealth } from "@/server/services/health.service";

afterAll(async () => {
  await closeDb();
});

describe("database", () => {
  it("runs a query", async () => {
    const result = await getDb().execute(sql`select 1 as one`);
    expect(result.rows).toEqual([{ one: 1 }]);
  });

  it("has the pg_trgm extension from the first migration", async () => {
    const result = await getDb().execute(
      sql`select extname from pg_extension where extname = 'pg_trgm'`,
    );
    expect(result.rows).toHaveLength(1);
  });
});

describe("checkHealth against a real database", () => {
  it("reports ok", async () => {
    const report = await checkHealth();
    expect(report).toMatchObject({ status: "ok", db: "ok" });
  });
});
