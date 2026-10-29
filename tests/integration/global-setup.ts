import "./load-env";

/** Brings the test database to the latest schema once per run. */
export default async function setup(): Promise<void> {
  const { closeDb, runMigrations } = await import("@/server/db/client");
  try {
    await runMigrations();
  } finally {
    await closeDb();
  }
}
