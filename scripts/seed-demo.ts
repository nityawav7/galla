/**
 * Builds (or rebuilds) the demo business locally: the same as the daily reset (SPEC F12, §9).
 *   pnpm db:seed:demo
 * Deterministic: the same day gives the same shop. Refuses Neon, so it can only run locally;
 * production is reset by Vercel Cron (/api/cron/demo-reset).
 */
import { createRequire } from "node:module";

import type * as NextEnv from "@next/env";

const { loadEnvConfig } = createRequire(import.meta.url)("@next/env") as typeof NextEnv;
loadEnvConfig(process.cwd());

const { closeDb, driverFor } = await import("../src/server/db/client");
const { env } = await import("../src/lib/env");
const { runDemoReset } = await import("../src/server/jobs/demo-reset");

if (driverFor(env.DATABASE_URL) === "neon") {
  throw new Error("Refusing to seed the demo into a Neon database; production resets by cron.");
}

try {
  const summary = await runDemoReset();
  console.log(
    `Demo business ready: ${String(summary.invoices)} invoices (${String(summary.cancelled)} cancelled), ${String(summary.creditNotes)} credit notes, ${String(summary.payments)} payments, in ${(summary.ms / 1000).toFixed(1)} s.`,
  );
} finally {
  await closeDb();
}
