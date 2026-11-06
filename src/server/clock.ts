/**
 * The one place services read the time, so a test can set "now" (vi.setSystemTime) and check
 * financial-year and due-date boundaries. The domain never reads the clock (ADR 0002).
 */
export function now(): Date {
  return new Date();
}
