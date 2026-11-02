/**
 * Seeds DATABASE_URL (SPEC §9).
 *   pnpm db:seed            reference data + the local dev business
 *   pnpm db:seed:reference  reference data only (runs in every Vercel build)
 * Both are idempotent.
 */
import { createRequire } from "node:module";

import type * as NextEnv from "@next/env";

// @next/env is bundled CommonJS; Node's ESM loader cannot see its named exports.
const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof NextEnv;

loadEnvConfig(process.cwd());

const referenceOnly = process.argv.includes("--reference-only");

// Imported after the env is loaded: env.ts validates on import.
const { closeDb, driverFor, getDb } = await import("../src/server/db/client");
const { seedReferenceData } = await import("../src/server/db/seed/reference");
const { seedDevBusiness } = await import("../src/server/db/seed/dev-business");
const { env } = await import("../src/lib/env");

try {
  await seedReferenceData(getDb());
  console.log("Reference data seeded (states, tax rates, units).");

  if (!referenceOnly) {
    // The dev business is for local databases only, never Neon (preview or production).
    if (driverFor(env.DATABASE_URL) === "neon") {
      throw new Error("Refusing to seed the dev business into a Neon database.");
    }
    const { businessId, created } = await seedDevBusiness();
    console.log(`Dev business ${created ? "created" : "already present"}: ${businessId}`);
  }
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
