import { type NextRequest } from "next/server";

import { salesRegisterQuerySchema } from "@/lib/validation/reports";
import { tenantDownloadResponse } from "@/server/http/download-response";
import { salesRegisterFile } from "@/server/services/report.service";

/** The sales register: `?preset=` or `?from=&to=`, `&format=csv|xlsx` (SPEC F8). */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/b/[businessSlug]/reports/sales-register">,
): Promise<Response> {
  const { businessSlug } = await context.params;
  return tenantDownloadResponse(request, businessSlug, salesRegisterQuerySchema, salesRegisterFile);
}
