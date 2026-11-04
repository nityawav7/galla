import { describe, expect, it } from "vitest";

import { otpEmail } from "@/server/auth/emails";

describe("otpEmail", () => {
  it.each([
    ["sign-in", "Your Galla sign-in code"],
    ["email-verification", "Verify your email for Galla"],
    ["change-email", "Verify your email for Galla"],
    ["forget-password", "Reset your Galla password"],
  ] as const)("%s has subject %j and contains the code", (purpose, subject) => {
    const email = otpEmail("asha@example.com", "123456", purpose);
    expect(email.subject).toBe(subject);
    expect(email.to).toBe("asha@example.com");
    expect(email.text).toContain("123456");
    expect(email.html).toContain("123456");
    expect(email.text).toContain("5 minutes");
  });

  it("keeps the address out of the body, so the dev log of the text holds no PII", () => {
    const email = otpEmail("asha@example.com", "123456", "sign-in");
    expect(email.text).not.toContain("asha@example.com");
    expect(email.html).not.toContain("asha@example.com");
  });
});
