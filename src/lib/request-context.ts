import { AsyncLocalStorage } from "node:async_hooks";

/**
 * What every log line of one request carries (SPEC §6.4): the request id from the proxy and,
 * once known, the business. Ids only, never PII (CLAUDE.md rule 9).
 */
export interface RequestContext {
  requestId: string;
  businessId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `work` with this request's context; the logger adds it to every line. */
export function withRequestContext<T>(context: RequestContext, work: () => T): T {
  return storage.run({ ...context }, work);
}

export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Records the business once a request has resolved it (no-op outside a request context). */
export function setRequestBusiness(businessId: string): void {
  const store = storage.getStore();
  if (store) store.businessId = businessId;
}
