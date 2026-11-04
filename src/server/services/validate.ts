import { type z } from "zod";

import { ValidationError } from "@/lib/errors";

/**
 * Parses service input with a shared Zod schema (CLAUDE.md rule 7). Failures become a
 * ValidationError whose issue messages are `validation.*` keys, so forms can show them.
 */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ValidationError(
    "Some fields need attention",
    result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
  );
}
