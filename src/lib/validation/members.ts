import { z } from "zod";

import { ROLES } from "@/server/authz/context";

/** Invites and role changes. Messages are keys under `validation` in src/messages. */

export const roleSchema = z.enum(ROLES, { error: "roleRequired" });

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: "emailInvalid" })),
  role: roleSchema,
});

export type InviteFormValues = z.input<typeof inviteSchema>;

/** Errors a member action can report back to the form, as keys under `members.errors`. */
export const MEMBER_ERROR_KEYS = [
  "alreadyMember",
  "alreadyInvited",
  "lastOwner",
  "inviteInvalid",
  "verifyFirst",
] as const;

export type MemberErrorKey = (typeof MEMBER_ERROR_KEYS)[number];

export function isMemberErrorKey(value: unknown): value is MemberErrorKey {
  return typeof value === "string" && (MEMBER_ERROR_KEYS as readonly string[]).includes(value);
}
