import { z } from "zod";

/** Listing filters from the URL (`?q=&cursor=&archived=1`). Bad values fall back to defaults. */
export const listQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value === "" ? undefined : value)),
  cursor: z.string().max(500).optional().catch(undefined),
  archived: z
    .unknown()
    .transform((value) => value === "1" || value === true)
    .catch(false),
});

export type ListQuery = z.output<typeof listQuerySchema>;
