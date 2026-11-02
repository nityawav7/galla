import { v7 } from "uuid";

/**
 * Primary keys are UUIDv7: time-ordered (index-friendly, sortable by creation) and not
 * guessable like a serial (SPEC §6.2). Generated in the app because Postgres only has a
 * built-in `uuidv7()` from version 18, and local/CI Postgres is 16 (ADR 0003).
 */
export function newId(): string {
  return v7();
}
