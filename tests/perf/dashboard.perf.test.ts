import { sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { closeDb, getDb } from "@/server/db/client";
import { getDashboard } from "@/server/services/dashboard.service";

import { createTenant, type Tenant } from "../integration/support/tenants";

/*
 * SPEC F8 AC: the dashboard answers in under 300 ms (p95) with 10,000 invoices. The data goes in
 * with a few set-based INSERTs (seconds, not the minutes 10,000 real issues would take): 300
 * customers, 10,000 issued invoices over 180 days with one line each, 2,000 payments on account
 * and 300 credit notes. Set DASHBOARD_EXPLAIN=1 to print the business id for EXPLAIN ANALYZE.
 */

afterAll(async () => {
  await closeDb();
});

afterEach(() => {
  vi.useRealTimers();
});

const INVOICES = 10_000;
const RUNS = 30;
const TODAY = "2026-11-11";

async function seed(tenant: Tenant): Promise<void> {
  await getDb().transaction(async (db) => {
    // Test data only: the immutability triggers refuse lines on an issued invoice, so they are
    // off for this transaction (the test database user owns the tables).
    await db.execute(sql`set local session_replication_role = replica`);
    await insertAll(db, tenant.business.id);
  });
  await getDb().execute(sql`analyze invoices, invoice_lines, payments, customers`);
}

async function insertAll(
  db: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0],
  biz: string,
): Promise<void> {
  await db.execute(sql`
    insert into customers (id, business_id, name, opening_balance_paise, credit_days)
    select gen_random_uuid(), ${biz}, 'Customer ' || i, (i % 7) * 10000, 15
    from generate_series(1, 300) i`);
  await db.execute(sql`
    with numbered as (
      select row_number() over (order by id) as n, id from customers where business_id = ${biz})
    insert into invoices (id, business_id, type, status, number, fy, invoice_date, due_date,
      customer_id, customer_snapshot, supplier_snapshot, place_of_supply_state_code,
      is_inter_state, taxable_paise, cgst_paise, sgst_paise, grand_total_paise, issued_at)
    select gen_random_uuid(), ${biz}, 'TAX_INVOICE', 'ISSUED', 'P/26-27/' || lpad(i::text, 5, '0'),
      '26-27', ${TODAY}::date - (i % 180), ${TODAY}::date - (i % 180) + 15,
      (select id from numbered where n = 1 + (i % 300)),
      '{"name":"Customer","gstin":null,"phoneE164":null,"email":null,"billing":null,"shipping":null}'::jsonb,
      '{"legalName":"Perf","tradeName":null,"gstin":null,"gstScheme":"REGULAR","stateCode":"27","address":{"line1":null,"line2":null,"city":null,"pincode":null,"stateCode":"27"},"phoneE164":null,"email":null,"logoUrl":null,"signatureUrl":null,"terms":null}'::jsonb,
      '27', false, 10000 + i, 900, 900, 11800 + i, now()
    from generate_series(1, ${INVOICES}) i`);
  await db.execute(sql`
    insert into invoice_lines (id, business_id, invoice_id, product_id, position, description,
      unit, qty_milli, unit_price_paise, price_includes_tax, rate_bp, taxable_paise, cgst_paise,
      sgst_paise, utgst_paise, igst_paise, line_total_paise)
    select gen_random_uuid(), business_id, id, null, 1, 'Item ' || (taxable_paise % 40), 'NOS',
      1000, taxable_paise, false, 1800, taxable_paise, cgst_paise, sgst_paise, 0, 0,
      grand_total_paise
    from invoices where business_id = ${biz}`);
  await db.execute(sql`
    insert into payments (id, business_id, customer_id, payment_date, amount_paise, mode)
    select gen_random_uuid(), ${biz}, c.id, ${TODAY}::date - (i % 90), 5000, 'CASH'
    from generate_series(1, 2000) i
      join (select row_number() over (order by id) as n, id from customers
            where business_id = ${biz}) c on c.n = 1 + (i % 300)`);
}

describe("dashboard performance (SPEC F8)", () => {
  it(`answers in under 300 ms p95 with ${String(INVOICES)} invoices`, async () => {
    const tenant = await createTenant();
    await seed(tenant);
    if (process.env.DASHBOARD_EXPLAIN === "1") {
      process.stdout.write(`perf business ${tenant.business.id}
`);
    }
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T06:00:00Z`));

    const first = await getDashboard(tenant.ctx);
    expect(first.counts.invoicesThisMonth).toBeGreaterThan(0);
    expect(first.money?.receivablePaise).toBeGreaterThan(0n);

    const times: number[] = [];
    for (let run = 0; run < RUNS; run += 1) {
      const start = performance.now();
      await getDashboard(tenant.ctx);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(RUNS * 0.95) - 1] ?? Number.POSITIVE_INFINITY;
    process.stdout.write(
      `dashboard with ${String(INVOICES)} invoices: median ${times[RUNS / 2]?.toFixed(0) ?? "?"} ms, p95 ${p95.toFixed(0)} ms
`,
    );
    expect(p95).toBeLessThan(300);
  });
});
