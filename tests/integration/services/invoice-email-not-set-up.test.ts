import { afterAll, describe, expect, it, vi } from "vitest";

import { ConflictError } from "@/lib/errors";
import { closeDb } from "@/server/db/client";
import type * as EmailModule from "@/server/notifications/email";
import { canEmailInvoice, emailInvoice } from "@/server/services/invoice-email.service";
import { createDraft, issueInvoice } from "@/server/services/invoice.service";

import { createTenant } from "../support/tenants";

// As on Vercel without RESEND_API_KEY: an email would be dropped.
vi.mock("@/server/notifications/email", async (importOriginal) => ({
  ...(await importOriginal<typeof EmailModule>()),
  canSendEmail: () => false,
}));

afterAll(async () => {
  await closeDb();
});

describe("emailInvoice without email set up", () => {
  it("is not offered and refuses, instead of saying sent for a dropped email", async () => {
    const tenant = await createTenant();
    const draft = await createDraft(tenant.ctx, {
      customerId: null,
      lines: [
        {
          productId: null,
          description: "PVC pipe",
          hsnSac: "3917",
          unit: "NOS",
          qty: "1",
          unitPrice: "100",
          discount: "",
          rateBp: 1800,
          priceIncludesTax: false,
        },
      ],
    });
    const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
    if (result.status !== "issued") throw new Error("not issued");
    expect(await canEmailInvoice(tenant.ctx, result.invoice.id)).toBe(false);
    await expect(emailInvoice(tenant.ctx, result.invoice.id)).rejects.toBeInstanceOf(ConflictError);
  });
});
