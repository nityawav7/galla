/**
 * How an audit row reads on the Activity page (SPEC F11, Phase 11b). Pure: the service looks up
 * the names and numbers it points at, the page turns the result into words.
 *
 * Only fields listed in `AUDIT_FIELDS` are ever shown, so ids, hashes and anything added to an
 * audit diff later stay hidden until someone decides how it should read.
 */

import { findState } from "../states";

export const AUDIT_CATEGORIES = [
  "invoices",
  "payments",
  "customers",
  "products",
  "settings",
  "members",
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

/** What a row is about; the service turns it into a name or number and a link. */
export type AuditSubjectKind =
  "invoice" | "creditNote" | "customer" | "product" | "payment" | "refund" | "member" | "user";

export type AuditSubjectRef =
  { kind: AuditSubjectKind; id: string; label?: string } | { kind: "text"; text: string };

interface ActionSpec {
  category: AuditCategory;
  /** Where the subject comes from: the row's entity id, a field of the diff, or nothing. */
  subject: AuditSubjectKind | "email" | "removedUser" | null;
}

const ACTIONS = {
  "invoice.draftCreated": { category: "invoices", subject: "invoice" },
  "invoice.draftDeleted": { category: "invoices", subject: null },
  "invoice.issued": { category: "invoices", subject: "invoice" },
  "invoice.cancelled": { category: "invoices", subject: "invoice" },
  "invoice.emailed": { category: "invoices", subject: "invoice" },
  "invoice.linkRevoked": { category: "invoices", subject: "invoice" },
  "invoice.linkRegenerated": { category: "invoices", subject: "invoice" },
  "creditNote.issued": { category: "invoices", subject: "creditNote" },
  "payment.recorded": { category: "payments", subject: "payment" },
  "payment.voided": { category: "payments", subject: "payment" },
  "payment.applied": { category: "payments", subject: "customer" },
  "refund.recorded": { category: "payments", subject: "refund" },
  "refund.voided": { category: "payments", subject: "refund" },
  "customer.created": { category: "customers", subject: "customer" },
  "customer.updated": { category: "customers", subject: "customer" },
  "customer.archived": { category: "customers", subject: "customer" },
  "customer.restored": { category: "customers", subject: "customer" },
  "customer.reminderShared": { category: "customers", subject: "customer" },
  "product.created": { category: "products", subject: "product" },
  "product.updated": { category: "products", subject: "product" },
  "product.archived": { category: "products", subject: "product" },
  "product.restored": { category: "products", subject: "product" },
  "business.created": { category: "settings", subject: null },
  "business.updated": { category: "settings", subject: null },
  "invitation.created": { category: "members", subject: "email" },
  "invitation.cancelled": { category: "members", subject: "email" },
  "invitation.declined": { category: "members", subject: null },
  "member.joined": { category: "members", subject: null },
  "member.role_changed": { category: "members", subject: "member" },
  "member.removed": { category: "members", subject: "removedUser" },
} as const satisfies Record<string, ActionSpec>;

export type AuditAction = keyof typeof ACTIONS;
export const AUDIT_ACTIONS = Object.keys(ACTIONS) as AuditAction[];

export function isAuditAction(action: string): action is AuditAction {
  return Object.hasOwn(ACTIONS, action);
}

/** The actions a filter category covers (by action, not entity: "payment.applied" is a payment). */
export function actionsInCategory(category: AuditCategory): AuditAction[] {
  return AUDIT_ACTIONS.filter((action) => ACTIONS[action].category === category);
}

const ENUM_VALUES = {
  mode: ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "CARD", "OTHER"],
  role: ["OWNER", "ACCOUNTANT", "STAFF"],
  status: ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "CANCELLED"],
  gstScheme: ["REGULAR", "COMPOSITION", "UNREGISTERED"],
  type: ["TAX_INVOICE", "BILL_OF_SUPPLY", "INVOICE"],
  locale: ["en", "hi"],
  source: ["csv"],
} as const;
type EnumField = keyof typeof ENUM_VALUES;

type FieldFormat = "text" | "money" | "rate" | "date" | "state" | "bool" | "count" | EnumField;

