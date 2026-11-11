/**
 * What the record-payment form gets from the server, with paise as decimal strings so it crosses
 * the server/client boundary unchanged (bigints are turned back with `BigInt` in the browser).
 */

export interface OpenItemOption {
  /** "OPENING" for the customer's opening balance owed, else an invoice id. */
  key: string;
  number: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  balancePaise: string;
}

export interface PaymentFormOptions {
  customer: { id: string; name: string } | null;
  /** The invoice the form was opened from. */
  invoiceId: string | null;
  openItems: OpenItemOption[];
  onAccountPaise: string;
  today: string;
}

export interface RecordedPayment {
  paymentId: string;
  onAccountPaise: string;
  invoices: { id: string; number: string | null; status: string; balancePaise: string }[];
}
