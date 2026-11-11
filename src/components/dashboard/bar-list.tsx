import Link from "next/link";

/*
 * A top-5 list (products, debtors): each row's name, its value as text, and a bar for scale.
 * The bar is decoration; the text carries the number.
 */

export interface BarItem {
  key: string;
  label: string;
  /** Already formatted for display. */
  value: string;
  /** Raw size, for the bar's width. */
  size: bigint;
  href?: string;
}

export function BarList({
  title,
  items,
  empty,
  testId,
}: {
  title: string;
  items: readonly BarItem[];
  empty: string;
  testId: string;
}) {
  const most = items.reduce((max, item) => (item.size > max ? item.size : max), 0n);
  return (
    <section className="flex flex-col gap-2" aria-label={title} data-testid={testId}>
      <h2 className="text-sm font-medium">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                {item.href ? (
                  <Link href={item.href} className="truncate underline underline-offset-4">
                    {item.label}
                  </Link>
                ) : (
                  <span className="truncate">{item.label}</span>
                )}
                <span className="shrink-0 tabular-nums">{item.value}</span>
              </div>
              <div aria-hidden className="h-1.5 rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${String(most === 0n ? 0 : Number((item.size * 1000n) / most) / 10)}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
