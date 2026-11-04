import { z } from "zod";

/**
 * Auth form schemas, shared by the client forms and anything server-side that needs them.
 * Messages are keys under `auth.validation` in src/messages, translated by the form.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: "emailInvalid" }));
const password = z
  .string()
  .min(8, { error: "passwordLength" })
  .max(128, { error: "passwordLength" });
const code = z
  .string()
  .trim()
  .regex(/^[0-9]{6}$/, { error: "codeFormat" });

export const signUpSchema = z.object({
  name: z.string().trim().min(1, { error: "nameRequired" }).max(100, { error: "nameTooLong" }),
  email,
  password,
});

export const passwordSignInSchema = z.object({
  email,
  // Any non-empty password may be tried; length rules only apply when choosing one.
  password: z.string().min(1, { error: "passwordLength" }).max(128, { error: "passwordLength" }),
});

export const emailOnlySchema = z.object({ email });

export const codeSignInSchema = z.object({ email, otp: code });

export const resetPasswordSchema = z.object({ email, otp: code, password });

export type SignUpInput = z.infer<typeof signUpSchema>;
export type PasswordSignInInput = z.infer<typeof passwordSignInSchema>;
export type EmailOnlyInput = z.infer<typeof emailOnlySchema>;
export type CodeSignInInput = z.infer<typeof codeSignInSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const VALIDATION_KEYS = [
  "nameRequired",
  "nameTooLong",
  "emailInvalid",
  "passwordLength",
  "codeFormat",
] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];

export function isValidationKey(value: unknown): value is ValidationKey {
  return typeof value === "string" && (VALIDATION_KEYS as readonly string[]).includes(value);
}
