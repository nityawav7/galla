import { env } from "@/lib/env";
import { checkCronAuth } from "@/server/http/cron-auth";
import { withRouteContext } from "@/server/http/route-context";
import { runDailyJob } from "@/server/jobs/daily";

// The job stops starting businesses at 45 s (DAILY_JOB_BUDGET_MS); Hobby allows 60.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

/** Vercel Cron, daily at 03:30 UTC = 09:00 IST (vercel.json). Thin: auth, then the job. */
export async function GET(request: Request): Promise<Response> {
  // Reading the request's headers makes this run at request time, never prerendered.
  const auth = checkCronAuth(request.headers.get("authorization"), env.CRON_SECRET);
  if (auth === "notConfigured") {
    return Response.json({ code: "NOT_CONFIGURED" }, { status: 503, headers: NO_STORE });
  }
  if (auth === "unauthorized") {
    return Response.json({ code: "UNAUTHORIZED" }, { status: 401, headers: NO_STORE });
  }
  const summary = await withRouteContext(request, () => runDailyJob(new Date()));
  return Response.json(summary, { headers: NO_STORE });
}
