import { z } from "zod";

import { GST_SCHEMES } from "@/server/domain/gst/place-of-supply";
import { normalizeGstin, validateGstin } from "@/server/domain/gstin";
import { MAX_PREFIX_LENGTH } from "@/server/domain/numbering";
import { templateProblems } from "@/server/domain/share/whatsapp";
import { isActiveStateCode } from "@/server/domain/states";
import { isValidUpiVpa, normalizeUpiVpa } from "@/server/domain/upi";

import { GSTIN_ERRORS, optionalEmail, optionalPhone, optionalText, requiredText } from "./fields";

/**
 * Business details, shared by onboarding, settings and business.service. Messages are keys
 * under `validation` in src/messages. Empty optional fields become null, so saving the
 * settings form can clear them.
 */

const prefixPattern = new RegExp(`^[A-Za-z0-9-]{1,${String(MAX_PREFIX_LENGTH)}}$`);
const prefix = z.string().trim().regex(prefixPattern, { error: "prefixInvalid" });

/**
 * A WhatsApp message template (SPEC F6). Empty means "the default"; anything else must keep the
 * invoice link and use only known placeholders. Optional, so onboarding never sends it.
 */
const whatsappTemplate = z
  .string()
  .default("")
  .superRefine((value, ctx) => {
    if (value.trim() === "") return;
    for (const problem of templateProblems(value)) {
      ctx.addIssue({ code: "custom", message: problem });
    }
  })
  .transform((value) => (value.trim() === "" ? null : value.replace(/\r\n/g, "\n").trim()));

export const businessFields = {
  legalName: requiredText(100, "legalNameRequired"),
  tradeName: optionalText(100),
  addressLine1: requiredText(120, "addressRequired"),
  addressLine2: optionalText(120),
  city: requiredText(60, "cityRequired"),
  pincode: z
    .string()
    .trim()
    .regex(/^[1-9][0-9]{5}$/, { error: "pincodeInvalid" }),
  stateCode: z.string().refine(isActiveStateCode, { error: "stateRequired" }),
  phone: optionalPhone,
  email: optionalEmail,
  gstScheme: z.enum(GST_SCHEMES),
  gstin: z.string().trim().transform(normalizeGstin),
  invoicePrefix: prefix,
  creditNotePrefix: prefix,
  upiVpa: z
    .string()
    .trim()
    .refine((value) => !value || isValidUpiVpa(value), { error: "upiInvalid" })
    .transform((value) => (value ? normalizeUpiVpa(value) : null)),
  /** HSN digits issuing checks (SPEC §4.7): 4 up to ₹5 cr turnover, 6 above. Settings only. */
  hsnDigitsRequired: z
    .enum(["4", "6"], { error: "hsnDigitsInvalid" })
    .default("4")
    .transform((value) => (value === "6" ? 6 : 4)),
  whatsappTemplateEn: whatsappTemplate,
  whatsappTemplateHi: whatsappTemplate,
  /** The daily job's emails (SPEC F9). Settings only; onboarding gets the defaults. */
  emailReminders: z.boolean().default(false),
  ownerDigest: z.boolean().default(true),
};

/** The fields each onboarding step shows (and validates before "Next"). */
export const ONBOARDING_STEPS = [
  [
    "legalName",
    "tradeName",
    "addressLine1",
    "addressLine2",
    "city",
    "pincode",
    "stateCode",
    "phone",
  ],
  ["gstScheme", "gstin"],
  ["invoicePrefix", "upiVpa"],
] as const satisfies readonly (readonly (keyof typeof businessFields)[])[];

export const businessSchema = z
  .object(businessFields)
  .superRefine((business, ctx) => {
    if (business.gstScheme !== "UNREGISTERED") {
      if (!business.gstin) {
        ctx.addIssue({ code: "custom", path: ["gstin"], message: "gstinRequired" });
        return;
      }
      const result = validateGstin(business.gstin);
      if (!result.ok) {
        ctx.addIssue({ code: "custom", path: ["gstin"], message: GSTIN_ERRORS[result.reason] });
      } else if (isActiveStateCode(business.stateCode) && result.stateCode !== business.stateCode) {
        // (An invalid state already has its own error; don't add a second one here.)
        ctx.addIssue({ code: "custom", path: ["gstin"], message: "gstinStateMismatch" });
      }
    }
    if (business.invoicePrefix.toUpperCase() === business.creditNotePrefix.toUpperCase()) {
      ctx.addIssue({ code: "custom", path: ["invoicePrefix"], message: "prefixesSame" });
    }
  })
  // An unregistered business has no GSTIN, whatever was typed before switching scheme.
  .transform(({ gstin, ...business }) => ({
    ...business,
    gstin: business.gstScheme === "UNREGISTERED" ? null : gstin,
  }));

/** What the form holds (all strings). */
export type BusinessFormValues = z.input<typeof businessSchema>;
/** What the service stores (normalized, nulls for empty). */
export type BusinessInput = z.output<typeof businessSchema>;

export const EMPTY_BUSINESS_FORM: BusinessFormValues = {
  legalName: "",
  tradeName: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  pincode: "",
  stateCode: "",
  phone: "",
  email: "",
  gstScheme: "REGULAR",
  gstin: "",
  invoicePrefix: "INV",
  creditNotePrefix: "CN",
  upiVpa: "",
  hsnDigitsRequired: "4",
  whatsappTemplateEn: "",
  whatsappTemplateHi: "",
  emailReminders: false,
  ownerDigest: true,
};
