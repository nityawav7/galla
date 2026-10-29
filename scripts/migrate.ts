/**
 * Applies pending drizzle migrations to DATABASE_URL.
 * Locally it reads .env.local; in CI/production the variable comes from the environment.
 */
import { createRequire } from "node:module";

import type * as NextEnv from "@next/env";

// @next/env is bundled CommonJS; Node's ESM loader cannot see its named exports.
const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof NextEnv;

loadEnvConfig(process.cwd());

// Imported after the env is loaded: env.ts validates on import.
const { closeDb, runMigrations } = await import("../src/server/db/client");

try {
  const driver = await runMigrations();
  console.log(`Migrations applied (driver: ${driver}).`);
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
