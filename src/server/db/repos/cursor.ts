import { z } from "zod";

/**
 * Opaque cursors for keyset pagination by name (SPEC §6.1: no OFFSET). The cursor is the last
 * row shown; the next page starts after it. Only ever compared inside the caller's tenant.
 */
export interface NameCursor {
  name: string;
  id: string;
}

const cursorSchema = z.object({
  name: z.string().max(500),
  id: z.uuid(),
});

export function encodeCursor(cursor: NameCursor): string {
  return Buffer.from(JSON.stringify({ name: cursor.name, id: cursor.id })).toString("base64url");
}

/** A cursor from the URL. Anything unreadable means "start from the first page". */
export function decodeCursor(text: string | undefined): NameCursor | undefined {
  if (!text) return undefined;
  try {
    const result = cursorSchema.safeParse(JSON.parse(Buffer.from(text, "base64url").toString()));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/** Keyset cursor for lists ordered by a date, newest first (invoices). */
export interface DateCursor {
  date: string;
  id: string;
}

const dateCursorSchema = z.object({
  date: z.iso.date(),
  id: z.uuid(),
});

export function encodeDateCursor(cursor: DateCursor): string {
  return Buffer.from(JSON.stringify({ date: cursor.date, id: cursor.id })).toString("base64url");
}

export function decodeDateCursor(text: string | undefined): DateCursor | undefined {
  if (!text) return undefined;
  try {
    const result = dateCursorSchema.safeParse(
      JSON.parse(Buffer.from(text, "base64url").toString()),
    );
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
