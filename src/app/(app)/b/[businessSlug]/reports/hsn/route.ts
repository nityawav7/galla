import { type NextRequest } from "next/server";

import { hsnQuerySchema } from "@/lib/validation/reports";
import { tenantDownloadResponse } from "@/server/http/download-response";
import { hsnFile } from "@/server/services/report.service";

/** The HSN summary as CSV: `?preset=` or `?from=&to=` (SPEC F8). */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/b/[businessSlug]/reports/hsn">,
): Promise<Response> {
  const { businessSlug } = await context.params;
  return tenantDownloadResponse(request, businessSlug, hsnQuerySchema, hsnFile);
}
