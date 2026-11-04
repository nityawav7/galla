import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { ROLES, type Role, type TenantContext } from "@/server/authz/context";
import { type Action, ACTIONS, assertCan, can } from "@/server/authz/permissions";

/**
 * SPEC §2.1, copied by hand so a change to permissions.ts that the SPEC does not
 * also make fails here. ✅ = allowed.
 */
const SPEC_MATRIX: Record<Action, Record<Role, boolean>> = {
  "business:manage": { OWNER: true, ACCOUNTANT: false, STAFF: false },
  "catalog:write": { OWNER: true, ACCOUNTANT: false, STAFF: true },
  "invoice:issue": { OWNER: true, ACCOUNTANT: false, STAFF: true },
  "invoice:cancel": { OWNER: true, ACCOUNTANT: false, STAFF: false },
  "payment:record": { OWNER: true, ACCOUNTANT: true, STAFF: true },
  "records:view": { OWNER: true, ACCOUNTANT: true, STAFF: true },
  "dashboard:viewTotals": { OWNER: true, ACCOUNTANT: true, STAFF: false },
  "reports:export": { OWNER: true, ACCOUNTANT: true, STAFF: false },
  "audit:view": { OWNER: true, ACCOUNTANT: true, STAFF: false },
};

function contextFor(role: Role): TenantContext {
  return { userId: "user-1", businessId: "business-1", role };
}

const cells = ACTIONS.flatMap((action) =>
  ROLES.map((role) => [action, role, SPEC_MATRIX[action][role]] as const),
);

describe("permissions (SPEC §2.1)", () => {
  it("defines exactly the actions in the SPEC table", () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(SPEC_MATRIX).sort());
  });

  it.each(cells)("%s for %s → %s", (action, role, allowed) => {
    expect(can(contextFor(role), action)).toBe(allowed);
  });

  it.each(cells)("assertCan %s for %s throws only when not allowed", (action, role, allowed) => {
    const check = () => {
      assertCan(contextFor(role), action);
    };
    if (allowed) expect(check).not.toThrow();
    else expect(check).toThrow(ForbiddenError);
  });

  it("denies a role it does not know", () => {
    const stranger = { ...contextFor("OWNER"), role: "ADMIN" } as unknown as TenantContext;
    expect(ACTIONS.some((action) => can(stranger, action))).toBe(false);
  });
});
