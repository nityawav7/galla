/**
 * What an issued document prints about its two parties, copied at issue so later edits to the
 * customer or the business never change it (SPEC §7.4 "Snapshots", Rule 46 fields).
 */

import { type GstScheme } from "../gst/place-of-supply";

export interface AddressSnapshot {
  line1: string | null;
  line2: string | null;
  city: string | null;
  pincode: string | null;
  stateCode: string | null;
}

/** The recipient. A walk-in sale has an empty or typed name and nothing else. */
export interface CustomerSnapshot {
  name: string;
  gstin: string | null;
  phoneE164: string | null;
  email: string | null;
  billing: AddressSnapshot | null;
  shipping: AddressSnapshot | null;
}

/** The supplier: the business as it was when the document was issued. */
export interface SupplierSnapshot {
  legalName: string;
  tradeName: string | null;
  gstin: string | null;
  gstScheme: GstScheme;
  stateCode: string;
  address: AddressSnapshot;
  phoneE164: string | null;
  email: string | null;
  logoUrl: string | null;
  signatureUrl: string | null;
  /**
   * The business's terms as printed. Added in Phase 7, so documents issued before it have none
   * (undefined) and print no terms.
   */
  terms?: string | null;
}

export interface CustomerFields {
  name: string;
  gstin: string | null;
  phoneE164: string | null;
  email: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingPincode: string | null;
  billingStateCode: string | null;
  shippingAddressLine1: string | null;
  shippingAddressLine2: string | null;
  shippingCity: string | null;
  shippingPincode: string | null;
  shippingStateCode: string | null;
}

export interface BusinessFields {
  legalName: string;
  tradeName: string | null;
  gstin: string | null;
  gstScheme: GstScheme;
  stateCode: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  pincode: string | null;
  phoneE164: string | null;
  email: string | null;
  logoUrl: string | null;
  signatureUrl: string | null;
  terms: string | null;
}

function address(
  line1: string | null,
  line2: string | null,
  city: string | null,
  pincode: string | null,
  stateCode: string | null,
): AddressSnapshot | null {
  if (line1 === null && line2 === null && city === null && pincode === null && stateCode === null) {
    return null;
  }
  return { line1, line2, city, pincode, stateCode };
}

export function customerSnapshot(customer: CustomerFields): CustomerSnapshot {
  return {
    name: customer.name,
    gstin: customer.gstin,
    phoneE164: customer.phoneE164,
    email: customer.email,
    billing: address(
      customer.billingAddressLine1,
      customer.billingAddressLine2,
      customer.billingCity,
      customer.billingPincode,
      customer.billingStateCode,
    ),
    shipping: address(
      customer.shippingAddressLine1,
      customer.shippingAddressLine2,
      customer.shippingCity,
      customer.shippingPincode,
      customer.shippingStateCode,
    ),
  };
}

/** A walk-in buyer: only the name typed on the invoice, possibly empty. */
export function walkInSnapshot(name: string): CustomerSnapshot {
  return {
    name: name.trim(),
    gstin: null,
    phoneE164: null,
    email: null,
    billing: null,
    shipping: null,
  };
}

export function supplierSnapshot(business: BusinessFields): SupplierSnapshot {
  return {
    legalName: business.legalName,
    tradeName: business.tradeName,
    gstin: business.gstin,
    gstScheme: business.gstScheme,
    stateCode: business.stateCode,
    address: {
      line1: business.addressLine1,
      line2: business.addressLine2,
      city: business.city,
      pincode: business.pincode,
      stateCode: business.stateCode,
    },
    phoneE164: business.phoneE164,
    email: business.email,
    logoUrl: business.logoUrl,
    signatureUrl: business.signatureUrl,
    terms: business.terms?.trim() ? business.terms.trim() : null,
  };
}
