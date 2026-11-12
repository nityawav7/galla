import { z } from "zod";

import { AUDIT_CATEGORIES } from "@/server/domain/audit/describe";

const optionalIsoDate = z.iso.date().optional().catch(undefined);

/** Activity page filters from the URL. Bad values fall back to "no filter", never an error. */
export const auditQuerySchema = z.object({
  from: optionalIsoDate,
  to: optionalIsoDate,
  category: z.enum(AUDIT_CATEGORIES).optional().catch(undefined),
  actor: z.uuid().optional().catch(undefined),
  cursor: z.string().max(500).optional().catch(undefined),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
