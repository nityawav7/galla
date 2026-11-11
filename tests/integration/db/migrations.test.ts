import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/server/db/ids";

// BUILD_PLAN Phase 3 "done when": migrations apply cleanly on a fresh database.

const baseUrl = process.env.DATABASE_URL ?? "";
const freshName = `galla_fresh_${newId().replaceAll("-", "").slice(-12)}`;

function urlFor(database: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

const admin = new pg.Client({ connectionString: urlFor("postgres") });
let fresh: pg.Pool;

beforeAll(async () => {
  await admin.connect();
  await admin.query(`create database "${freshName}"`);
  fresh = new pg.Pool({ connectionString: urlFor(freshName), max: 1 });
});

afterAll(async () => {
  await fresh.end();
  await admin.query(`drop database if exists "${freshName}"`);
  await admin.end();
});

describe("migrations", () => {
  it("apply to an empty database, and a second run is a no-op", async () => {
    const db = drizzle({ client: fresh });
    await migrate(db, { migrationsFolder: "drizzle" });
    await migrate(db, { migrationsFolder: "drizzle" });

    const tables = await fresh.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' order by 1",
    );
    expect(tables.rows.map((r) => r.table_name)).toEqual([
      "accounts",
      "audit_logs",
      "businesses",
      "credit_note_lines",
      "credit_notes",
      "customers",
      "invitations",
      "invoice_lines",
      "invoices",
      "members",
      "number_sequences",
      "payment_allocations",
      "payments",
      "products",
      "refunds",
      "reminders_sent",
      "sessions",
      "states",
      "tax_rates",
      "units",
      "users",
      "verifications",
    ]);

    const trigram = await fresh.query(
      "select indexname from pg_indexes where indexname in ('products_name_trgm_idx', 'customers_name_trgm_idx')",
    );
    expect(trigram.rowCount).toBe(2);
  });
});
