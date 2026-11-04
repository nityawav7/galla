import { describe, expect, it } from "vitest";

import { authErrorKey } from "@/lib/auth-errors";

describe("authErrorKey", () => {
  it.each([
    [{ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 }, "invalidCredentials"],
    [{ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 }, "emailTaken"],
    [{ code: "INVALID_OTP", status: 400 }, "invalidCode"],
    [{ code: "OTP_EXPIRED", status: 400 }, "invalidCode"],
    [{ code: "TOO_MANY_ATTEMPTS", status: 403 }, "tooManyAttempts"],
    [{ code: "RATE_LIMITED", status: 429 }, "tooManyAttempts"],
    [{ status: 429 }, "tooManyAttempts"],
    [{ code: "PASSWORD_TOO_SHORT", status: 400 }, "weakPassword"],
    [{ code: "SOMETHING_NEW", status: 500 }, "generic"],
    [{ status: 500 }, "generic"],
    [null, "generic"],
  ])("%o → %s", (error, key) => {
    expect(authErrorKey(error)).toBe(key);
  });
});
