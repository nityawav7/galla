import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { businesses } from "./businesses";
import { audited, id, paise } from "./common";
import { states, taxRates, units } from "./reference";

export const products = pgTable(
  "products",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    name: text().notNull(),
    hsnSac: text(),
    unit: text()
      .notNull()
      .references(() => units.uqcCode, { onDelete: "restrict" }),
    pricePaise: paise().notNull(),
    rateBp: integer()
      .notNull()
      .references(() => taxRates.rateBp, { onDelete: "restrict" }),
    priceIncludesTax: boolean().notNull().default(false),
    sku: text(),
    archivedAt: timestamp({ withTimezone: true }),
    ...audited(),
  },
  (t) => [
    // Target of the composite foreign keys that keep invoice lines inside one business.
    unique("products_business_id_id_unique").on(t.businessId, t.id),
    check("products_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("products_hsn_sac_format", sql`${t.hsnSac} ~ '^[0-9]{4,8}$'`),
    check("products_price_non_negative", sql`${t.pricePaise} >= 0`),
    uniqueIndex("products_business_id_sku_unique")
      .on(t.businessId, t.sku)
      .where(sql`${t.sku} is not null and ${t.archivedAt} is null`),
    index("products_business_id_created_at_idx").on(t.businessId, t.createdAt),
    // Keyset pagination of the list, A–Z (SPEC §6.1: no OFFSET).
    index("products_business_id_name_id_idx").on(t.businessId, t.name, t.id),
    index("products_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
    index("products_unit_idx").on(t.unit),
    index("products_rate_bp_idx").on(t.rateBp),
  ],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    businessId: uuid()
      .notNull()
      .references(() => businesses.id, { onDelete: "restrict" }),
    name: text().notNull(),
    phoneE164: text("phone_e164"),
    email: text(),
    gstin: text(),
    billingAddressLine1: text(),
    billingAddressLine2: text(),
    billingCity: text(),
    billingPincode: text(),
    billingStateCode: text().references(() => states.code, { onDelete: "restrict" }),
    shippingAddressLine1: text(),
    shippingAddressLine2: text(),
    shippingCity: text(),
    shippingPincode: text(),
    shippingStateCode: text().references(() => states.code, { onDelete: "restrict" }),
    /** Positive: the customer owes the shop. Negative: an advance held for them. */
    openingBalancePaise: paise()
      .notNull()
      .default(sql`0`),
    creditDays: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    ...audited(),
  },
  (t) => [
    unique("customers_business_id_id_unique").on(t.businessId, t.id),
    check("customers_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("customers_phone_format", sql`${t.phoneE164} ~ '^[+][1-9][0-9]{7,14}$'`),
    check(
      "customers_gstin_format",
      sql`${t.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`,
    ),
    check("customers_billing_pincode_format", sql`${t.billingPincode} ~ '^[1-9][0-9]{5}$'`),
    check("customers_shipping_pincode_format", sql`${t.shippingPincode} ~ '^[1-9][0-9]{5}$'`),
    check("customers_credit_days_range", sql`${t.creditDays} between 0 and 365`),
    // A GSTIN identifies one customer per shop. Phone numbers may repeat (families share them).
    uniqueIndex("customers_business_id_gstin_unique")
      .on(t.businessId, t.gstin)
      .where(sql`${t.gstin} is not null and ${t.archivedAt} is null`),
    index("customers_business_id_phone_idx").on(t.businessId, t.phoneE164),
    index("customers_business_id_created_at_idx").on(t.businessId, t.createdAt),
    index("customers_business_id_name_id_idx").on(t.businessId, t.name, t.id),
    index("customers_name_trgm_idx").using("gin", t.name.op("gin_trgm_ops")),
    index("customers_billing_state_code_idx").on(t.billingStateCode),
    index("customers_shipping_state_code_idx").on(t.shippingStateCode),
  ],
);
