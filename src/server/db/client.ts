import { Pool as NeonPool } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { migrate as migrateNeon } from "drizzle-orm/neon-serverless/migrator";
import { drizzle as drizzlePg, type NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import { type PgDatabase } from "drizzle-orm/pg-core";
import pg from "pg";

import { env } from "@/lib/env";

import * as schema from "./schema";

/** Neon's Pool returns pg-compatible results, so raw `execute()` results have `.rows` on both drivers. */
export type Database = PgDatabase<NodePgQueryResultHKT, typeof schema>;

/**
 * Neon's serverless Pool speaks WebSockets, which plain Postgres (Docker, CI)
 * does not. Both drivers expose the same Drizzle API, so callers never care.
 */
export type DbDriver = "neon" | "pg";

export function driverFor(databaseUrl: string): DbDriver {
  return new URL(databaseUrl).hostname.endsWith(".neon.tech") ? "neon" : "pg";
}

interface DbHandle {
  db: Database;
  driver: DbDriver;
  migrate: (migrationsFolder: string) => Promise<void>;
  close: () => Promise<void>;
}

function connect(databaseUrl: string): DbHandle {
  if (driverFor(databaseUrl) === "neon") {
    const pool = new NeonPool({ connectionString: databaseUrl });
    const db = drizzleNeon({ client: pool, schema, casing: "snake_case" });
    return {
      db,
      driver: "neon",
      migrate: (migrationsFolder) => migrateNeon(db, { migrationsFolder }),
      close: () => pool.end(),
    };
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzlePg({ client: pool, schema, casing: "snake_case" });
  return {
    db,
    driver: "pg",
    migrate: (migrationsFolder) => migratePg(db, { migrationsFolder }),
    close: () => pool.end(),
  };
}

// One pool per process; stored on globalThis so Next.js dev reloads don't leak pools.
const globalForDb = globalThis as typeof globalThis & { gallaDb?: DbHandle };

function handle(): DbHandle {
  globalForDb.gallaDb ??= connect(env.DATABASE_URL);
  return globalForDb.gallaDb;
}

export function getDb(): Database {
  return handle().db;
}

export async function runMigrations(migrationsFolder = "drizzle"): Promise<DbDriver> {
  const { driver, migrate } = handle();
  await migrate(migrationsFolder);
  return driver;
}

export async function closeDb(): Promise<void> {
  const current = globalForDb.gallaDb;
  globalForDb.gallaDb = undefined;
  await current?.close();
}
