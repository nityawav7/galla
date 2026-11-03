import { expect } from "vitest";

/** The Postgres constraint name behind an error, looking through Drizzle's wrapper. */
export function violatedConstraint(error: unknown): string | undefined {
  let current = error;
  while (current instanceof Error) {
    if ("constraint" in current && typeof current.constraint === "string") {
      return current.constraint;
    }
    current = current.cause;
  }
  return undefined;
}

/** Asserts the write is rejected by the named CHECK, UNIQUE or FOREIGN KEY constraint. */
export async function expectViolation(write: Promise<unknown>, constraint: string): Promise<void> {
  const error = await write.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, `expected "${constraint}" to reject the write`).toBeInstanceOf(Error);
  expect(violatedConstraint(error)).toBe(constraint);
}
