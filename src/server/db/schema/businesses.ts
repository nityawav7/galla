import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, smallint, text } from "drizzle-orm/pg-core";

import { audited, id } from "./common";
import { states } from "./reference";

export const GST_SCHEMES = ["REGULAR", "COMPOSITION", "UNREGISTERED"] as const;
export const LOCALES = ["en", "hi"] as const;

/**
 * The tenant. Phase 4 maps Better Auth's organization model onto this table
 * (name → legal_name, logo → logo_url), so `slug`, `metadata` and `created_at` match it.
 */
export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    slug: text().notNull().unique(),
    legalName: text().notNull(),
    tradeName: text(),
    gstin: text(),
    gstScheme: text({ enum: GST_SCHEMES }).notNull(),
    stateCode: text()
      .notNull()
      .references(() => states.code, { onDelete: "restrict" }),
    addressLine1: text(),
    addressLine2: text(),
    city: text(),
    pincode: text(),
    phoneE164: text("phone_e164"),
    email: text(),
    logoUrl: text(),
    signatureUrl: text(),
    upiVpa: text(),
    bankAccountName: text(),
    bankAccountNumber: text(),
    bankIfsc: text(),
    bankName: text(),
    invoicePrefix: text().notNull().default("INV"),
    creditNotePrefix: text().notNull().default("CN"),
    terms: text(),
    hsnDigitsRequired: smallint().notNull().default(4),
    roundOffEnabled: boolean().notNull().default(true),
    locale: text({ enum: LOCALES }).notNull().default("en"),
    /** WhatsApp share messages (SPEC F6). Null means the built-in default for that language. */
    whatsappTemplateEn: text(),
    whatsappTemplateHi: text(),
    isDemo: boolean().notNull().default(false),
    /** Better Auth organization metadata (JSON string). */
    metadata: text(),
    ...audited(),
  },
  (t) => [
    check("businesses_slug_format", sql`${t.slug} ~ '^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$'`),
    check(
      "businesses_gst_scheme",
      sql`${t.gstScheme} in ('REGULAR', 'COMPOSITION', 'UNREGISTERED')`,
    ),
    // Registered (regular or composition) businesses have a GSTIN; unregistered ones do not.
    check(
      "businesses_gstin_matches_scheme",
      sql`(${t.gstScheme} = 'UNREGISTERED') = (${t.gstin} is null)`,
    ),
    check(
      "businesses_gstin_format",
      sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check("businesses_gstin_state", sql`left(${t.gstin}, 2) = ${t.stateCode}`),
    check("businesses_pincode_format", sql`${t.pincode} ~ '^[1-9][0-9]{5}$'`),
    check("businesses_phone_format", sql`${t.phoneE164} ~ '^[+][1-9][0-9]{7,14}$'`),
    check("businesses_invoice_prefix_format", sql`${t.invoicePrefix} ~ '^[A-Za-z0-9-]{1,5}$'`),
    check(
      "businesses_credit_note_prefix_format",
      sql`${t.creditNotePrefix} ~ '^[A-Za-z0-9-]{1,5}$'`,
    ),
    check(
      "businesses_prefixes_differ",
      sql`lower(${t.invoicePrefix}) <> lower(${t.creditNotePrefix})`,
    ),
    // Same rules as src/server/domain/upi.ts; values are stored lower-cased.
    check(
      "businesses_upi_vpa_format",
      sql`${t.upiVpa} ~ '^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9]{1,63}$'`,
    ),
    check(
      "businesses_email_format",
      sql`${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`,
    ),
    check("businesses_hsn_digits", sql`${t.hsnDigitsRequired} in (4, 6)`),
    check("businesses_locale", sql`${t.locale} in ('en', 'hi')`),
    check(
      "businesses_whatsapp_template_length",
      sql`coalesce(length(${t.whatsappTemplateEn}), 0) <= 1000 and coalesce(length(${t.whatsappTemplateHi}), 0) <= 1000`,
    ),
    index("businesses_state_code_idx").on(t.stateCode),
  ],
);
