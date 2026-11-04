import { describe, expect, it } from "vitest";

import { isBlockedAuthPath } from "@/server/auth/blocked-paths";

describe("isBlockedAuthPath", () => {
  it.each([
    "/api/auth/organization/invite-member",
    "/api/auth/organization/accept-invitation",
    "/api/auth/organization/update-member-role",
    "/api/auth/organization/remove-member",
    "/api/auth/organization/delete",
    "/api/auth/organization/some-future-endpoint",
    "/api/auth/Organization/invite-member",
    "/api/auth//organization/invite-member",
    "/api/auth/organization",
    "/api/auth/%6Frganization/invite-member",
    "/api/auth/%E0%A4%A",
  ])("blocks %s", (path) => {
    expect(isBlockedAuthPath(path)).toBe(true);
  });

  it.each([
    "/api/auth/sign-in/email",
    "/api/auth/get-session",
    "/api/auth/email-otp/send-verification-otp",
    "/api/auth/organizations-are-not-a-thing",
  ])("allows %s", (path) => {
    expect(isBlockedAuthPath(path)).toBe(false);
  });
});
