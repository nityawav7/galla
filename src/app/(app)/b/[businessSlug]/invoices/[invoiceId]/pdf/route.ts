import { type NextRequest } from "next/server";

import { tenantPdfResponse } from "@/server/http/pdf-response";
import { renderInvoicePdf } from "@/server/services/pdf.service";

/** The invoice as a PDF: `?format=a4|80mm`, `&download=1` to save it (SPEC F5). */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/b/[businessSlug]/invoices/[invoiceId]/pdf">,
): Promise<Response> {
  const { businessSlug, invoiceId } = await context.params;
  return tenantPdfResponse(request, businessSlug, (ctx, format) =>
    renderInvoicePdf(ctx, invoiceId, format),
  );
}
