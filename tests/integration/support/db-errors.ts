import { expect } from "vitest";

import { violatedConstraint } from "@/server/db/errors";

/** Asserts the write is rejected by the named CHECK, UNIQUE or FOREIGN KEY constraint. */
export async function expectViolation(write: Promise<unknown>, constraint: string): Promise<void> {
  const error = await write.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error, `expected "${constraint}" to reject the write`).toBeInstanceOf(Error);
  expect(violatedConstraint(error)).toBe(constraint);
}
