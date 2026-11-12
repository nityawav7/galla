import { type NextRequest } from "next/server";

import { gstr1QuerySchema } from "@/lib/validation/reports";
import { tenantDownloadResponse } from "@/server/http/download-response";
import { gstr1File } from "@/server/services/gstr1.service";

/** The GSTR-1 helper workbook: `?period=2026-11` or `?period=26-27-Q3` (SPEC §4.10). */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/b/[businessSlug]/reports/gstr1">,
): Promise<Response> {
  const { businessSlug } = await context.params;
  return tenantDownloadResponse(request, businessSlug, gstr1QuerySchema, gstr1File);
}
