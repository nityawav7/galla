/**
 * What happens in the demo shop over the last six months, as a list of events (SPEC F12,
 * ADR 0018). Deterministic: the same seed and the same "today" give the same plan, so the demo
 * looks the same after every reset and tests can rely on it. Dates are relative to today, so it
 * never goes stale.
 *
 * The plan only says what happens ("Mehta Constructions buys 3 of product 12", "pays half of
 * what they owe"). The reset replays it through the real services, which compute every
 * total, tax, number, allocation and status, exactly as when a person uses the app.
 */
import { faker } from "@faker-js/faker/locale/en_IN";

import { addDays } from "@/server/domain/fy";
import { gstinCheckCharacter } from "@/server/domain/gstin";

import { DEMO_PRODUCTS } from "./catalog";

export const DEMO_SEED = 20261113;
export const DEMO_MONTHS_DAYS = 182;

export type DemoRole = "OWNER" | "STAFF";
export type DemoPaymentMode = "CASH" | "UPI" | "BANK_TRANSFER" | "CHEQUE" | "CARD";

export interface DemoCustomer {
  name: string;
  gstin: string | null;
  addressLine1: string;
  city: string;
  pincode: string;
  stateCode: string;
  creditDays: number;
  /** How this customer pays (decides the payment events). */
  habit: "prompt" | "slow" | "neverPays";
}

export interface DemoLine {
  /** Index into DEMO_PRODUCTS. */
  product: number;
  qty: string;
}

export type DemoEvent =
  | {
      kind: "invoice";
      /** Index of this invoice in issue order: later events refer to it. */
      invoice: number;
      /** Index into customers, or null for a walk-in sale. */
      customer: number | null;
      walkInName: string;
      lines: DemoLine[];
      by: DemoRole;
    }
  /** A walk-in sale paid in full at the counter. */
  | { kind: "counterPayment"; invoice: number; mode: DemoPaymentMode; by: DemoRole }
  /** A customer pays a share of what they owe, oldest invoices first. */
  | {
      kind: "payment";
      customer: number;
      share: "all" | "half";
      mode: DemoPaymentMode;
      by: DemoRole;
    }
  | { kind: "cancel"; invoice: number; reason: string }
  /** One unit of one line comes back. */
  | { kind: "creditNote"; invoice: number; line: number; reason: string };

export interface DemoDay {
  /** ISO business date (Asia/Kolkata). */
  date: string;
  events: DemoEvent[];
}

export interface DemoPlan {
  customers: DemoCustomer[];
  days: DemoDay[];
}

/** mulberry32: a tiny seeded generator, so the plan doesn't depend on Math.random. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Picker {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (probability: number) => boolean;
}

function picker(seed: number): Picker {
  const next = seededRandom(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (items) => {
      const item = items[Math.floor(next() * items.length)];
      if (item === undefined) throw new Error("pick from an empty list");
      return item;
    },
    chance: (probability) => next() < probability,
  };
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** A fictional GSTIN with a valid check character. PANs start with "ZZ" to mark them made up. */
export function demoGstin(stateCode: string, panBody: string): string {
  const body = `${stateCode}${panBody}1Z`;
  return `${body}${gstinCheckCharacter(body)}`;
}

function fictionalPan(random: Picker, entity: string): string {
  const letter = () => LETTERS.charAt(random.int(0, LETTERS.length - 1));
  const digits = String(random.int(1000, 9999));
  return `ZZ${letter()}${entity}${letter()}${digits}${letter()}`;
}

const PUNE_AREAS = [
  { city: "Pune", pincode: "411001", area: "Camp" },
  { city: "Pune", pincode: "411030", area: "Sadashiv Peth" },
  { city: "Pune", pincode: "411028", area: "Hadapsar" },
  { city: "Pune", pincode: "411057", area: "Wakad" },
  { city: "Pune", pincode: "411041", area: "Dhayari" },
  { city: "Pimpri-Chinchwad", pincode: "411018", area: "Pimpri" },
] as const;

/** Business customers in other states make some invoices inter-state (IGST). */
const OTHER_STATES = [
  { stateCode: "24", city: "Ahmedabad", pincode: "380009" },
  { stateCode: "29", city: "Bengaluru", pincode: "560068" },
  { stateCode: "30", city: "Panaji", pincode: "403001" },
  { stateCode: "36", city: "Hyderabad", pincode: "500081" },
  { stateCode: "23", city: "Indore", pincode: "452010" },
] as const;

const TRADE_SUFFIXES = [
  "Constructions",
  "Builders",
  "Interiors",
  "Enterprises",
  "Plumbing Works",
  "Electricals",
  "Developers",
  "Contractors",
] as const;

const CANCEL_REASONS = ["Entered twice by mistake", "Customer changed the order"] as const;
const RETURN_REASONS = [
  "Damaged in transit",
  "Wrong size supplied",
  "Customer returned unused item",
] as const;

