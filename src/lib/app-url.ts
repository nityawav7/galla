import { env } from "@/lib/env";

const https = (host: string | undefined) => (host ? `https://${host}` : undefined);

/**
 * The app's public origin, for links that leave the app (sign-in emails, invoice links):
 * BETTER_AUTH_URL if set; on Vercel the production domain or this deployment's URL.
 */
export function appOrigin(): string {
  if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL;
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return https(env.VERCEL_URL) ?? "http://localhost:3000";
}

/** The public page of an invoice: `{origin}/i/{token}` (SPEC F5). */
export function publicInvoiceUrl(token: string): string {
  return `${appOrigin().replace(/\/$/, "")}/i/${token}`;
}
