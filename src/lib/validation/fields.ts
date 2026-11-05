import { z } from "zod";

import { type GstinInvalidReason } from "@/server/domain/gstin";
import { normalizeIndianPhone } from "@/server/domain/phone";

import { type ValidationKey } from "./messages";

/** Field building blocks shared by the schemas in this folder. Errors are `validation.*` keys. */

export const text = (max: number) => z.string().trim().max(max, { error: "textTooLong" });

export const requiredText = (max: number, error: ValidationKey) => text(max).min(1, { error });

/** Empty becomes null, so saving a form can clear the field. */
export const optionalText = (max: number) => text(max).transform((value) => value || null);

/** An Indian phone number in any common format, stored as E.164; empty becomes null. */
export const optionalPhone = z
  .string()
  .trim()
  .refine((value) => !value || normalizeIndianPhone(value) !== null, { error: "phoneInvalid" })
  .transform((value) => (value ? normalizeIndianPhone(value) : null));

/** Lower-cased; empty becomes null. */
export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .refine((value) => !value || z.email().safeParse(value).success, { error: "emailInvalid" })
  .transform((value) => value || null);

export const GSTIN_ERRORS = {
  FORMAT: "gstinFormat",
  STATE: "gstinState",
  CHECKSUM: "gstinChecksum",
  UNSUPPORTED: "gstinUnsupported",
} as const satisfies Record<GstinInvalidReason, ValidationKey>;

const YES = new Set(["yes", "y", "true", "1", "हाँ", "हां"]);
const NO = new Set(["no", "n", "false", "0", "", "नहीं"]);

/** A checkbox (boolean) or a CSV cell ("yes", "no", "true", "1", blank for no). */
export const yesNo = z.union([z.boolean(), z.string()]).transform((value, ctx) => {
  if (typeof value === "boolean") return value;
  const word = value.trim().toLowerCase();
  if (YES.has(word)) return true;
  if (NO.has(word)) return false;
  ctx.addIssue({ code: "custom", message: "yesNoInvalid" });
  return z.NEVER;
});
