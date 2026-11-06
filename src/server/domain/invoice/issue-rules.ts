/**
 * What must be true before an invoice can be issued, beyond the line maths (SPEC §4.7).
 * Thresholds come in as arguments (CLAUDE.md rule 12); the service passes them from config.
 *
 * Open CA questions 4 and 5 (docs/golden-fixtures.md) decide some of these rules. Until they
 * are answered the stricter reading is used, so nothing is issued that a CA would refuse.
 */

import { type FieldIssue } from "@/lib/errors";

import { type DocumentType, type PlaceOfSupplyWarning } from "../gst/place-of-supply";

/** Allowed, but the user must confirm each one before issuing. */
export type IssueWarning = PlaceOfSupplyWarning;

export const ISSUE_WARNINGS = [
  "UNREGISTERED_INTER_STATE",
] as const satisfies readonly IssueWarning[];

export type HsnDigits = 4 | 6;

export interface IssueRecipient {
  /** Null for a walk-in sale. */
  customerId: string | null;
  name: string;
  gstin: string | null;
  addressLine1: string | null;
  stateCode: string | null;
}

export interface IssueRulesInput {
  documentType: DocumentType;
  recipient: IssueRecipient;
  lines: readonly { hsnSac: string | null }[];
  hsnDigitsRequired: HsnDigits;
  grandTotalPaise: bigint;
  /** Rule 46: an unregistered recipient at or above this needs name, address and state. */
  recipientDetailsThresholdPaise: bigint;
  placeOfSupplyWarnings: readonly PlaceOfSupplyWarning[];
}

export interface IssueCheck {
  /** `validation.*` keys; any error blocks issuing. */
  errors: FieldIssue[];
  warnings: IssueWarning[];
}

const blank = (value: string | null): boolean => value === null || value.trim() === "";

/**
 * HSN on each line (SPEC §4.7, CA question 5): with the 4-digit setting (AATO up to ₹5 cr) only
 * B2B lines need a code; with 6 digits every line needs at least 6. A plain "Invoice" from an
 * unregistered business is outside GST, so it needs none.
 */
function hsnIssues(input: IssueRulesInput): FieldIssue[] {
  if (input.documentType === "INVOICE") return [];
  const isB2B = input.recipient.gstin !== null;
  if (input.hsnDigitsRequired === 4 && !isB2B) return [];
  const message = input.hsnDigitsRequired === 6 ? "hsnSixDigitsRequired" : "hsnRequired";
  return input.lines.flatMap((line, index) =>
    line.hsnSac !== null && line.hsnSac.length >= input.hsnDigitsRequired
      ? []
      : [{ path: `lines.${String(index)}.hsnSac`, message }],
  );
}

/**
 * Rule 46 (CA question 4): an unregistered recipient of an invoice worth the threshold or more
 * must be named with an address and state, so a walk-in sale cannot be that large. The invoice
 * total is compared, which is the stricter reading.
 */
function recipientIssues(input: IssueRulesInput): FieldIssue[] {
  const { recipient } = input;
  if (input.documentType === "INVOICE" || recipient.gstin !== null) return [];
  if (input.grandTotalPaise < input.recipientDetailsThresholdPaise) return [];
  const complete =
    recipient.customerId !== null &&
    !blank(recipient.name) &&
    !blank(recipient.addressLine1) &&
    !blank(recipient.stateCode);
  return complete ? [] : [{ path: "customerId", message: "recipientDetailsRequired" }];
}

export function checkIssuable(input: IssueRulesInput): IssueCheck {
  if (input.lines.length === 0) {
    return { errors: [{ path: "lines", message: "invoiceLinesRequired" }], warnings: [] };
  }
  return {
    errors: [...hsnIssues(input), ...recipientIssues(input)],
    warnings: [...input.placeOfSupplyWarnings],
  };
}

/** Warnings the user has not ticked yet. */
export function unacknowledged(
  warnings: readonly IssueWarning[],
  acknowledged: readonly IssueWarning[],
): IssueWarning[] {
  return warnings.filter((warning) => !acknowledged.includes(warning));
}
