import { createAccessControl } from "better-auth/plugins/access";

import { ROLES, type Role } from "@/server/authz/context";
import { can } from "@/server/authz/permissions";

/**
 * Better Auth's organization roles, derived from permissions.ts so the SPEC §2.1 matrix
 * stays the only source of truth. Better Auth only guards its own endpoints (invites,
 * member roles); every Galla service still calls `assertCan`.
 *
 * Nobody gets `organization:update` or `organization:delete`: businesses are changed only
 * through business.service, which validates GST details and writes the audit log.
 */
const statements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

export const accessControl = createAccessControl(statements);

function roleFor(role: Role) {
  if (!can({ role }, "business:manage")) return accessControl.newRole({});
  return accessControl.newRole({
    member: ["create", "update", "delete"],
    invitation: ["create", "cancel"],
  });
}

export const authRoles = Object.fromEntries(ROLES.map((role) => [role, roleFor(role)])) as Record<
  Role,
  ReturnType<typeof roleFor>
>;
