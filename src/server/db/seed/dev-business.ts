import { eq } from "drizzle-orm";

import { businesses, customers, products } from "../schema";
import { withTransaction } from "../transaction";

export const DEV_BUSINESS_SLUG = "dev-shop";

/**
 * A small Maharashtra shop for local development (SPEC §9). Created once; re-running finds it
 * and changes nothing. The GSTINs are public test values with valid check characters.
 */
export async function seedDevBusiness(): Promise<{ businessId: string; created: boolean }> {
  return withTransaction(async (tx) => {
    const [existing] = await tx
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.slug, DEV_BUSINESS_SLUG));
    if (existing) return { businessId: existing.id, created: false };

    const [business] = await tx
      .insert(businesses)
      .values({
        slug: DEV_BUSINESS_SLUG,
        legalName: "Dev Kirana Stores",
        tradeName: "Dev Kirana",
        gstin: "27AAPFU0939F1ZV",
        gstScheme: "REGULAR",
        stateCode: "27",
        addressLine1: "12 Market Road",
        city: "Pune",
        pincode: "411001",
        upiVpa: "devkirana@upi",
      })
      .returning({ id: businesses.id });
    if (!business) throw new Error("insert returned no row");
    const businessId = business.id;

    await tx.insert(products).values([
      {
        businessId,
        name: "Basmati Rice 5 kg",
        hsnSac: "1006",
        unit: "BAG",
        pricePaise: 62500n,
        rateBp: 500,
      },
      { businessId, name: "Toor Dal", hsnSac: "0713", unit: "KGS", pricePaise: 16000n, rateBp: 0 },
      {
        businessId,
        name: "Shampoo 180 ml",
        hsnSac: "3305",
        unit: "BTL",
        pricePaise: 11800n,
        rateBp: 1800,
        priceIncludesTax: true,
      },
      {
        businessId,
        name: "Detergent 1 kg",
        hsnSac: "3402",
        unit: "PAC",
        pricePaise: 9900n,
        rateBp: 1800,
        sku: "DET-1KG",
      },
    ]);

    await tx.insert(customers).values([
      {
        businessId,
        name: "Sharma General Store",
        gstin: "27AAACR5055K1Z7",
        billingCity: "Mumbai",
        billingStateCode: "27",
        creditDays: 15,
      },
      {
        businessId,
        name: "Bengaluru Traders",
        gstin: "29AAACI1681G1ZL",
        billingCity: "Bengaluru",
        billingStateCode: "29",
        creditDays: 30,
      },
      { businessId, name: "Walk-in Ramesh", phoneE164: "+919800000001" },
    ]);

    return { businessId, created: true };
  });
}
