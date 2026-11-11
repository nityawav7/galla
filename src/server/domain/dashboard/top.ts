/** One candidate for a "top 5" list: products by sales, customers by what they owe. */
export interface Ranked {
  key: string;
  label: string;
  value: bigint;
}

/**
 * The `n` biggest positive values, biggest first. Ties go by label, then key, so the list doesn't
 * reshuffle between page loads.
 */
export function topN<T extends Ranked>(items: readonly T[], n: number): T[] {
  return items
    .filter((item) => item.value > 0n)
    .sort(
      (a, b) =>
        (a.value === b.value ? 0 : a.value > b.value ? -1 : 1) ||
        a.label.localeCompare(b.label, "en") ||
        a.key.localeCompare(b.key, "en"),
    )
    .slice(0, n);
}
