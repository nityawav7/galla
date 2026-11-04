import { NotFoundError } from "@/lib/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids come from URLs and forms; a malformed one is simply not found (never a DB error). */
export function requireId(id: string, entity: string): string {
  if (!UUID.test(id)) throw new NotFoundError(entity);
  return id;
}
