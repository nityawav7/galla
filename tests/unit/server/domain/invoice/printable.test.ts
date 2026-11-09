import { describe, expect, it } from "vitest";

import { formatRate, printableDocument, taxKindsFor } from "@/server/domain/invoice/printable";

import { BILL_OF_SUPPLY, INTER_STATE, INTRA_STATE, SUPPLIER, UTGST } from "../../pdf/samples";

describe("formatRate", () => {
  it.each([
    [1800, "18%"],
    [900, "9%"],
    [250, "2.5%"],
    [25, "0.25%"],
    [12.5, "0.125%"],
    [0, "0%"],
  ])("%s bp → %s", (rateBp, expected) => {
    expect(formatRate(rateBp)).toBe(expected);
  });
});

describe("taxKindsFor", () => {
  it("picks the taxes from the document type and place of supply (SPEC §4.2)", () => {
    const tax = { type: "TAX_INVOICE" as const, isInterState: false };
    expect(taxKindsFor({ ...tax, isInterState: true, placeOfSupplyStateCode: "29" })).toEqual([
      "igst",
    ]);
    expect(taxKindsFor({ ...tax, placeOfSupplyStateCode: "27" })).toEqual(["cgst", "sgst"]);
    expect(taxKindsFor({ ...tax, placeOfSupplyStateCode: "04" })).toEqual(["cgst", "utgst"]);
    // Delhi has a legislature, so SGST.
    expect(taxKindsFor({ ...tax, placeOfSupplyStateCode: "07" })).toEqual(["cgst", "sgst"]);
    for (const type of ["BILL_OF_SUPPLY", "INVOICE"] as const) {
      expect(taxKindsFor({ type, isInterState: true, placeOfSupplyStateCode: "29" })).toEqual([]);
    }
  });
});

describe("printableDocument", () => {
  it("prints fixture 11 (inter-state, IGST) with every Rule 46 value", () => {
    const doc = printableDocument(INTER_STATE);
    expect(doc).toMatchObject({
      type: "TAX_INVOICE",
      number: "SH/26-27/0001",
      date: "09-11-2026",
      dueDate: "24-11-2026",
      placeOfSupply: "Karnataka (29)",
      showTax: true,
      taxKinds: ["igst"],
      supplier: {
        name: "Sharma Hardware",
        legalName: "Sharma Hardware LLP",
        address: ["4 Station Road", "Nashik 422001", "Maharashtra (27)"],
        gstin: "27AAPFU0939F1ZV",
        phone: "+91 98765 00000",
      },
      recipient: {
        name: "Ramesh Traders",
        legalName: null,
        address: ["12 MG Road", "Bengaluru 560001", "Karnataka (29)"],
        gstin: "29AABCU9603R1ZM",
        phone: "+91 98765 43210",
      },
      shipTo: null,
      grandTotal: "₹1,274.00",
      amountInWords: "Rupees One Thousand Two Hundred Seventy Four Only",
      terms: "Goods once sold are not taken back.",
      notes: null,
    });
    expect(doc.lines).toEqual([
      {
        position: 1,
        description: "Cement 50 kg",
        hsnSac: "2523",
        qty: "1",
        unit: "BAG",
        unitPrice: "₹420.00",
        discount: "₹20.00",
        hasDiscount: true,
        taxable: "₹400.00",
        taxes: [{ rate: "18%", amount: "₹72.00" }],
        total: "₹472.00",
      },
      expect.objectContaining({ qty: "1.5", hasDiscount: false, total: "₹212.40" }),
      expect.objectContaining({ taxable: "₹500.00", total: "₹590.00" }),
    ]);
    expect(doc.rates).toEqual([
      { rate: "18%", taxable: "₹1,080.00", taxes: [{ rate: "18%", amount: "₹194.40" }] },
    ]);
    expect(doc.totals).toEqual([
      { key: "taxable", amount: "₹1,080.00" },
      { key: "igst", amount: "₹194.40" },
      { key: "roundOff", amount: "-₹0.40" },
    ]);
  });

  it("splits intra-state tax into CGST and SGST at half the rate, per rate", () => {
    const doc = printableDocument(INTRA_STATE);
    expect(doc.taxKinds).toEqual(["cgst", "sgst"]);
    expect(doc.lines[1]?.taxes).toEqual([
      { rate: "2.5%", amount: "₹3.38" },
      { rate: "2.5%", amount: "₹3.38" },
    ]);
    expect(doc.rates.map((row) => row.rate)).toEqual(["5%", "18%"]);
    expect(doc.shipTo).toEqual(["Site 3, Gangapur Road", "Nashik 422013", "Maharashtra (27)"]);
    expect(doc.notes).toBe("Delivered by tempo MH15 AB 1234.");
    expect(doc.totals.map((row) => row.key)).toEqual(["taxable", "cgst", "sgst", "roundOff"]);
  });

  it("prints UTGST for Chandigarh and a walk-in buyer without a name", () => {
    const doc = printableDocument(UTGST);
    expect(doc.taxKinds).toEqual(["cgst", "utgst"]);
    expect(doc.recipient).toEqual({
      name: null,
      legalName: null,
      address: [],
      gstin: null,
      phone: null,
    });
    expect(doc.dueDate).toBeNull();
    // ₹700 + 9% + 9% = ₹826.00 exactly, so no round-off row.
    expect(doc.totals.map((row) => row.key)).toEqual(["taxable", "cgst", "utgst"]);
  });

  it("prints a Bill of Supply without tax columns, rates or tax totals", () => {
    const doc = printableDocument(BILL_OF_SUPPLY);
    expect(doc.showTax).toBe(false);
    expect(doc.taxKinds).toEqual([]);
    expect(doc.rates).toEqual([]);
    expect(doc.lines.every((line) => line.taxes.length === 0)).toBe(true);
    expect(doc.totals).toEqual([{ key: "taxable", amount: "₹731.00" }]);
    expect(doc.supplier).toMatchObject({ name: "श्री गणेश किराना", legalName: null });
    expect(doc.lines[0]?.hsnSac).toBeNull();
    expect(doc.terms).toBeNull();
  });

  it("treats a missing recipient snapshot as a walk-in, and keeps unknown state codes", () => {
    const doc = printableDocument({
      ...UTGST,
      recipient: null,
      placeOfSupplyStateCode: "99",
      supplier: {
        ...SUPPLIER,
        tradeName: null,
        phoneE164: null,
        terms: undefined,
        address: { line1: null, line2: null, city: null, pincode: null, stateCode: null },
      },
    });
    expect(doc.recipient.name).toBeNull();
    expect(doc.shipTo).toBeNull();
    expect(doc.placeOfSupply).toBe("99");
    expect(doc.supplier).toEqual({
      name: "Sharma Hardware LLP",
      legalName: null,
      address: [],
      gstin: "27AAPFU0939F1ZV",
      phone: null,
    });
    expect(doc.terms).toBeNull();
  });
});
