import { computeInvoice } from "@/server/domain/gst/calc";
import { type DocumentType, type TaxMode } from "@/server/domain/gst/place-of-supply";
import { type PrintableInput } from "@/server/domain/invoice/printable";
import { type CustomerSnapshot, type SupplierSnapshot } from "@/server/domain/invoice/snapshot";

/*
 * Documents for the printable-model and PDF snapshot tests. Line amounts come from the domain
 * engine, so they always match what issuing would store.
 */

interface SampleLine {
  description: string;
  hsnSac: string | null;
  unit: string;
  qtyMilli: bigint;
  unitPricePaise: bigint;
  rateBp: number;
  priceIncludesTax?: boolean;
  discountPaise?: bigint;
}

export const SUPPLIER: SupplierSnapshot = {
  legalName: "Sharma Hardware LLP",
  tradeName: "Sharma Hardware",
  gstin: "27AAPFU0939F1ZV",
  gstScheme: "REGULAR",
  stateCode: "27",
  address: {
    line1: "4 Station Road",
    line2: null,
    city: "Nashik",
    pincode: "422001",
    stateCode: "27",
  },
  phoneE164: "+919876500000",
  email: null,
  logoUrl: null,
  signatureUrl: null,
  terms: "Goods once sold are not taken back.",
};

export const B2B_KARNATAKA: CustomerSnapshot = {
  name: "Ramesh Traders",
  gstin: "29AABCU9603R1ZM",
  phoneE164: "+919876543210",
  email: null,
  billing: {
    line1: "12 MG Road",
    line2: null,
    city: "Bengaluru",
    pincode: "560001",
    stateCode: "29",
  },
  shipping: null,
};

function document(input: {
  type: DocumentType;
  taxMode: TaxMode;
  number: string;
  placeOfSupplyStateCode: string;
  supplier?: SupplierSnapshot;
  recipient: CustomerSnapshot | null;
  lines: SampleLine[];
  roundOff?: boolean;
  dueDate?: string | null;
  notes?: string | null;
}): PrintableInput {
  const lines = input.lines.map((line) => ({
    ...line,
    priceIncludesTax: line.priceIncludesTax ?? false,
    discountPaise: line.discountPaise ?? 0n,
  }));
  const taxMode = input.type === "TAX_INVOICE" ? input.taxMode : "NONE";
  const amounts = computeInvoice({ lines, taxMode, roundOff: input.roundOff ?? true });
  return {
    type: input.type,
    number: input.number,
    date: "2026-11-09",
    dueDate: input.dueDate === undefined ? "2026-11-24" : input.dueDate,
    placeOfSupplyStateCode: input.placeOfSupplyStateCode,
    isInterState: taxMode === "INTER",
    supplier: input.supplier ?? SUPPLIER,
    recipient: input.recipient,
    lines: lines.map((line, index) => {
      const amount = amounts.lines[index];
      if (!amount) throw new Error("line amounts missing");
      return {
        description: line.description,
        hsnSac: line.hsnSac,
        unit: line.unit,
        qtyMilli: line.qtyMilli,
        unitPricePaise: line.unitPricePaise,
        discountPaise: amount.discountPaise,
        rateBp: type(input.type, line.rateBp),
        taxablePaise: amount.taxablePaise,
        cgstPaise: amount.cgstPaise,
        sgstPaise: amount.sgstPaise,
        utgstPaise: amount.utgstPaise,
        igstPaise: amount.igstPaise,
        lineTotalPaise: amount.totalPaise,
      };
    }),
    totals: amounts.totals,
    notes: input.notes ?? null,
  };
}

/** Lines of a Bill of Supply or plain Invoice are stored with rate 0 (ADR 0006). */
function type(documentType: DocumentType, rateBp: number): number {
  return documentType === "TAX_INVOICE" ? rateBp : 0;
}

