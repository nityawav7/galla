import { expect, it } from "vitest";

import { NotFoundError } from "@/lib/errors";

import { createTenant, type Tenant } from "./tenants";

/**
 * One cross-tenant attempt (SPEC §6.2, ADR 0003). The helper creates two businesses:
 * `arrange` creates data as the owner, `act` then runs the operation under test as a user of
 * the other business, aimed at the owner's data.
 */
export interface IsolationCase<T> {
  arrange: (owner: Tenant) => Promise<T>;
  act: (intruder: Tenant, arranged: T, owner: Tenant) => Promise<unknown>;
  /** Optional check that the owner's data is unchanged afterwards (for writes). */
  verify?: (owner: Tenant, arranged: T) => Promise<void>;
}

/** Ids of the owner's data that must never appear in what the intruder gets back. */
function ownerIds(owner: Tenant, arranged: unknown): string[] {
  const ids = [owner.business.id];
  if (typeof arranged === "string") ids.push(arranged);
  if (typeof arranged === "object" && arranged !== null && "id" in arranged) {
    const { id } = arranged;
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === "bigint" ? inner.toString() : inner,
  );
}

/**
 * Passes when the intruder gets "not found": a `NotFoundError`, or a result (undefined, null,
 * an empty list, the intruder's own data) that mentions none of the owner's ids.
 */
export async function expectTenantIsolation<T>(testCase: IsolationCase<T>): Promise<void> {
  const owner = await createTenant();
  const intruder = await createTenant();
  const arranged = await testCase.arrange(owner);

  let result: unknown;
  try {
    result = await testCase.act(intruder, arranged, owner);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }

  if (result !== undefined) {
    const leaked = ownerIds(owner, arranged).filter((id) => serialize(result).includes(id));
    expect(leaked, "another business's data leaked to the intruder").toEqual([]);
  }
  await testCase.verify?.(owner, arranged);
}

/** Wraps a case so cases with different `arranged` types fit in one table. */
export function isolationCase<T>(testCase: IsolationCase<T>): () => Promise<void> {
  return () => expectTenantIsolation(testCase);
}

/** Registers one test per case, named "<operation>: different business → not found". */
export function itIsolatesTenants(cases: Record<string, () => Promise<void>>): void {
  for (const [name, run] of Object.entries(cases)) {
    it(`${name}: different business → not found`, run);
  }
}
