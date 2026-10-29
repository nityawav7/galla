import { connection } from "next/server";

import { checkHealth } from "@/server/services/health.service";

export async function GET(): Promise<Response> {
  // Always evaluate at request time; a health check must never be prerendered.
  await connection();
  const report = await checkHealth();
  return Response.json(report, {
    status: report.status === "ok" ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
