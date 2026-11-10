import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { defaultShareTemplate } from "@/lib/share-templates";
import { type BusinessFormValues, EMPTY_BUSINESS_FORM } from "@/lib/validation/business";
import { EMPTY_CUSTOMER_FORM } from "@/lib/validation/customers";
import { type DraftLine } from "@/lib/validation/invoices";
import { type Role, type TenantContext } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import { getCurrentBusiness, updateCurrentBusiness } from "@/server/db/repos/businesses.repo";
import { renderShareTemplate, waMeLink } from "@/server/domain/share/whatsapp";
import { createBusiness, updateBusinessSettings } from "@/server/services/business.service";
import { createCreditNote } from "@/server/services/credit-note.service";
import { createCustomer } from "@/server/services/customer.service";
import {
  createDraft,
  getInvoice,
  type Invoice,
  issueInvoice,
} from "@/server/services/invoice.service";
import { getShareInfo } from "@/server/services/share.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";
import { createUser } from "../support/users";

afterAll(async () => {
  await closeDb();
});

const line = (overrides: Partial<DraftLine> = {}): Partial<DraftLine> => ({
  productId: null,
  description: "PVC pipe",
  hsnSac: "3917",
  unit: "NOS",
  qty: "3",
  unitPrice: "100",
  discount: "",
  rateBp: 1800,
  priceIncludesTax: false,
  ...overrides,
});

const as = (tenant: Tenant, role: Role) => ({ ...tenant.ctx, role });

/** ₹354.00 to a customer with a phone and 15 credit days, or to a walk-in. */
async function issued(tenant: Tenant, walkIn = false): Promise<Invoice> {
  const customer = walkIn
    ? null
    : await createCustomer(tenant.ctx, {
        ...EMPTY_CUSTOMER_FORM,
        name: "Ramesh Traders",
        phone: "98765 43210",
        creditDays: "15",
      });
  const draft = await createDraft(tenant.ctx, {
    customerId: customer?.status === "saved" ? customer.customer.id : null,
    lines: [line()],
  });
  const result = await issueInvoice(tenant.ctx, draft.id, { version: draft.version });
  if (result.status !== "issued") throw new Error("not issued");
  return result.invoice;
}

const shop = () => createTenant({ tradeName: "Sharma Hardware" });

