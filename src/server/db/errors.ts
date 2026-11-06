/** Postgres error details, looking through Drizzle's wrapper (it keeps the driver error as `cause`). */

function postgresField(error: unknown, field: "constraint" | "code"): string | undefined {
  let current = error;
  while (current instanceof Error) {
    if (field in current) {
      const value: unknown = (current as unknown as Record<string, unknown>)[field];
      if (typeof value === "string") return value;
    }
    current = current.cause;
  }
  return undefined;
}

/** The name of the CHECK, UNIQUE or FOREIGN KEY constraint behind an error, if any. */
export function violatedConstraint(error: unknown): string | undefined {
  return postgresField(error, "constraint");
}

/** True when `error` is a unique violation (23505) of the named constraint or index. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return postgresField(error, "code") === "23505" && violatedConstraint(error) === constraint;
}

/** True when a trigger refused to change an issued document (restrict_violation, ADR 0006). */
export function isImmutableViolation(error: unknown): boolean {
  return postgresField(error, "code") === "23001";
}
