import { describe, expect, it } from "vitest";

import { authRoles } from "@/server/auth/access";

describe("Better Auth roles (derived from permissions.ts)", () => {
  it.each([
    ["OWNER", true],
    ["ACCOUNTANT", false],
    ["STAFF", false],
  ] as const)("%s may invite and manage members: %s", (role, allowed) => {
    const ac = authRoles[role];
    expect(ac.authorize({ invitation: ["create", "cancel"] }).success).toBe(allowed);
    expect(ac.authorize({ member: ["create", "update", "delete"] }).success).toBe(allowed);
  });

  it("gives no role organization update or delete (business.service owns those)", () => {
    for (const ac of Object.values(authRoles)) {
      expect(ac.authorize({ organization: ["update"] }).success).toBe(false);
      expect(ac.authorize({ organization: ["delete"] }).success).toBe(false);
    }
  });
});
