import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client for sign-in only. Same origin, so no base URL is needed.
 * Organization endpoints are blocked over HTTP; members are managed through server actions.
 */
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