/** Golden fixture 11 (SPEC F4 acceptance): Maharashtra to a Karnataka business, IGST. */
export const INTER_STATE = document({
  type: "TAX_INVOICE",
  taxMode: "INTER",
  number: "SH/26-27/0001",
  placeOfSupplyStateCode: "29",
  recipient: B2B_KARNATAKA,
  lines: [
    {
      description: "Cement 50 kg",
      hsnSac: "2523",
      unit: "BAG",
      qtyMilli: 1000n,
      unitPricePaise: 42000n,
      rateBp: 1800,
      discountPaise: 2000n,
    },
    {
      description: "Nails",
      hsnSac: "7317",
      unit: "KGS",
      qtyMilli: 1500n,
      unitPricePaise: 12000n,
      rateBp: 1800,
    },
    {
      description: "Paint 1 L",
      hsnSac: "3208",
      unit: "LTR",
      qtyMilli: 1000n,
      unitPricePaise: 59000n,
      rateBp: 1800,
      priceIncludesTax: true,
    },
  ],
});

/** Intra-state with two rates, a ship-to address, round-off and notes. */
export const INTRA_STATE = document({
  type: "TAX_INVOICE",
  taxMode: "INTRA_SGST",
  number: "SH/26-27/0002",
  placeOfSupplyStateCode: "27",
  recipient: {
    name: "Patil Constructions",
    gstin: "27AAACP1234C1Z5",
    phoneE164: null,
    email: null,
    billing: {
      line1: "Plot 7, MIDC",
      line2: "Satpur",
      city: "Nashik",
      pincode: "422007",
      stateCode: "27",
    },
    shipping: {
      line1: "Site 3, Gangapur Road",
      line2: null,
      city: "Nashik",
      pincode: "422013",
      stateCode: "27",
    },
  },
  lines: [
    {
      description: "PVC pipe 1 inch",
      hsnSac: "3917",
      unit: "MTR",
      qtyMilli: 12500n,
      unitPricePaise: 8550n,
      rateBp: 1800,
    },
    {
      description: "Exercise book",
      hsnSac: "4820",
      unit: "NOS",
      qtyMilli: 3000n,
      unitPricePaise: 4500n,
      rateBp: 500,
    },
  ],
  notes: "Delivered by tempo MH15 AB 1234.",
});

/** Chandigarh charges UTGST instead of SGST (SPEC §4.2). */
export const UTGST = document({
  type: "TAX_INVOICE",
  taxMode: "INTRA_UTGST",
  number: "CH/26-27/0001",
  placeOfSupplyStateCode: "04",
  supplier: {
    ...SUPPLIER,
    gstin: "04AAPFU0939F1ZX",
    stateCode: "04",
    address: {
      line1: "Sector 17",
      line2: null,
      city: "Chandigarh",
      pincode: "160017",
      stateCode: "04",
    },
  },
  recipient: {
    name: "",
    gstin: null,
    phoneE164: null,
    email: null,
    billing: null,
    shipping: null,
  },
  lines: [
    {
      description: "Tile adhesive",
      hsnSac: "3214",
      unit: "BAG",
      qtyMilli: 2000n,
      unitPricePaise: 35000n,
      rateBp: 1800,
    },
  ],
  dueDate: null,
});

/** A composition dealer: Bill of Supply, no tax, Hindi customer and item names. */
export const BILL_OF_SUPPLY = document({
  type: "BILL_OF_SUPPLY",
  taxMode: "NONE",
  number: "GK/26-27/0010",
  placeOfSupplyStateCode: "09",
  supplier: {
    ...SUPPLIER,
    legalName: "श्री गणेश किराना",
    tradeName: null,
    gstin: "09AAPFU0939F1ZT",
    gstScheme: "COMPOSITION",
    stateCode: "09",
    address: {
      line1: "Chowk Bazaar",
      line2: null,
      city: "Lucknow",
      pincode: "226003",
      stateCode: "09",
    },
    terms: null,
  },
  recipient: {
    name: "रमेश कुमार",
    gstin: null,
    phoneE164: "+919812345678",
    email: null,
    billing: {
      line1: "Aminabad",
      line2: null,
      city: "Lucknow",
      pincode: "226018",
      stateCode: "09",
    },
    shipping: null,
  },
  lines: [
    {
      description: "Basmati rice चावल",
      hsnSac: null,
      unit: "KGS",
      qtyMilli: 5000n,
      unitPricePaise: 9000n,
      rateBp: 500,
    },
    {
      description: "Toor dal",
      hsnSac: null,
      unit: "KGS",
      qtyMilli: 2000n,
      unitPricePaise: 14550n,
      rateBp: 500,
      discountPaise: 1000n,
    },
  ],
  roundOff: false,
});
