/** What the invoice builder knows about customers and products it can pick (no money as bigint). */

export interface CustomerOption {
  id: string;
  name: string;
  phoneE164: string | null;
  gstin: string | null;
  billingAddressLine1: string | null;
  billingStateCode: string | null;
  shippingStateCode: string | null;
  creditDays: number;
}

export interface ProductOption {
  id: string;
  name: string;
  hsnSac: string | null;
  unit: string;
  /** Rupees, e.g. "420.00". */
  price: string;
  rateBp: number;
  priceIncludesTax: boolean;
}

/** The fields of a customer row the builder needs (structural, so this stays DB-free). */
export function toCustomerOption(customer: CustomerOption): CustomerOption {
  return {
    id: customer.id,
    name: customer.name,
    phoneE164: customer.phoneE164,
    gstin: customer.gstin,
    billingAddressLine1: customer.billingAddressLine1,
    billingStateCode: customer.billingStateCode,
    shippingStateCode: customer.shippingStateCode,
    creditDays: customer.creditDays,
  };
}
