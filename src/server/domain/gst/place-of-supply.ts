/**
 * Place of supply and which taxes apply (SPEC §4.2, v1 rule for goods).
 */

import { ValidationError } from "@/lib/errors";

import { getActiveState } from "../states";

export type GstScheme = "REGULAR" | "COMPOSITION" | "UNREGISTERED";

/** UNREGISTERED businesses issue a plain "Invoice" with no GST (ADR 0002 decisions). */
export type DocumentType = "TAX_INVOICE" | "BILL_OF_SUPPLY" | "INVOICE";

/**
 * INTRA_SGST: CGST + SGST. INTRA_UTGST: CGST + UTGST (UT without legislature).
 * INTER: IGST. NONE: no tax (composition or unregistered business).
 */
export type TaxMode = "INTRA_SGST" | "INTRA_UTGST" | "INTER" | "NONE";

export interface PlaceOfSupplyInput {
  businessStateCode: string;
  scheme: GstScheme;
  customerShippingStateCode?: string | null;
  customerBillingStateCode?: string | null;
  /** Chosen by the user on the invoice; wins over the customer's address. */
  overrideStateCode?: string | null;
}

export interface PlaceOfSupply {
  stateCode: string;
  isInterState: boolean;
  taxMode: TaxMode;
}

const DOCUMENT_TYPES: Record<GstScheme, DocumentType> = {
  REGULAR: "TAX_INVOICE",
  COMPOSITION: "BILL_OF_SUPPLY",
  UNREGISTERED: "INVOICE",
};

export function documentTypeFor(scheme: GstScheme): DocumentType {
  return DOCUMENT_TYPES[scheme];
}

export function determinePlaceOfSupply(input: PlaceOfSupplyInput): PlaceOfSupply {
  const business = getActiveState(input.businessStateCode);
  // A walk-in customer with no state is treated as buying at the shop.
  const chosen =
    input.overrideStateCode ??
    input.customerShippingStateCode ??
    input.customerBillingStateCode ??
    business.code;
  const place = getActiveState(chosen);
  const isInterState = place.code !== business.code;

  if (input.scheme === "COMPOSITION" && isInterState) {
    // CGST Act s.10(2)(c): composition taxpayers cannot make inter-state supplies of goods.
    throw new ValidationError("A composition business cannot bill a customer in another state", [
      { path: "placeOfSupply", message: "Inter-state sale not allowed under composition" },
    ]);
  }

  return {
    stateCode: place.code,
    isInterState,
    taxMode: taxModeFor(input.scheme, isInterState, place.isUtWithoutLegislature),
  };
}

function taxModeFor(scheme: GstScheme, isInterState: boolean, isUt: boolean): TaxMode {
  if (scheme !== "REGULAR") return "NONE";
  if (isInterState) return "INTER";
  return isUt ? "INTRA_UTGST" : "INTRA_SGST";
}
