import { describe, expect, it } from "vitest";

import { DEMO_BUSINESS, DEMO_PRODUCTS, DEMO_RATE_BP } from "@/server/demo/catalog";
import { DEMO_MONTHS_DAYS, type DemoEvent, demoGstin, demoPlan } from "@/server/demo/plan";
import { addDays } from "@/server/domain/fy";
import { isValidGstin, stateFromGstin } from "@/server/domain/gstin";

const TODAY = "2026-11-13";
const plan = demoPlan(TODAY);
const events = plan.days.flatMap((day) => day.events.map((event) => ({ date: day.date, event })));
const ofKind = <K extends DemoEvent["kind"]>(kind: K) =>
  events.flatMap(({ date, event }) =>
    event.kind === kind ? [{ date, event: event as Extract<DemoEvent, { kind: K }> }] : [],
  );

describe("the demo catalogue", () => {
  it("has 60 products with unique SKUs, 4-digit HSN headings and the 18% rate", () => {
    expect(DEMO_PRODUCTS).toHaveLength(60);
    expect(new Set(DEMO_PRODUCTS.map((product) => product.sku)).size).toBe(60);
    for (const product of DEMO_PRODUCTS) expect(product.hsnSac).toMatch(/^\d{4}$/);
    expect(DEMO_RATE_BP).toBe(1800);
  });

  it("gives the shop a valid, fictional Maharashtra GSTIN", () => {
    const gstin = demoGstin(DEMO_BUSINESS.stateCode, DEMO_BUSINESS.panBody);
    expect(isValidGstin(gstin)).toBe(true);
    expect(gstin.slice(2, 4)).toBe("ZZ");
  });
});

describe("demoPlan", () => {
  it("is the same for the same day and seed, and different for another seed", () => {
    expect(demoPlan(TODAY)).toEqual(plan);
    expect(demoPlan(TODAY, 7)).not.toEqual(plan);
  });

  it("moves with today: the same shop, six months back from yesterday", () => {
    const later = demoPlan("2026-11-20");
    expect(later.customers).toEqual(plan.customers);
    const dates = plan.days.map((day) => day.date);
    expect(dates.every((date) => date < TODAY && date >= addDays(TODAY, -DEMO_MONTHS_DAYS))).toBe(
      true,
    );
    expect(dates.toSorted()).toEqual(dates);
    // Closed on Sundays.
    for (const date of dates) expect(new Date(`${date}T00:00:00Z`).getUTCDay()).not.toBe(0);
  });

  it("has 120 customers: 40 businesses (10 in other states) and 80 retail, no phones or emails", () => {
    expect(plan.customers).toHaveLength(120);
    const businesses = plan.customers.filter((customer) => customer.gstin);
    expect(businesses).toHaveLength(40);
    for (const customer of businesses) {
      const gstin = customer.gstin ?? "";
      expect(isValidGstin(gstin)).toBe(true);
      expect(stateFromGstin(gstin)).toBe(customer.stateCode);
      expect(gstin.slice(2, 4)).toBe("ZZ");
    }
    expect(businesses.filter((customer) => customer.stateCode !== "27")).toHaveLength(10);
    for (const customer of plan.customers) {
      expect(Object.keys(customer)).not.toContain("phone");
      expect(Object.keys(customer)).not.toContain("email");
    }
    expect(plan.customers.some((customer) => customer.habit === "neverPays")).toBe(true);
  });

  it("issues about 600 invoices, a third walk-in, each paid at the counter", () => {
    const invoices = ofKind("invoice");
    expect(invoices.length).toBeGreaterThan(450);
    expect(invoices.length).toBeLessThan(700);
    expect(invoices.map(({ event }) => event.invoice)).toEqual(invoices.map((_, index) => index));
    const walkIns = invoices.filter(({ event }) => event.customer === null);
    expect(walkIns.length / invoices.length).toBeGreaterThan(0.25);
    expect(walkIns.length / invoices.length).toBeLessThan(0.45);
    const counter = new Set(ofKind("counterPayment").map(({ event }) => event.invoice));
    for (const { event } of walkIns) expect(counter.has(event.invoice)).toBe(true);
    for (const { event } of invoices) {
      expect(event.lines.length).toBeGreaterThan(0);
      for (const line of event.lines) {
        expect(DEMO_PRODUCTS[line.product]).toBeDefined();
        expect(Number(line.qty)).toBeGreaterThan(0);
      }
    }
  });

  it("returns only lines sold earlier, at most once each, and never on a cancelled invoice", () => {
    const issued = new Map(
      ofKind("invoice").map(({ date, event }) => [event.invoice, { date, event }]),
    );
    const cancelled = new Set(ofKind("cancel").map(({ event }) => event.invoice));
    const returns = ofKind("creditNote");
    expect(returns.length).toBeGreaterThan(5);
    expect(returns.length).toBeLessThan(40);
    const seen = new Set<string>();
    for (const { date, event } of returns) {
      const sale = issued.get(event.invoice);
      expect(sale).toBeDefined();
      expect(date > (sale?.date ?? "")).toBe(true);
      expect(cancelled.has(event.invoice)).toBe(false);
      expect(Number(sale?.event.lines[event.line]?.qty)).toBeGreaterThanOrEqual(2);
      const key = `${String(event.invoice)}:${String(event.line)}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("cancels a few customer invoices, and has customers settle up by habit", () => {
    const cancels = ofKind("cancel");
    const invoices = new Map(ofKind("invoice").map(({ event }) => [event.invoice, event]));
    for (const { event } of cancels) expect(invoices.get(event.invoice)?.customer).not.toBeNull();
    const payments = ofKind("payment");
    expect(payments.length).toBeGreaterThan(400);
    for (const { event } of payments) {
      const customer = plan.customers[event.customer];
      expect(customer?.habit).not.toBe("neverPays");
      expect(event.share).toBe(customer?.habit === "prompt" ? "all" : "half");
    }
  });
});
