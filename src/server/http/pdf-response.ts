import { type NextRequest } from "next/server";
import { type z } from "zod";

import { NotFoundError, toHttpStatus, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { pdfQuerySchema } from "@/lib/validation/pdf";
import { getSessionUser } from "@/server/auth/session";
import { type TenantContext } from "@/server/authz/context";
import { withRouteContext } from "@/server/http/route-context";
import { type PdfFormat } from "@/server/pdf/formats";
import { type RenderedPdf } from "@/server/pdf/invoice-pdf";
import { resolveTenant } from "@/server/services/tenant.service";

/** What a PDF route answers besides the PDF itself; never says whether a document exists. */
function plain(status: number): Response {
  return new Response(status === 404 ? "Not found" : "Something went wrong", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function parseQuery<Q>(request: NextRequest, schema: z.ZodType<Q>): Q | null {
  const query = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  return query.success ? query.data : null;
}

/**
 * Renders and answers with `application/pdf`. `download=1` saves the file; without it the
 * browser shows it, to print. NotFound, bad input and Forbidden all look like 404.
 */
async function pdfResponse(
  download: boolean,
  render: () => Promise<RenderedPdf>,
  logIds: Record<string, string>,
): Promise<Response> {
  try {
    const pdf = await render();
    const disposition = download ? "attachment" : "inline";
    return new Response(pdf.bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${pdf.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) return plain(404);
    const status = toHttpStatus(error);
    if (status >= 500) logger.error({ err: error, ...logIds }, "pdf.render_failed");
    return plain(status === 403 ? 404 : status);
  }
}

/**
 * The thin part of every signed-in PDF route (SPEC §7.2): session → membership of /b/{slug}
 * (404 otherwise, like every page there) → Zod-parsed `?format=&download=` → the service.
 */
export async function tenantPdfResponse(
  request: NextRequest,
  slug: string,
  render: (ctx: TenantContext, format: PdfFormat) => Promise<RenderedPdf>,
): Promise<Response> {
  return tenantQueryPdfResponse(request, slug, pdfQuerySchema, (ctx, query) =>
    render(ctx, query.format),
  );
}

/** The same, for a PDF route with its own query (the customer statement's `?period=`). */
export function tenantQueryPdfResponse<Q extends { download?: "1" | undefined }>(
  request: NextRequest,
  slug: string,
  schema: z.ZodType<Q>,
  render: (ctx: TenantContext, query: Q) => Promise<RenderedPdf>,
): Promise<Response> {
  return withRouteContext(request, () =>
    tenantQueryPdfResponseUnwrapped<Q>(request, slug, schema, render),
  );
}

async function tenantQueryPdfResponseUnwrapped<Q extends { download?: "1" | undefined }>(
  request: NextRequest,
  slug: string,
  schema: z.ZodType<Q>,
  render: (ctx: TenantContext, query: Q) => Promise<RenderedPdf>,
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.redirect(new URL("/login", request.url), 303);
  const tenant = /^[a-z0-9-]{1,50}$/.test(slug) ? await resolveTenant(user.id, slug) : null;
  if (!tenant) return plain(404);
  const query = parseQuery(request, schema);
  if (!query) return plain(404);
  return pdfResponse(query.download === "1", () => render(tenant.ctx, query), {
    businessId: tenant.ctx.businessId,
  });
}

/**
 * The public link's PDF (`/i/{token}/pdf`): no session; the proxy has already rate-limited the
 * request and checked the link is live, and the service checks the token again (ADR 0009).
 */
export function publicPdfResponse(
  request: NextRequest,
  render: (format: PdfFormat) => Promise<RenderedPdf>,
): Promise<Response> {
  return withRouteContext(request, () => publicPdfResponseUnwrapped(request, render));
}

async function publicPdfResponseUnwrapped(
  request: NextRequest,
  render: (format: PdfFormat) => Promise<RenderedPdf>,
): Promise<Response> {
  const query = parseQuery(request, pdfQuerySchema);
  if (!query) return plain(404);
  return pdfResponse(query.download === "1", () => render(query.format), {});
}