/** Every field the page may show, and how. Anything else in a diff is never shown. */
const FIELDS = {
  // customers
  name: "text",
  phoneE164: "text",
  email: "text",
  gstin: "text",
  billingAddressLine1: "text",
  billingAddressLine2: "text",
  billingCity: "text",
  billingPincode: "text",
  billingStateCode: "state",
  shippingAddressLine1: "text",
  shippingAddressLine2: "text",
  shippingCity: "text",
  shippingPincode: "text",
  shippingStateCode: "state",
  openingBalancePaise: "money",
  creditDays: "count",
  stateOverride: "bool",
  source: "source",
  // products
  hsnSac: "text",
  unit: "text",
  pricePaise: "money",
  rateBp: "rate",
  priceIncludesTax: "bool",
  sku: "text",
  // business settings
  legalName: "text",
  tradeName: "text",
  addressLine1: "text",
  addressLine2: "text",
  city: "text",
  pincode: "text",
  stateCode: "state",
  gstScheme: "gstScheme",
  invoicePrefix: "text",
  creditNotePrefix: "text",
  upiVpa: "text",
  hsnDigitsRequired: "count",
  whatsappTemplateEn: "text",
  whatsappTemplateHi: "text",
  emailReminders: "bool",
  ownerDigest: "bool",
  // invoices and credit notes
  number: "text",
  type: "type",
  invoiceDate: "date",
  placeOfSupplyStateCode: "state",
  lineCount: "count",
  taxablePaise: "money",
  taxPaise: "money",
  roundOffPaise: "money",
  grandTotalPaise: "money",
  status: "status",
  reason: "text",
  linkOn: "bool",
  locale: "locale",
  invoiceNumber: "text",
  completesInvoice: "bool",
  releasedPaise: "money",
  // payments, refunds, reminders
  paymentDate: "date",
  refundDate: "date",
  amountPaise: "money",
  mode: "mode",
  onAccountPaise: "money",
  balancePaise: "money",
  overduePaise: "money",
  voided: "bool",
  // members
  role: "role",
} as const satisfies Record<string, FieldFormat>;

export type AuditField = keyof typeof FIELDS;
export const AUDIT_FIELDS = Object.keys(FIELDS) as AuditField[];
const FIELD_ORDER: readonly AuditField[] = AUDIT_FIELDS;

function isAuditField(field: string): field is AuditField {
  return Object.hasOwn(FIELDS, field);
}

export type AuditValue =
  | { kind: "empty" }
  | { kind: "text"; text: string }
  | { kind: "money"; paise: bigint }
  | { kind: "rate"; bp: number }
  | { kind: "date"; date: string }
  | { kind: "bool"; value: boolean }
  | { kind: "count"; value: number }
  | AuditEnumValue;

/** A known value of one of the enum fields, typed per group so the page can name it. */
export type AuditEnumValue = {
  [G in EnumField]: { kind: "enum"; group: G; value: (typeof ENUM_VALUES)[G][number] };
}[EnumField];

export interface AuditChange {
  field: AuditField;
  before: AuditValue;
  after: AuditValue;
}

