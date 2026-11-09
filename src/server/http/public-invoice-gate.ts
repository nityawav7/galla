import { type NextRequest, NextResponse } from "next/server";

import { clientIp, getLimiter, hashIp, type Limiter } from "@/lib/ratelimit";
import { isLiveInvoiceLink } from "@/server/services/public-invoice.service";

/** `/i/{token}` and `/i/{token}/pdf` (SPEC F5). */
const PUBLIC_INVOICE_PATH = /^\/i\/([^/]+)(?:\/pdf)?\/?$/;

/**
 * Every answer under /i/ is private to the person holding the link: never indexed, never
 * cached by a shared cache, and the token never leaves in a Referer header (ADR 0009).
 */
export const PUBLIC_INVOICE_HEADERS: Readonly<Record<string, string>> = {
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "private, no-store",
};

export interface GateDependencies {
  limiter: Limiter;
  isLive: (token: string) => Promise<boolean>;
  /** Where a dead link is rewritten to, so the 404 page renders with status 404. */
  notFoundPath: string;
}

function withHeaders(response: NextResponse): NextResponse {
  for (const [name, value] of Object.entries(PUBLIC_INVOICE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

/** The token in an /i/ path, or undefined for any other path. */
export function publicInvoiceToken(pathname: string): string | undefined {
  return PUBLIC_INVOICE_PATH.exec(pathname)?.[1];
}

/**
 * Runs in the proxy before the public page or PDF: 60 requests a minute per IP (SPEC §6.2), then
 * 404 for a token that is unknown, malformed, revoked or a draft's. Pages stream, so this is the
 * last moment the status code can still be 404 or 429.
 */
export async function publicInvoiceGate(
  request: NextRequest,
  token: string,
  deps: GateDependencies,
): Promise<NextResponse> {
  const { success, reset } = await deps.limiter.limit(hashIp(clientIp(request.headers)));
  if (!success) {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return withHeaders(
      new NextResponse("Too many requests. Please wait a minute and try again.", {
        status: 429,
        headers: { "Retry-After": String(retryAfter), "Content-Type": "text/plain; charset=utf-8" },
      }),
    );
  }
  if (!(await deps.isLive(token))) {
    return withHeaders(NextResponse.rewrite(new URL(deps.notFoundPath, request.url)));
  }
  return withHeaders(NextResponse.next());
}

export function defaultGateDependencies(notFoundPath: string): GateDependencies {
  return { limiter: getLimiter("publicInvoice"), isLive: isLiveInvoiceLink, notFoundPath };
}
