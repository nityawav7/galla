import { env } from "@/lib/env";
import { getLimiter } from "@/lib/ratelimit";
import { relayAnalytics } from "@/server/http/analytics-relay";

/** posthog-js sends its four named events here (ADR 0016); thin: the relay does the work. */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/relay/[...path]">,
): Promise<Response> {
  const { path } = await params;
  return relayAnalytics(request, path, {
    host: env.NEXT_PUBLIC_POSTHOG_KEY ? env.NEXT_PUBLIC_POSTHOG_HOST : undefined,
    limiter: getLimiter("analytics"),
    fetch,
  });
}