function demoCustomers(random: Picker): DemoCustomer[] {
  const customers: DemoCustomer[] = [];
  // 40 businesses with a GSTIN: 30 in Maharashtra, 10 in other states.
  for (let index = 0; index < 40; index += 1) {
    const outside = index >= 30 ? OTHER_STATES[index % OTHER_STATES.length] : undefined;
    const area = random.pick(PUNE_AREAS);
    const stateCode = outside?.stateCode ?? "27";
    customers.push({
      name: `${faker.person.lastName()} ${random.pick(TRADE_SUFFIXES)}`,
      gstin: demoGstin(stateCode, fictionalPan(random, random.pick(["F", "C", "P"]))),
      addressLine1: `${String(random.int(1, 240))}, ${outside ? "Industrial Area" : area.area}`,
      city: outside?.city ?? area.city,
      pincode: outside?.pincode ?? area.pincode,
      stateCode,
      creditDays: random.pick([15, 30, 30, 45]),
      habit: random.chance(0.7) ? "prompt" : "slow",
    });
  }
  // 80 regular retail customers on credit (udhaar), no GSTIN.
  for (let index = 0; index < 80; index += 1) {
    const area = random.pick(PUNE_AREAS);
    customers.push({
      name: faker.person.fullName(),
      gstin: null,
      addressLine1: `${String(random.int(1, 400))}, ${area.area}`,
      city: area.city,
      pincode: area.pincode,
      stateCode: "27",
      creditDays: random.pick([7, 15, 15, 30]),
      habit: random.chance(0.6) ? "prompt" : random.chance(0.6) ? "slow" : "neverPays",
    });
  }
  return customers;
}

/** Integer quantities for counted units, a decimal now and then for kilos and litres. */
function quantity(random: Picker, product: number): string {
  const unit = DEMO_PRODUCTS[product]?.unit;
  if (unit === "KGS" || unit === "LTR") {
    return random.pick(["1", "2", "2.5", "5", "10"]);
  }
  if (unit === "BAG") return random.pick(["2", "5", "10", "20"]);
  return random.pick(["1", "1", "2", "3", "4", "6", "10"]);
}

function invoiceLines(random: Picker, business: boolean): DemoLine[] {
  const count = business ? random.int(2, 6) : random.int(1, 3);
  const products = new Set<number>();
  while (products.size < count) products.add(random.int(0, DEMO_PRODUCTS.length - 1));
  return [...products].map((product) => ({ product, qty: quantity(random, product) }));
}

/**
 * The plan for the six months before `today` (exclusive), shop days only (closed on Sundays).
 */
export function demoPlan(today: string, seed = DEMO_SEED): DemoPlan {
  faker.seed(seed);
  const random = picker(seed);
  const customers = demoCustomers(random);
  const businessCustomers = customers.flatMap((customer, index) => (customer.gstin ? [index] : []));
  const retailCustomers = customers.flatMap((customer, index) => (customer.gstin ? [] : [index]));

  const days: DemoDay[] = [];
  let invoiceCount = 0;
  /** Invoices with a line of 2 or more, for returns: [invoice, line]. */
  const returnable: { invoice: number; line: number; customer: number | null }[] = [];
  const pendingReturns = new Map<string, DemoEvent[]>();

  for (let offset = DEMO_MONTHS_DAYS; offset >= 1; offset -= 1) {
    const date = addDays(today, -offset);
    if (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) continue;
    const events: DemoEvent[] = [];

    // Mornings: customers settle up, by habit, on about one shop day in 16 each.
    for (const index of [...businessCustomers, ...retailCustomers]) {
      const customer = customers[index];
      if (!customer || customer.habit === "neverPays" || !random.chance(0.06)) continue;
      events.push({
        kind: "payment",
        customer: index,
        share: customer.habit === "prompt" ? "all" : "half",
        mode: customer.gstin
          ? random.pick(["BANK_TRANSFER", "BANK_TRANSFER", "CHEQUE", "UPI"] as const)
          : random.pick(["UPI", "UPI", "CASH"] as const),
        by: random.pick(["OWNER", "STAFF"] as const),
      });
    }

    // Returns that were planned for today.
    events.push(...(pendingReturns.get(date) ?? []));

    // The day's sales: 2 to 5 invoices.
    const sales = random.int(2, 5);
    for (let sale = 0; sale < sales; sale += 1) {
      const roll = random.next();
      const customer =
        roll < 0.35
          ? null
          : roll < 0.6
            ? random.pick(businessCustomers)
            : random.pick(retailCustomers);
      const lines = invoiceLines(random, customer !== null && businessCustomers.includes(customer));
      const invoice = invoiceCount;
      invoiceCount += 1;
      const by = random.pick(["OWNER", "STAFF", "STAFF"] as const);
      events.push({
        kind: "invoice",
        invoice,
        customer,
        walkInName: customer === null && random.chance(0.4) ? faker.person.fullName() : "",
        lines,
        by,
      });
      if (customer === null) {
        events.push({
          kind: "counterPayment",
          invoice,
          mode: random.pick(["CASH", "CASH", "UPI", "UPI", "CARD"] as const),
          by,
        });
      } else if (random.chance(0.007)) {
        events.push({ kind: "cancel", invoice, reason: random.pick(CANCEL_REASONS) });
        continue;
      }
      lines.forEach((line, index) => {
        if (Number(line.qty) >= 2) returnable.push({ invoice, line: index, customer });
      });
    }

    // Now and then, something comes back a few days later.
    if (returnable.length > 0 && random.chance(0.1)) {
      const pickedIndex = random.int(0, returnable.length - 1);
      // Each line comes back at most once, so a return never exceeds what was sold.
      const [choice] = returnable.splice(pickedIndex, 1);
      if (!choice) throw new Error("returnable list changed while picking");
      const when = addDays(date, random.int(1, 6));
      if (when < today) {
        const list = pendingReturns.get(when) ?? [];
        list.push({
          kind: "creditNote",
          invoice: choice.invoice,
          line: choice.line,
          reason: random.pick(RETURN_REASONS),
        });
        pendingReturns.set(when, list);
      }
    }

    days.push({ date, events });
  }
  return { customers, days };
}
