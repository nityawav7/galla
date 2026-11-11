import { type NextRequest } from "next/server";

import { statementQuerySchema } from "@/lib/validation/pdf";
import { tenantQueryPdfResponse } from "@/server/http/pdf-response";
import { renderStatementPdf } from "@/server/services/pdf.service";

/** The customer's statement as a PDF: `?period=fy|lastFy|all`, `&download=1` to save it (SPEC F7). */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/b/[businessSlug]/customers/[customerId]/statement">,
): Promise<Response> {
  const { businessSlug, customerId } = await context.params;
  return tenantQueryPdfResponse(request, businessSlug, statementQuerySchema, (ctx, query) =>
    renderStatementPdf(ctx, customerId, { period: query.period }),
  );
}
