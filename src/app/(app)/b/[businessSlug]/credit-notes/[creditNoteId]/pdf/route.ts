import { type NextRequest } from "next/server";

import { tenantPdfResponse } from "@/server/http/pdf-response";
import { renderCreditNotePdf } from "@/server/services/pdf.service";

/** The credit note as a PDF: `?format=a4|80mm`, `&download=1` to save it (SPEC F5). */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/b/[businessSlug]/credit-notes/[creditNoteId]/pdf">,
): Promise<Response> {
  const { businessSlug, creditNoteId } = await context.params;
  return tenantPdfResponse(request, businessSlug, (ctx, format) =>
    renderCreditNotePdf(ctx, creditNoteId, format),
  );
}
