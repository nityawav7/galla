// Drizzle table definitions (SPEC §7.4). Better Auth's tables arrive in Phase 4.
export * from "./audit";
export * from "./businesses";
export * from "./catalog";
export * from "./credit-notes";
export * from "./invoices";
export * from "./notifications";
export * from "./payments";
export * from "./reference";
export type { AddressSnapshot, CustomerSnapshot } from "./document-columns";
