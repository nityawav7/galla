import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

import { getAuth } from "@/server/auth/auth";
import {
  defaultGateDependencies,
  publicInvoiceGate,
  publicInvoiceToken,
} from "@/server/http/public-invoice-gate";
import { resolveTenant } from "@/server/services/tenant.service";

/** A path that matches no route, so rewriting to it renders the 404 page with status 404. */
const NOT_FOUND_PATH = "/_not-found-for-you";

/** "/b/sharma-hardware/settings" → "sharma-hardware". */
function tenantSlug(pathname: string): string | undefined {
  return /^\/b\/([^/]+)/.exec(pathname)?.[1];
}

/**
 * Runs before app pages render:
 * - /i/{token}: the public invoice link, no sign-in; rate-limited and 404 for a dead link
 *   (ADR 0009);
 * - no session cookie → /login;
 * - /b/{slug}/… for a business the user is not a member of → HTTP 404 (SPEC F1). Pages stream,
 *   so once rendering starts a notFound() can no longer change the status code.
 * Layouts and server actions check the session and membership again themselves.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const token = publicInvoiceToken(request.nextUrl.pathname);
  if (token !== undefined) {
    return publicInvoiceGate(request, token, defaultGateDependencies(NOT_FOUND_PATH));
  }

  const login = NextResponse.redirect(new URL("/login", request.url));
  if (!getSessionCookie(request)) return login;

  const slug = tenantSlug(request.nextUrl.pathname);
  if (!slug) return NextResponse.next();

  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) return login;
  // Real slugs are plain [a-z0-9-]; anything else cannot be a business the user belongs to.
  const member = /^[a-z0-9-]{1,50}$/.test(slug) && (await resolveTenant(session.user.id, slug));
  if (member) return NextResponse.next();
  return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
}

export const config = {
  matcher: ["/b", "/b/:path*", "/onboarding", "/i/:path*"],
};
