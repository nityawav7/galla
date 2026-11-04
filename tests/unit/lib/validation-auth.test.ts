import { describe, expect, it } from "vitest";

import {
  codeSignInSchema,
  isValidationKey,
  passwordSignInSchema,
  signUpSchema,
  VALIDATION_KEYS,
} from "@/lib/validation/auth";
import en from "@/messages/en.json";

interface ParseResult {
  error?: { issues: { message: string }[] } | undefined;
}

const firstMessage = (result: ParseResult) => result.error?.issues[0]?.message;

describe("auth schemas", () => {
  it("normalizes the email and trims the name", () => {
    expect(
      signUpSchema.parse({ name: "  Asha  ", email: " Asha@Example.COM ", password: "12345678" }),
    ).toEqual({ name: "Asha", email: "asha@example.com", password: "12345678" });
  });

  it.each([
    [{ name: "", email: "a@b.in", password: "12345678" }, "nameRequired"],
    [{ name: "x".repeat(101), email: "a@b.in", password: "12345678" }, "nameTooLong"],
    [{ name: "Asha", email: "not-an-email", password: "12345678" }, "emailInvalid"],
    [{ name: "Asha", email: "a@b.in", password: "1234567" }, "passwordLength"],
    [{ name: "Asha", email: "a@b.in", password: "x".repeat(129) }, "passwordLength"],
  ])("sign-up rejects %o with %s", (input, key) => {
    expect(firstMessage(signUpSchema.safeParse(input))).toBe(key);
  });

  it("accepts any non-empty password at sign-in", () => {
    expect(passwordSignInSchema.safeParse({ email: "a@b.in", password: "short" }).success).toBe(
      true,
    );
  });

  it.each(["12345", "1234567", "12a456", ""])("rejects code %j", (otp) => {
    expect(firstMessage(codeSignInSchema.safeParse({ email: "a@b.in", otp }))).toBe("codeFormat");
  });

  it("has an English message for every validation key", () => {
    for (const key of VALIDATION_KEYS) {
      expect(en.auth.validation[key]).toBeTruthy();
      expect(isValidationKey(key)).toBe(true);
    }
    expect(isValidationKey("nope")).toBe(false);
    expect(isValidationKey(undefined)).toBe(false);
  });
});
