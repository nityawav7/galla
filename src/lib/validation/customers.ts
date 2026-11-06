import { z } from "zod";

import { parseScaled } from "@/server/domain/decimal";
import { normalizeGstin, validateGstin } from "@/server/domain/gstin";
import { GST_STATES, isActiveStateCode } from "@/server/domain/states";

import {
  GSTIN_ERRORS,
  optionalEmail,
  optionalPhone,
  optionalText,
  requiredText,
  yesNo,
} from "./fields";

/**
 * Customers (SPEC F3), shared by the customer form, the CSV import and customer.service.
 * Messages are keys under `validation`. A GSTIN fills the billing state when none is chosen;
 * a different state needs the override (SPEC §4.1).
 */

/** ₹100 crore: far above any shop's udhaar, and keeps ledger sums well inside bigint. */
export const MAX_OPENING_BALANCE_PAISE = 10n ** 11n;
export const MAX_CREDIT_DAYS = 365;

export const BALANCE_TYPES = ["OWES", "ADVANCE"] as const;

const PINCODE = /^[1-9][0-9]{5}$/;

const optionalPincode = z
  .string()
  .trim()
  .refine((value) => !value || PINCODE.test(value), { error: "pincodeInvalid" })
  .transform((value) => value || null);

const optionalState = z
  .string()
  .trim()
  .refine((value) => !value || isActiveStateCode(value), { error: "stateRequired" })
  .transform((value) => value || null);

const amount = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (!value) return 0n;
    const paise = parseScaled(value.replace(/^(₹|rs\.?)\s*/i, ""), 2);
    if (paise === null || paise > MAX_OPENING_BALANCE_PAISE) {
      ctx.addIssue({ code: "custom", message: "balanceInvalid" });
      return z.NEVER;
    }
    return paise;
  });

const creditDays = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (!value) return 0;
    const days = /^[0-9]{1,3}$/.test(value) ? Number(value) : Number.NaN;
    if (!(days <= MAX_CREDIT_DAYS)) {
      ctx.addIssue({ code: "custom", message: "creditDaysInvalid" });
      return z.NEVER;
    }
    return days;
  });

export const customerSchema = z
  .object({
    name: requiredText(120, "customerNameRequired"),
    phone: optionalPhone,
    email: optionalEmail,
    gstin: z
      .string()
      .trim()
      .transform(normalizeGstin)
      .superRefine((value, ctx) => {
        if (!value) return;
        const result = validateGstin(value);
        if (!result.ok) ctx.addIssue({ code: "custom", message: GSTIN_ERRORS[result.reason] });
      })
      .transform((value) => value || null),
    billingAddressLine1: optionalText(120),
    billingAddressLine2: optionalText(120),
    billingCity: optionalText(60),
    billingPincode: optionalPincode,
    billingStateCode: optionalState,
    shippingAddressLine1: optionalText(120),
    shippingAddressLine2: optionalText(120),
    shippingCity: optionalText(60),
    shippingPincode: optionalPincode,
    shippingStateCode: optionalState,
    balanceType: z.enum(BALANCE_TYPES),
    openingBalance: amount,
    creditDays,
    /** "I've checked: this customer's billing state differs from their GSTIN's." */
    stateOverride: yesNo,
    /** "Save anyway": another active customer has this phone number. */
    confirmDuplicatePhone: yesNo,
  })
  .superRefine((form, ctx) => {
    if (!form.gstin || !form.billingStateCode || form.stateOverride) return;
    // Zod runs this even when a field failed, so compare only a valid GSTIN and state.
    const result = validateGstin(form.gstin);
    if (!result.ok || !isActiveStateCode(form.billingStateCode)) return;
    if (result.stateCode !== form.billingStateCode) {
      ctx.addIssue({
        code: "custom",
        path: ["billingStateCode"],
        message: "customerStateMismatch",
      });
    }
  })
  .transform(
    ({ phone, balanceType, openingBalance, stateOverride, confirmDuplicatePhone, ...rest }) => ({
      customer: {
        ...rest,
        phoneE164: phone,
        billingStateCode: rest.billingStateCode ?? (rest.gstin ? rest.gstin.slice(0, 2) : null),
        openingBalancePaise: balanceType === "ADVANCE" ? -openingBalance : openingBalance,
      },
      stateOverride,
      confirmDuplicatePhone,
    }),
  );

/** What the form holds (strings, plus two checkboxes). */
export type CustomerFormValues = z.input<typeof customerSchema>;
/** What the service receives. */
export type CustomerInput = z.output<typeof customerSchema>;
/** The columns saved for a customer. */
export type CustomerColumns = CustomerInput["customer"];

