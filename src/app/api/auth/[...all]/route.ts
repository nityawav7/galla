import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/server/auth/auth";
import { isBlockedAuthPath } from "@/server/auth/blocked-paths";
import { limitAuthRequest } from "@/server/auth/rate-limit";

// Better Auth serves /api/auth/*. Organization endpoints are blocked; sensitive POSTs are
// rate-limited first.

const notFound = () => new Response("Not Found", { status: 404 });

export async function GET(request: Request): Promise<Response> {
  if (isBlockedAuthPath(new URL(request.url).pathname)) return notFound();
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  if (isBlockedAuthPath(new URL(request.url).pathname)) return notFound();
  const limited = await limitAuthRequest(request);
  if (limited) return limited;
  return toNextJsHandler(getAuth()).POST(request);
}