export interface AuditDetail {
  field: AuditField;
  value: AuditValue;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const INTEGER = /^-?\d+$/;

function textOf(raw: unknown): AuditValue {
  if (typeof raw === "string") return { kind: "text", text: raw };
  if (typeof raw === "number" || typeof raw === "boolean") return { kind: "text", text: `${raw}` };
  return { kind: "empty" };
}

/** One stored value as the page shows it; something unexpected falls back to plain text. */
export function auditValue(field: AuditField, raw: unknown): AuditValue {
  if (raw === null || raw === undefined || raw === "") return { kind: "empty" };
  const format: FieldFormat = FIELDS[field];
  switch (format) {
    case "money":
      if (typeof raw === "string" && INTEGER.test(raw))
        return { kind: "money", paise: BigInt(raw) };
      if (typeof raw === "number" && Number.isSafeInteger(raw)) {
        return { kind: "money", paise: BigInt(raw) };
      }
      return textOf(raw);
    case "rate":
      return typeof raw === "number" && Number.isInteger(raw)
        ? { kind: "rate", bp: raw }
        : textOf(raw);
    case "count":
      return typeof raw === "number" ? { kind: "count", value: raw } : textOf(raw);
    case "bool":
      return typeof raw === "boolean" ? { kind: "bool", value: raw } : textOf(raw);
    case "date":
      return typeof raw === "string" && ISO_DATE.test(raw)
        ? { kind: "date", date: raw }
        : textOf(raw);
    case "state": {
      const state = typeof raw === "string" ? findState(raw) : undefined;
      return state ? { kind: "text", text: state.name } : textOf(raw);
    }
    case "text":
      return textOf(raw);
    default: {
      const known: readonly string[] = ENUM_VALUES[format];
      // `raw` is one of ENUM_VALUES[format], which is what AuditEnumValue says.
      return typeof raw === "string" && known.includes(raw)
        ? ({ kind: "enum", group: format, value: raw } as AuditEnumValue)
        : textOf(raw);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface AuditRowInput {
  action: string;
  entityId: string;
  diff: unknown;
}

export interface AuditDescription {
  /** Null for an action this version doesn't know (shown as "Other change"). */
  action: AuditAction | null;
  category: AuditCategory | null;
  subject: AuditSubjectRef | null;
  /** Fields that went from one value to another (edits). */
  changes: AuditChange[];
  /** Values recorded with the action (what was created, the amount, the reason). */
  details: AuditDetail[];
}

function subjectOf(spec: ActionSpec, row: AuditRowInput, diff: Record<string, unknown>) {
  const before = isRecord(diff.before) ? diff.before : {};
  const after = isRecord(diff.after) ? diff.after : {};
  switch (spec.subject) {
    case null:
      return null;
    case "email": {
      const email = after.email ?? before.email;
      return typeof email === "string" && email ? { kind: "text" as const, text: email } : null;
    }
    case "removedUser":
      return typeof before.userId === "string"
        ? { kind: "user" as const, id: before.userId }
        : null;
    default: {
      // An issued invoice's or credit note's number is in the row itself; others are looked up.
      const number = after.number;
      return typeof number === "string" && number
        ? { kind: spec.subject, id: row.entityId, label: number }
        : { kind: spec.subject, id: row.entityId };
    }
  }
}

function fieldsOf(record: unknown): Map<AuditField, unknown> {
  const fields = new Map<AuditField, unknown>();
  if (!isRecord(record)) return fields;
  for (const [key, value] of Object.entries(record)) {
    if (isAuditField(key)) fields.set(key, value);
  }
  return fields;
}

/** The fields of a diff as edits (in both before and after) and recorded values (the rest). */
function describeDiff(rawDiff: unknown, subjectField: AuditField | null) {
  const diff = isRecord(rawDiff) ? rawDiff : {};
  const before = fieldsOf(diff.before);
  const after = fieldsOf(diff.after);
  const flags = fieldsOf(diff);
  const changes: AuditChange[] = [];
  const details: AuditDetail[] = [];

  for (const [field, raw] of after) {
    if (before.has(field)) {
      changes.push({
        field,
        before: auditValue(field, before.get(field)),
        after: auditValue(field, raw),
      });
      continue;
    }
    if (field === subjectField) continue;
    const value = auditValue(field, raw);
    if (value.kind !== "empty") details.push({ field, value });
  }
  // Only in "before": what was removed or cancelled (an invitation's role, a draft's total).
  for (const [field, raw] of before) {
    if (after.has(field) || field === subjectField) continue;
    const value = auditValue(field, raw);
    if (value.kind !== "empty") details.push({ field, value });
  }
  for (const [field, raw] of flags) {
    const value = auditValue(field, raw);
    if (value.kind !== "empty") details.push({ field, value });
  }
  // jsonb stores keys in its own order (shortest first), so show them in AUDIT_FIELDS order.
  const byField = (a: { field: AuditField }, b: { field: AuditField }) =>
    FIELD_ORDER.indexOf(a.field) - FIELD_ORDER.indexOf(b.field);
  return { changes: changes.toSorted(byField), details: details.toSorted(byField) };
}

const SUBJECT_FIELD: Record<NonNullable<ActionSpec["subject"]> | "none", AuditField | null> = {
  invoice: "number",
  creditNote: "number",
  customer: "name",
  product: "name",
  email: "email",
  payment: null,
  refund: null,
  member: null,
  user: null,
  removedUser: null,
  none: null,
};

export function describeAuditRow(row: AuditRowInput): AuditDescription {
  if (!isAuditAction(row.action)) {
    return { action: null, category: null, subject: null, ...describeDiff(row.diff, null) };
  }
  const spec: ActionSpec = ACTIONS[row.action];
  const diff = isRecord(row.diff) ? row.diff : {};
  // The subject's own number, name or email already names the row; don't repeat it below
  // (an edit of it still shows as a change).
  const subjectField = SUBJECT_FIELD[spec.subject ?? "none"];
  return {
    action: row.action,
    category: spec.category,
    subject: subjectOf(spec, row, diff),
    ...describeDiff(row.diff, subjectField),
  };
}
