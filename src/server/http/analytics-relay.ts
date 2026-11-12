import { clientIp, hashIp, type Limiter } from "@/lib/ratelimit";

/** posthog-js's capture endpoints. Anything else (flags, config, recordings) is refused. */
const CAPTURE_PATHS = /^(e|i\/v0\/e|batch|capture)\/?$/;

/** A batch of a few events is a few KB; anything near this is not from our page. */
export const RELAY_MAX_BYTES = 256 * 1024;

/** Only these request headers reach PostHog: no cookies, no IP, no user agent. */
const FORWARDED_HEADERS = ["content-type", "content-encoding"] as const;

export interface RelayDeps {
  /** PostHog's ingestion host, e.g. https://us.i.posthog.com; undefined when analytics is off. */
  host: string | undefined;
  limiter: Limiter;
  fetch: typeof fetch;
}

/**
 * Forwards an analytics event from our page to PostHog (ADR 0016). Same origin, so the CSP keeps
 * `connect-src 'self'`; and PostHog sees only the event body, never the visitor's cookies or IP
 * (it sees our server instead). Limited per visitor like the other public routes.
 */
export async function relayAnalytics(
  request: Request,
  path: readonly string[],
  deps: RelayDeps,
): Promise<Response> {
  const target = path.join("/");
  if (!deps.host || !CAPTURE_PATHS.test(target)) return new Response(null, { status: 404 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > RELAY_MAX_BYTES) return new Response(null, { status: 413 });

  const { success } = await deps.limiter.limit(`analytics:${hashIp(clientIp(request.headers))}`);
  if (!success) return new Response(null, { status: 429 });

  const body = await request.arrayBuffer();
  if (body.byteLength > RELAY_MAX_BYTES) return new Response(null, { status: 413 });

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const { search } = new URL(request.url);
  try {
    const upstream = await deps.fetch(`${deps.host}/${target}${search}`, {
      method: "POST",
      headers,
      body,
    });
    return new Response(null, { status: upstream.status });
  } catch {
    return new Response(null, { status: 502 });
  }
}
