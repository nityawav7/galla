import { randomInt } from "node:crypto";

import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { storedTemplate } from "@/lib/share-templates";
import { type BusinessInput, businessSchema } from "@/lib/validation/business";
import { type TenantContext } from "@/server/authz/context";
import { assertCan } from "@/server/authz/permissions";
import { getDb } from "@/server/db/client";
import { insertAuditLog } from "@/server/db/repos/audit.repo";
import {
  type Business,
  type BusinessPatch,
  getCurrentBusiness,
  insertBusiness,
  isSlugTaken,
  updateCurrentBusiness,
} from "@/server/db/repos/businesses.repo";
import { insertMember } from "@/server/db/repos/members.repo";
import { type Executor, withTransaction } from "@/server/db/transaction";
import { slugify, slugWithSuffix } from "@/server/domain/slug";

import { assertNotDemoUser, DEMO_READ_ONLY } from "./demo-guard";
import { parseInput } from "./validate";

/** Fields the settings form edits, which are also the ones the audit diff compares. */
const EDITABLE_FIELDS = [
  "legalName",
  "tradeName",
  "addressLine1",
  "addressLine2",
  "city",
  "pincode",
  "stateCode",
  "phoneE164",
  "email",
  "gstScheme",
  "gstin",
  "invoicePrefix",
  "creditNotePrefix",
  "upiVpa",
  "hsnDigitsRequired",
  "whatsappTemplateEn",
  "whatsappTemplateHi",
  "emailReminders",
  "ownerDigest",
] as const satisfies readonly (keyof Business)[];

type EditableField = (typeof EDITABLE_FIELDS)[number];

const SLUG_ATTEMPTS = 5;
const SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

function toColumns({ phone, ...input }: BusinessInput): Pick<Business, EditableField> {
  return {
    ...input,
    phoneE164: phone,
    // The default message, saved unchanged, is stored as "use the default" (SPEC F6).
    whatsappTemplateEn: storedTemplate(input.whatsappTemplateEn, "en"),
    whatsappTemplateHi: storedTemplate(input.whatsappTemplateHi, "hi"),
  };
}

function randomSuffix(): string {
  return Array.from({ length: 4 }, () => SUFFIX_CHARS.charAt(randomInt(SUFFIX_CHARS.length))).join(
    "",
  );
}

/** "sharma-hardware", or "sharma-hardware-x7k2" if that is taken. */
async function availableSlug(tx: Executor, name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? base : slugWithSuffix(base, randomSuffix());
    if (!(await isSlugTaken(tx, candidate))) return candidate;
  }
  throw new ConflictError("Could not pick a web address for this business. Please try again.");
}

function pickFields(business: Business): Pick<Business, EditableField> {
  return Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, business[field]])) as Pick<
    Business,
    EditableField
  >;
}

function changedFields(before: Business, after: Business) {
  const changed = EDITABLE_FIELDS.filter((field) => before[field] !== after[field]);
  return {
    before: Object.fromEntries(changed.map((field) => [field, before[field]])),
    after: Object.fromEntries(changed.map((field) => [field, after[field]])),
    changed,
  };
}

/**
 * Onboarding (SPEC F1): creates the business, makes the user its OWNER and records the audit
 * row, all in one transaction. Any signed-in user may create businesses.
 */
export async function createBusiness(
  userId: string,
  input: unknown,
): Promise<{ businessId: string; slug: string }> {
  const business = parseInput(businessSchema, input);
  await assertNotDemoUser(userId);
  return withTransaction(async (tx) => {
    const slug = await availableSlug(tx, business.tradeName ?? business.legalName);
    const row = await insertBusiness(tx, { ...toColumns(business), slug }, userId);
    const ctx: TenantContext = { userId, businessId: row.id, role: "OWNER" };
    await insertMember(tx, ctx, { userId, role: "OWNER" });
    await insertAuditLog(tx, ctx, {
      entity: "business",
      entityId: row.id,
      action: "business.created",
      diff: { after: { ...pickFields(row), slug } },
    });
    return { businessId: row.id, slug };
  });
}

async function currentBusinessOrThrow(db: Executor, ctx: TenantContext): Promise<Business> {
  const business = await getCurrentBusiness(db, ctx);
  if (!business) throw new NotFoundError("Business");
  return business;
}

/** The context's business, for any member (settings page, invoice header). */
export async function getBusiness(ctx: TenantContext): Promise<Business> {
  assertCan(ctx, "records:view");
  return currentBusinessOrThrow(getDb(), ctx);
}

/**
 * Settings (SPEC F10, owners only). Changes apply to future invoices only: issued invoices
 * keep their own snapshot. The slug (URL) never changes.
 */
export async function updateBusinessSettings(
  ctx: TenantContext,
  input: unknown,
): Promise<Business> {
  assertCan(ctx, "business:manage");
  const patch: BusinessPatch = toColumns(parseInput(businessSchema, input));
  return withTransaction(async (tx) => {
    const before = await currentBusinessOrThrow(tx, ctx);
    if (before.isDemo) throw new ForbiddenError(DEMO_READ_ONLY);
    const after = await updateCurrentBusiness(tx, ctx, patch);
    if (!after) throw new NotFoundError("Business");
    const diff = changedFields(before, after);
    if (diff.changed.length > 0) {
      await insertAuditLog(tx, ctx, {
        entity: "business",
        entityId: after.id,
        action: "business.updated",
        diff: { before: diff.before, after: diff.after },
      });
    }
    return after;
  });
}
