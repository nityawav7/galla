import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { emailOTP } from "better-auth/plugins/email-otp";
import { organization } from "better-auth/plugins/organization";

import { APP_NAME } from "@/lib/config";
import { env } from "@/lib/env";
import { ROLES } from "@/server/authz/context";
import { authDatabase } from "@/server/db/auth-adapter";
import { newId } from "@/server/db/ids";
import { sendEmail } from "@/server/notifications/email";

import { accessControl, authRoles } from "./access";
import { inviteEmail, otpEmail } from "./emails";

const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

const https = (host: string | undefined) => (host ? `https://${host}` : undefined);

/** BETTER_AUTH_URL if set; on Vercel the production domain or this deployment's URL. */
export function authBaseUrl(): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return https(env.VERCEL_URL) ?? "http://localhost:3000";
}

/** A deployment answers on its own URL, its branch URL and (in production) the main domain. */
function trustedOrigins(): string[] {
  const origins = [
    authBaseUrl(),
    https(env.VERCEL_URL),
    https(env.VERCEL_BRANCH_URL),
    https(env.VERCEL_PROJECT_PRODUCTION_URL),
  ];
  return [...new Set(origins.filter((origin) => origin !== undefined))];
}

export function isGoogleEnabled(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

function googleProvider() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return {};
  return {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
  };
}

function createAuth() {
  return betterAuth({
    appName: APP_NAME,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: authBaseUrl(),
    trustedOrigins: trustedOrigins(),
    database: authDatabase(),
    telemetry: { enabled: false },
    // Our own limiter wraps the route (src/app/api/auth/[...all]/route.ts). Better Auth's
    // keeps counts in memory, which serverless instances do not share.
    rateLimit: { enabled: false },
    advanced: {
      database: { generateId: () => newId() },
      ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      autoSignIn: true,
      // ADR 0004: verification is needed to accept an invite, not to start billing.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
    },
    socialProviders: googleProvider(),
    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 3,
        storeOTP: "hashed",
        // Codes sign in existing accounts; new accounts sign up with a name and password.
        disableSignUp: true,
        overrideDefaultEmailVerification: true,
        async sendVerificationOTP({ email, otp, type }) {
          await sendEmail(otpEmail(email, otp, type));
        },
      }),
      organization({
        ac: accessControl,
        roles: authRoles,
        creatorRole: "OWNER",
        // business.service creates businesses (GST validation, audit log), never this API.
        allowUserToCreateOrganization: false,
        disableOrganizationDeletion: true,
        invitationExpiresIn: SEVEN_DAYS_SECONDS,
        cancelPendingInvitationsOnReInvite: true,
        requireEmailVerificationOnInvitation: true,
        async sendInvitationEmail({ id, email, role, organization, inviter }) {
          const knownRole = ROLES.find((known) => known === role);
          if (!knownRole) throw new Error("invitation has an unknown role");
          await sendEmail(
            inviteEmail(email, {
              inviterName: inviter.user.name,
              businessName: organization.name,
              role: knownRole,
              link: `${authBaseUrl()}/invite/${id}`,
            }),
          );
        },
        teams: { enabled: false },
        schema: {
          session: { fields: { activeOrganizationId: "activeBusinessId" } },
          organization: {
            fields: { name: "legalName", logo: "logoUrl" },
            // Required business columns. Better Auth never creates businesses, so it only
            // needs to know they exist; `input: false` keeps them out of its endpoints.
            additionalFields: {
              gstScheme: { type: "string", required: true, input: false },
              stateCode: { type: "string", required: true, input: false },
            },
          },
          member: { fields: { organizationId: "businessId" } },
          invitation: { fields: { organizationId: "businessId" } },
        },
      }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as typeof globalThis & { gallaAuth?: Auth };

/** Created on first use, so importing this module never connects to the database. */
export function getAuth(): Auth {
  globalForAuth.gallaAuth ??= createAuth();
  return globalForAuth.gallaAuth;
}
