import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Sends visitors without a session cookie to /login before rendering app pages. This only
 * checks that a cookie exists; pages and server actions verify the session itself
 * (requireUser) and the membership (requireTenant).
 */
export function proxy(request: NextRequest): NextResponse {
  if (getSessionCookie(request)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/b", "/b/:path*", "/onboarding/:path*"],
};
