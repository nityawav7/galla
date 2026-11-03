import "./load-env";

/** Brings the test database to the latest schema and reference data once per run. */
export default async function setup(): Promise<void> {
  const { closeDb, getDb, runMigrations } = await import("@/server/db/client");
  const { seedReferenceData } = await import("@/server/db/seed/reference");
  try {
    await runMigrations();
    await seedReferenceData(getDb());
  } catch (error) {
    const reason = error instanceof Error ? error.message || error.name : String(error);
    const message = `Cannot prepare the test database (${reason}). Is Postgres running? Try \`pnpm db:up\`.`;
    // Vite 8.3's module runner crashes while printing errors thrown from global setup
    // ("code.charCodeAt is not a function"), hiding the cause. Print it ourselves first.
    process.stderr.write(`\n${message}\n\n`);
    throw new Error(message, { cause: error });
  } finally {
    await closeDb();
  }
}
