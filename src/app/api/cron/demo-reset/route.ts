import { env } from "@/lib/env";
import { checkCronAuth } from "@/server/http/cron-auth";
import { withRouteContext } from "@/server/http/route-context";
import { runDemoReset } from "@/server/jobs/demo-reset";

// Replaying six months of the demo shop takes about 35 s locally; Neon's free compute is slower.
// Vercel's free plan allows 300 s (ADR 0018).
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };

/** Vercel Cron, daily at 22:30 UTC = 04:00 IST (vercel.json). Thin: auth, then the job. */
export async function GET(request: Request): Promise<Response> {
  const auth = checkCronAuth(request.headers.get("authorization"), env.CRON_SECRET);
  if (auth === "notConfigured") {
    return Response.json({ code: "NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  if (auth === "unauthorized") {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
  }
  const summary = await withRouteContext(request, () => runDemoReset());
  return Response.json(summary, { headers: NO_STORE });
}
