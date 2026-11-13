import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { BETTER_AUTH_SECRET: "unit-test-secret-unit-test-secret-1234" },
}));

import { demoAuthBlock } from "@/server/auth/demo-guard";
import { DEMO_USERS, demoPassword, demoUser, isDemoEmail } from "@/server/demo/users";

describe("demo users", () => {
  it("are an owner and a staff member on a domain that can't receive mail", () => {
    expect(DEMO_USERS.map((user) => user.role)).toEqual(["OWNER", "STAFF"]);
    for (const user of DEMO_USERS) expect(user.email.endsWith("@galla.invalid")).toBe(true);
    expect(demoUser("STAFF").email).toBe("demo-staff@galla.invalid");
  });

  it("tells demo emails apart, whatever the case or spacing", () => {
    expect(isDemoEmail("demo-owner@galla.invalid")).toBe(true);
    expect(isDemoEmail(" Demo-Owner@GALLA.invalid ")).toBe(true);
    expect(isDemoEmail("owner@galla.in")).toBe(false);
    expect(isDemoEmail("galla.invalid@example.com")).toBe(false);
    expect(isDemoEmail(undefined)).toBe(false);
    expect(isDemoEmail(42)).toBe(false);
  });

  it("derives each user's password from the auth secret: stable, different per role, long", () => {
    expect(demoPassword("OWNER")).toBe(demoPassword("OWNER"));
    expect(demoPassword("OWNER")).not.toBe(demoPassword("STAFF"));
    expect(demoPassword("OWNER").length).toBeGreaterThanOrEqual(40);
  });
});

describe("demoAuthBlock", () => {
  const call = (input: Partial<Parameters<typeof demoAuthBlock>[0]>) =>
    demoAuthBlock({
      path: "/get-session",
      bodyEmail: undefined,
      sessionEmail: null,
      fromBrowser: true,
      ...input,
    });
  const DEMO = "demo-owner@galla.invalid";

  it("refuses account changes for a signed-in demo visitor", () => {
    for (const path of [
      "/change-password",
      "/change-email",
      "/update-user",
      "/delete-user",
      "/revoke-sessions",
      "/revoke-other-sessions",
    ]) {
      expect(call({ path, sessionEmail: DEMO }), path).toBe("demoAccountLocked");
      expect(call({ path, sessionEmail: "asha@example.com" }), path).toBeNull();
    }
  });

  it("refuses codes, resets and sign-ups that name a demo email", () => {
    for (const path of [
      "/email-otp/send-verification-otp",
      "/sign-in/email-otp",
      "/request-password-reset",
      "/forget-password/email-otp",
      "/sign-up/email",
    ]) {
      expect(call({ path, bodyEmail: DEMO }), path).toBe("demoAccountLocked");
      expect(call({ path, bodyEmail: "asha@example.com" }), path).toBeNull();
    }
  });

  it("lets only the server sign in with the demo password", () => {
    expect(call({ path: "/sign-in/email", bodyEmail: DEMO, fromBrowser: true })).toBe(
      "demoAccountLocked",
    );
    expect(call({ path: "/sign-in/email", bodyEmail: DEMO, fromBrowser: false })).toBeNull();
    expect(call({ path: "/sign-in/email", bodyEmail: "asha@example.com" })).toBeNull();
  });

  it("leaves everything else alone, demo or not", () => {
    expect(call({ path: "/get-session", sessionEmail: DEMO })).toBeNull();
    expect(call({ path: "/sign-out", sessionEmail: DEMO })).toBeNull();
  });
});
