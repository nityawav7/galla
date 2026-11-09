import { type NextRequest } from "next/server";

import { publicPdfResponse } from "@/server/http/pdf-response";
import { renderSharedInvoicePdf } from "@/server/services/public-invoice.service";

/** The shared invoice as a PDF, for the customer (SPEC F5): `?format=a4|80mm&download=1`. */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/i/[token]/pdf">,
): Promise<Response> {
  const { token } = await context.params;
  return publicPdfResponse(request, (format) => renderSharedInvoicePdf(token, format));
}
