import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/server/auth/auth";
import {
  defaultGateDependencies,
  publicInvoiceGate,
  publicInvoiceToken,
} from "@/server/http/public-invoice-gate";
import { contentSecurityPolicy, newNonce, requestIdFrom } from "@/server/http/security-headers";
import { resolveTenant } from "@/server/services/tenant.service";

/** A path that matches no route, so rewriting to it renders the 404 page with status 404. */
const NOT_FOUND_PATH = "/_not-found-for-you";

/** Paths that need a signed-in user (the rest, like /login and /invite, handle that themselves). */
const SIGNED_IN_PATH = /^\/(b(\/|$)|onboarding(\/|$))/;

/** "/b/sharma-hardware/settings" → "sharma-hardware". */
function tenantSlug(pathname: string): string | undefined {
  return /^\/b\/([^/]+)/.exec(pathname)?.[1];
}

/**
 * Who may see the page:
 * - /i/{token}: the public invoice link, no sign-in; rate-limited and 404 for a dead link
 *   (ADR 0009);
 * - /b/… and /onboarding without a session cookie → /login;
 * - /b/{slug}/… for a business the user is not a member of → HTTP 404 (SPEC F1). Pages stream,
 *   so once rendering starts a notFound() can no longer change the status code.
 * Layouts and server actions check the session and membership again themselves.
 */
async function route(request: NextRequest, headers: Headers): Promise<NextResponse> {
  const pass = () => NextResponse.next({ request: { headers } });
  const pathname = request.nextUrl.pathname;
  const token = publicInvoiceToken(pathname);
  if (token !== undefined) {
    return publicInvoiceGate(request, token, defaultGateDependencies(NOT_FOUND_PATH), headers);
  }
  if (!SIGNED_IN_PATH.test(pathname)) return pass();

  const login = NextResponse.redirect(new URL("/login", request.url));
  if (!getSessionCookie(request)) return login;

  const slug = tenantSlug(pathname);
  if (!slug) return pass();

  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return login;
  // Real slugs are plain [a-z0-9-]; anything else cannot be a business the user belongs to.
  const member = /^[a-z0-9-]{1,50}$/.test(slug) && (await resolveTenant(session.user.id, slug));
  if (member) return pass();
  return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url), { request: { headers } });
}

/**
 * Runs before every page: a fresh CSP nonce and a request id (SPEC §6.2, §6.4), passed to the
 * page in the request headers (Next.js reads the nonce from `Content-Security-Policy`) and sent
 * back in the response, then the access rules above.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Next's own trailing-slash redirect is off (next.config.ts) so the analytics relay can take
  // posthog-js's "/e/"; pages still lose a trailing slash here, as before.
  const { pathname } = request.nextUrl;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const url = new URL(request.url);
    url.pathname = pathname.replace(/\/+$/, "") || "/";
    return NextResponse.redirect(url, 308);
  }

  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV === "development" });
  const requestId = requestIdFrom(request.headers);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  headers.set("x-request-id", requestId);

  const response = await route(request, headers);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Request-Id", requestId);
  return response;
}

export const config = {
  // Pages and app routes; not API routes, build output, images or files with an extension.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.[a-z0-9]+$).*)"],
};
