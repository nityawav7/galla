import { withRequestContext } from "@/lib/request-context";

import { requestIdFrom } from "./security-headers";

/**
 * Runs a route handler with its request id on every log line (SPEC §6.4): the proxy's
 * `x-request-id` for pages and downloads, or Vercel's own id for API routes the proxy skips.
 */
export function withRouteContext<T>(request: Request, work: () => Promise<T>): Promise<T> {
  const requestId = request.headers.get("x-request-id") ?? requestIdFrom(request.headers);
  return withRequestContext({ requestId }, work);
}
