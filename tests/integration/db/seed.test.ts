import { count, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { businesses, products, states, taxRates, units } from "@/server/db/schema";
import { DEV_BUSINESS_SLUG, seedDevBusiness } from "@/server/db/seed/dev-business";
import { seedReferenceData, TAX_RATES, UNITS } from "@/server/db/seed/reference";
import { GST_STATES } from "@/server/domain/states";

afterAll(async () => {
  await closeDb();
});

async function rowCount(table: typeof states | typeof taxRates | typeof units): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(table);
  return row?.n ?? 0;
}

describe("seed", () => {
  it("reference data matches the domain tables and re-running changes nothing", async () => {
    await seedReferenceData(getDb());
    await seedReferenceData(getDb());
    expect(await rowCount(states)).toBe(GST_STATES.length);
    expect(await rowCount(taxRates)).toBe(TAX_RATES.length);
    expect(await rowCount(units)).toBe(UNITS.length);

    const [ladakh] = await getDb().select().from(states).where(eq(states.code, "38"));
    expect(ladakh).toEqual({
      code: "38",
      name: "Ladakh",
      isUtWithoutLegislature: true,
      active: true,
    });
  });

  it("creates the dev business once", async () => {
    const first = await seedDevBusiness();
    const second = await seedDevBusiness();
    expect(second).toEqual({ businessId: first.businessId, created: false });

    const matches = await getDb()
      .select({ id: businesses.id })
      .from(businesses)
      .where(eq(businesses.slug, DEV_BUSINESS_SLUG));
    expect(matches).toHaveLength(1);
    const [productCount] = await getDb()
      .select({ n: count() })
      .from(products)
      .where(eq(products.businessId, first.businessId));
    expect(productCount?.n).toBe(4);
  });
});
