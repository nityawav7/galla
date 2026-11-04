import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Every environment variable the app reads, validated at boot.
 * Add new variables here AND in .env.example (CLAUDE.md rule 9).
 */
export const env = createEnv({
  shared: {
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  server: {
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    // Better Auth. Generate the secret with `openssl rand -base64 32`.
    BETTER_AUTH_SECRET: z.string().min(32),
    // Public origin of the app. Optional on Vercel, where VERCEL_URL is used instead.
    BETTER_AUTH_URL: z.url().optional(),
    // Google sign-in; the button is hidden unless both are set.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    // Resend. Without a key, emails are printed in dev and dropped elsewhere.
    RESEND_API_KEY: z.string().optional(),
    // Resend's shared sender only reaches the account owner until a domain is verified.
    EMAIL_FROM: z.string().default("Galla <onboarding@resend.dev>"),
    // Upstash Redis for rate limits: required in production, in-memory elsewhere. The Vercel
    // Upstash integration may name them KV_REST_API_URL / KV_REST_API_TOKEN instead.
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    KV_REST_API_URL: z.url().optional(),
    KV_REST_API_TOKEN: z.string().optional(),
    // Set automatically by Vercel.
    VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
    VERCEL_GIT_COMMIT_SHA: z.string().optional(),
    VERCEL_URL: z.string().optional(),
    VERCEL_BRANCH_URL: z.string().optional(),
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  },
  client: {},
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
  },
  // Lint and build jobs in CI have no real secrets.
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
  emptyStringAsUndefined: true,
});
