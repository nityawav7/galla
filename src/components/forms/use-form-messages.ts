"use client";

import { useTranslations } from "next-intl";
import { type FieldError } from "react-hook-form";

import { type AuthErrorKey } from "@/lib/auth-errors";
import { isValidationKey } from "@/lib/validation/messages";

/** Translates Zod message keys (field errors) and auth error keys (form errors). */
export function useFormMessages() {
  const validation = useTranslations("validation");
  const authErrors = useTranslations("auth.errors");
  return {
    fieldError: (error: FieldError | undefined) =>
      error?.message && isValidationKey(error.message) ? validation(error.message) : undefined,
    formError: (key: AuthErrorKey) => authErrors(key),
  };
}
