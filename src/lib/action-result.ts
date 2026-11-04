import { type PublicError } from "@/lib/errors";

/** What every server action returns: data, or an error that is safe to show. */
export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: PublicError };
