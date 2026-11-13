import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The one place services read the time, so a test can set "now" (vi.setSystemTime) and check
 * financial-year and due-date boundaries. The domain never reads the clock (ADR 0002).
 *
 * `atTime` runs work as if it were a given moment: the demo reset replays six months of a
 * shop through the real services, day by day (ADR 0018). Only that work sees the moved clock;
 * every other request, even one running at the same time, reads the real time.
 */
const replayed = new AsyncLocalStorage<Date>();

export function now(): Date {
  const at = replayed.getStore();
  return at ? new Date(at.getTime()) : new Date();
}

export function atTime<T>(instant: Date, work: () => Promise<T>): Promise<T> {
  return replayed.run(new Date(instant.getTime()), work);
}
