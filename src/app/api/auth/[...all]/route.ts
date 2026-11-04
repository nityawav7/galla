import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/server/auth/auth";
import { limitAuthRequest } from "@/server/auth/rate-limit";

// Better Auth serves every /api/auth/* endpoint. Sensitive POSTs are rate-limited first.

export async function GET(request: Request): Promise<Response> {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request): Promise<Response> {
  const limited = await limitAuthRequest(request);
  if (limited) return limited;
  return toNextJsHandler(getAuth()).POST(request);
}
