import { bigint, timestamp, uuid } from "drizzle-orm/pg-core";

import { newId } from "../ids";

// Column builders are functions so each table gets its own builder instance.

export const id = () => uuid().primaryKey().$defaultFn(newId);

/** Integer paise, read as `bigint` so money never passes through a float (ADR 0002). */
export const paise = () => bigint({ mode: "bigint" });

/** Integer milli-units (1.5 kg = 1500). */
export const milli = () => bigint({ mode: "bigint" });

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/**
 * The columns every tenant table carries (SPEC §7.4). `created_by` is the acting user's id.
 * It has no foreign key to `users` on purpose, so history outlives a deleted user (ADR 0004),
 * and is null only for rows written by the system (seed, jobs).
 */
export const audited = () => ({
  createdAt: createdAt(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  createdBy: uuid(),
});
