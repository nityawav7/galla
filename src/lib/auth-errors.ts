/**
 * Maps errors from the Better Auth client (and our 429 limiter) to keys under
 * `auth.errors` in src/messages. Unknown codes fall back to a generic message.
 */
export type AuthErrorKey =
  | "invalidCredentials"
  | "emailTaken"
  | "invalidCode"
  | "tooManyAttempts"
  | "weakPassword"
  | "generic";

const BY_CODE: Record<string, AuthErrorKey> = {
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  INVALID_EMAIL: "invalidCredentials",
  INVALID_PASSWORD: "invalidCredentials",
  USER_ALREADY_EXISTS: "emailTaken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "emailTaken",
  INVALID_OTP: "invalidCode",
  OTP_EXPIRED: "invalidCode",
  TOO_MANY_ATTEMPTS: "tooManyAttempts",
  RATE_LIMITED: "tooManyAttempts",
  PASSWORD_TOO_SHORT: "weakPassword",
  PASSWORD_TOO_LONG: "weakPassword",
};

export function authErrorKey(
  error: { code?: string | undefined; status?: number } | null | undefined,
): AuthErrorKey {
  if (!error) return "generic";
  if (error.status === 429) return "tooManyAttempts";
  return (error.code ? BY_CODE[error.code] : undefined) ?? "generic";
}
