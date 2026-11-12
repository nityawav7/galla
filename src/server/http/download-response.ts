import { type NextRequest } from "next/server";
import { type z } from "zod";

import { NotFoundError, toHttpStatus, ValidationError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { getSessionUser } from "@/server/auth/session";
import { type TenantContext } from "@/server/authz/context";
import { withRouteContext } from "@/server/http/route-context";
import { type DownloadFile } from "@/server/reports/files";
import { resolveTenant } from "@/server/services/tenant.service";

/** What a download route answers besides the file; never says whether data exists. */
function plain(status: number): Response {
  return new Response(status === 404 ? "Not found" : "Something went wrong", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/**
 * The thin part of a signed-in report download (SPEC §7.2, like the PDF routes): session →
 * membership of /b/{slug} → Zod-parsed query → the service. Not a member, a bad query, a role
 * without `reports:export` and unknown data all look like 404. Always saved as a file.
 */
export function tenantDownloadResponse<Q>(
  request: NextRequest,
  slug: string,
  schema: z.ZodType<Q>,
  render: (ctx: TenantContext, query: Q) => Promise<DownloadFile>,
): Promise<Response> {
  return withRouteContext(request, () =>
    tenantDownloadResponseUnwrapped<Q>(request, slug, schema, render),
  );
}

async function tenantDownloadResponseUnwrapped<Q>(
  request: NextRequest,
  slug: string,
  schema: z.ZodType<Q>,
  render: (ctx: TenantContext, query: Q) => Promise<DownloadFile>,
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return Response.redirect(new URL("/login", request.url), 303);
  const tenant = /^[a-z0-9-]{1,50}$/.test(slug) ? await resolveTenant(user.id, slug) : null;
  if (!tenant) return plain(404);
  const query = schema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return plain(404);
  try {
    const file = await render(tenant.ctx, query.data);
    return new Response(file.bytes, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError) return plain(404);
    const status = toHttpStatus(error);
    if (status >= 500) {
      logger.error({ err: error, businessId: tenant.ctx.businessId }, "report.download_failed");
    }
    return plain(status === 403 ? 404 : status);
  }
}