export const EMPTY_CUSTOMER_FORM = {
  name: "",
  phone: "",
  email: "",
  gstin: "",
  billingAddressLine1: "",
  billingAddressLine2: "",
  billingCity: "",
  billingPincode: "",
  billingStateCode: "",
  shippingAddressLine1: "",
  shippingAddressLine2: "",
  shippingCity: "",
  shippingPincode: "",
  shippingStateCode: "",
  balanceType: "OWES",
  openingBalance: "",
  creditDays: "",
  stateOverride: false,
  confirmDuplicatePhone: false,
} satisfies CustomerFormValues;

// --- CSV import --------------------------------------------------------------------------

export const CUSTOMER_CSV_COLUMNS = [
  "name",
  "phone",
  "email",
  "gstin",
  "billing_address_line1",
  "billing_address_line2",
  "billing_city",
  "billing_pincode",
  "billing_state",
  "shipping_address_line1",
  "shipping_address_line2",
  "shipping_city",
  "shipping_pincode",
  "shipping_state",
  "opening_balance",
  "credit_days",
] as const;

export type CustomerCsvColumn = (typeof CUSTOMER_CSV_COLUMNS)[number];

export const CUSTOMER_CSV_REQUIRED = ["name"] as const satisfies readonly CustomerCsvColumn[];

type FormField = Exclude<keyof CustomerFormValues, "stateOverride" | "confirmDuplicatePhone">;

/** Where a form field's error shows up in the file. */
export const CUSTOMER_FIELD_COLUMNS = {
  name: "name",
  phone: "phone",
  email: "email",
  gstin: "gstin",
  billingAddressLine1: "billing_address_line1",
  billingAddressLine2: "billing_address_line2",
  billingCity: "billing_city",
  billingPincode: "billing_pincode",
  billingStateCode: "billing_state",
  shippingAddressLine1: "shipping_address_line1",
  shippingAddressLine2: "shipping_address_line2",
  shippingCity: "shipping_city",
  shippingPincode: "shipping_pincode",
  shippingStateCode: "shipping_state",
  balanceType: "opening_balance",
  openingBalance: "opening_balance",
  creditDays: "credit_days",
} as const satisfies Record<FormField, CustomerCsvColumn>;

export const CUSTOMER_CSV_TEMPLATE: readonly (readonly string[])[] = [
  CUSTOMER_CSV_COLUMNS,
  [
    "Ramesh Traders",
    "98765 43210",
    "",
    "29AAACI1681G1ZL",
    "4 MG Road",
    "",
    "Bengaluru",
    "560001",
    "Karnataka",
    "",
    "",
    "",
    "",
    "",
    "1500",
    "15",
  ],
  ["Walk-in customer", "", "", "", "", "", "", "", "", "", "", "", "", "", "-200", ""],
];

const ACTIVE_STATES = GST_STATES.filter((state) => state.active);

/** "27", "7" or "Maharashtra" → "27". Anything else is returned as typed, for the schema to refuse. */
export function resolveStateInput(input: string): string {
  const text = input.trim();
  if (/^[0-9]{1,2}$/.test(text)) return text.padStart(2, "0");
  const byName = ACTIVE_STATES.find((state) => state.name.toLowerCase() === text.toLowerCase());
  return byName?.code ?? text;
}

/** One CSV row as form values. A negative balance is an advance; there is no state override. */
export function customerRowToForm(values: Record<CustomerCsvColumn, string>): CustomerFormValues {
  const balance = values.opening_balance.trim();
  const advance = balance.startsWith("-");
  return {
    name: values.name,
    phone: values.phone,
    email: values.email,
    gstin: values.gstin,
    billingAddressLine1: values.billing_address_line1,
    billingAddressLine2: values.billing_address_line2,
    billingCity: values.billing_city,
    billingPincode: values.billing_pincode,
    billingStateCode: resolveStateInput(values.billing_state),
    shippingAddressLine1: values.shipping_address_line1,
    shippingAddressLine2: values.shipping_address_line2,
    shippingCity: values.shipping_city,
    shippingPincode: values.shipping_pincode,
    shippingStateCode: resolveStateInput(values.shipping_state),
    balanceType: advance ? "ADVANCE" : "OWES",
    openingBalance: advance ? balance.slice(1) : balance,
    creditDays: values.credit_days,
    stateOverride: false,
    // Phone duplicates in a file are warnings, reported by the import itself.
    confirmDuplicatePhone: true,
  };
}

/** A row of the import preview, formatted on the server. */
export interface CustomerPreviewRow {
  line: number;
  name: string;
  phone: string | null;
  gstin: string | null;
  state: string | null;
  /** Formatted amount without a sign, or null when there is no opening balance. */
  balance: string | null;
  advance: boolean;
}