describe("getShareInfo", () => {
  it("fills the default templates with the invoice's values (SPEC F6)", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    const share = await getShareInfo(tenant.ctx, invoice.id);
    expect(share.phone).toBe("919876543210");
    expect(share.defaultLocale).toBe("en");
    const { dueDate, ...values } = share.messages.en.values;
    expect(share.messages.en.template).toBe(defaultShareTemplate("en"));
    expect(values).toEqual({
      customer: "Ramesh Traders",
      shop: "Sharma Hardware",
      number: invoice.number,
      amount: "₹354.00",
    });
    // Issue date + the customer's 15 credit days, as DD-MM-YYYY.
    expect(dueDate).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(share.messages.hi.template).toBe(defaultShareTemplate("hi"));
    const text = renderShareTemplate(share.messages.en.template, {
      ...share.messages.en.values,
      link: "https://galla.test/i/x",
    });
    expect(new URL(waMeLink(share.phone, text)).searchParams.get("text")).toBe(text);
  });

  it("uses the business's own templates once saved", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant);
    await updateCurrentBusiness(getDb(), tenant.ctx, {
      whatsappTemplateEn: "Hi {customer}, pay {amount}: {link}",
      whatsappTemplateHi: "नमस्ते {customer}: {link}",
    });
    const share = await getShareInfo(tenant.ctx, invoice.id);
    expect(share.messages.en.template).toBe("Hi {customer}, pay {amount}: {link}");
    expect(share.messages.hi.template).toBe("नमस्ते {customer}: {link}");
  });

  it("asks for the balance, and falls back for a walk-in with no name, phone or due date", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant, true);
    const [first] = (await getInvoice(tenant.ctx, invoice.id)).lines;
    await createCreditNote(tenant.ctx, invoice.id, {
      reason: "Goods returned",
      lines: [{ invoiceLineId: first?.id ?? "", qty: "1" }],
    });
    const share = await getShareInfo(tenant.ctx, invoice.id);
    expect(share.phone).toBeNull();
    expect(share.messages.en.values).toMatchObject({
      customer: "Customer",
      amount: "₹236.00",
      dueDate: "on receipt",
    });
    expect(share.messages.hi.values).toMatchObject({ customer: "ग्राहक जी", dueDate: "तुरंत" });
  });

  it.each<Role>(["OWNER", "STAFF"])("lets %s share", async (role) => {
    const tenant = await shop();
    const invoice = await issued(tenant, true);
    await expect(getShareInfo(as(tenant, role), invoice.id)).resolves.toBeDefined();
  });

  it("refuses ACCOUNTANT, and has nothing to share for a draft", async () => {
    const tenant = await shop();
    const invoice = await issued(tenant, true);
    await expect(getShareInfo(as(tenant, "ACCOUNTANT"), invoice.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const draft = await createDraft(tenant.ctx, { lines: [line()] });
    await expect(getShareInfo(tenant.ctx, draft.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  itIsolatesTenants({
    getShareInfo: isolationCase({
      arrange: (owner) => issued(owner, true),
      act: (intruder, invoice) => getShareInfo(intruder.ctx, invoice.id),
    }),
  });
});

describe("WhatsApp templates in settings", () => {
  function formFor(overrides: Partial<BusinessFormValues> = {}): BusinessFormValues {
    return {
      ...EMPTY_BUSINESS_FORM,
      legalName: `Shop ${randomUUID().slice(0, 8)}`,
      addressLine1: "12 Station Road",
      city: "Pune",
      pincode: "411001",
      stateCode: "27",
      gstin: "27AAPFU0939F1ZV",
      ...overrides,
    };
  }

  async function owner(): Promise<TenantContext> {
    const user = await createUser();
    const { businessId } = await createBusiness(user.id, formFor());
    return { userId: user.id, businessId, role: "OWNER" };
  }

  it("saves edited templates and audits the change", async () => {
    const ctx = await owner();
    await updateBusinessSettings(
      ctx,
      formFor({
        whatsappTemplateEn: "Hi {customer}\r\nPay here: {link}",
        whatsappTemplateHi: "नमस्ते {customer}: {link}",
      }),
    );
    const business = await getCurrentBusiness(getDb(), ctx);
    expect(business?.whatsappTemplateEn).toBe("Hi {customer}\nPay here: {link}");
    expect(business?.whatsappTemplateHi).toBe("नमस्ते {customer}: {link}");
    const [latest] = await listAuditLogs(getDb(), ctx, { entity: "business" });
    expect(latest?.diff).toMatchObject({
      after: { whatsappTemplateEn: "Hi {customer}\nPay here: {link}" },
    });
  });

  it("stores the default, saved unchanged or emptied, as null", async () => {
    const ctx = await owner();
    await updateBusinessSettings(ctx, formFor({ whatsappTemplateEn: "Hi {link}" }));
    await updateBusinessSettings(
      ctx,
      formFor({ whatsappTemplateEn: defaultShareTemplate("en"), whatsappTemplateHi: "  " }),
    );
    const business = await getCurrentBusiness(getDb(), ctx);
    expect(business?.whatsappTemplateEn).toBeNull();
    expect(business?.whatsappTemplateHi).toBeNull();
  });

  it("refuses a template without the link or with an unknown placeholder", async () => {
    const ctx = await owner();
    const error = await updateBusinessSettings(
      ctx,
      formFor({ whatsappTemplateEn: "Hi {customer}", whatsappTemplateHi: "{naam}: {link}" }),
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).issues).toEqual([
      { path: "whatsappTemplateEn", message: "templateNeedsLink" },
      { path: "whatsappTemplateHi", message: "templateUnknownPlaceholder" },
    ]);
  });
});
