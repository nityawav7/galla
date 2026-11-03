import { type Database, getDb } from "./client";

/** A transaction handle; it has the same query API as the database. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Repos accept either, so the caller decides whether a call joins a transaction. */
export type Executor = Database | Transaction;

/**
 * Runs `work` in one database transaction: it commits if `work` resolves and rolls back if it
 * throws. Works on both drivers; Neon's serverless Pool holds a WebSocket connection for the
 * whole transaction, unlike its one-shot HTTP driver.
 *
 * Pass the `tx` to every repo call inside, otherwise that call runs outside the transaction.
 */
export function withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  return getDb().transaction(work);
}
