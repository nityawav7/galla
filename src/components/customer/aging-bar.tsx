import { getTranslations } from "next-intl/server";

import { AGING_LIMITS } from "@/lib/config";
import { cn } from "@/lib/utils";
import { type Aging } from "@/server/domain/ledger/aging";
import { formatINR } from "@/server/domain/money";

/*
 * What is due and how late (SPEC §4.9): a bar of the parts (decoration only) and the same parts
 * as a list with amounts, so nothing relies on colour. Opening balance and advance sit beside the
 * buckets so the parts add up to the balance.
 */

const BAR_COLOURS = [
  "bg-muted-foreground/40",
  "bg-amber-400",
  "bg-orange-500",
  "bg-red-500",
  "bg-red-700",
];

export async function AgingBar({ aging }: { aging: Aging }) {
  const t = await getTranslations("customers.ledger.aging");
  const [first, second, third] = AGING_LIMITS;
  const parts: { key: string; label: string; paise: bigint }[] = [
    { key: "notDue", label: t("notDue"), paise: aging.notDuePaise },
    {
      key: "b0",
      label: t("bucket", { from: "0", to: String(first) }),
      paise: aging.pastDuePaise[0],
    },
    {
      key: "b1",
      label: t("bucket", { from: String(first + 1), to: String(second) }),
      paise: aging.pastDuePaise[1],
    },
    {
      key: "b2",
      label: t("bucket", { from: String(second + 1), to: String(third) }),
      paise: aging.pastDuePaise[2],
    },
    { key: "b3", label: t("over", { days: String(third) }), paise: aging.pastDuePaise[3] },
  ];
  const owed = parts.reduce((sum, part) => sum + part.paise, 0n);

  return (
    <div className="flex flex-col gap-2 md:max-w-md" data-testid="aging">
      <h3 className="text-sm font-medium">{t("title")}</h3>
      {owed > 0n ? (
        <div aria-hidden className="flex h-2.5 overflow-hidden rounded-full bg-muted">
          {parts.map((part, index) =>
            part.paise > 0n ? (
              <div
                key={part.key}
                className={cn("h-full", BAR_COLOURS[index])}
                style={{ width: `${String(Number((part.paise * 1000n) / owed) / 10)}%` }}
              />
            ) : null,
          )}
        </div>
      ) : null}
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {parts.map((part, index) => (
          <div key={part.key} className="contents">
            <dt className="flex items-center gap-2">
              <span aria-hidden className={cn("size-2.5 rounded-full", BAR_COLOURS[index])} />
              {part.label}
            </dt>
            <dd className="text-right tabular-nums">{formatINR(part.paise)}</dd>
          </div>
        ))}
        {aging.openingPaise > 0n ? (
          <div className="contents">
            <dt>{t("opening")}</dt>
            <dd className="text-right tabular-nums">{formatINR(aging.openingPaise)}</dd>
          </div>
        ) : null}
        {aging.onAccountPaise > 0n ? (
          <div className="contents">
            <dt>{t("onAccount")}</dt>
            <dd className="text-right tabular-nums">−{formatINR(aging.onAccountPaise)}</dd>
          </div>
        ) : null}
        <div className="contents font-medium">
          <dt className="border-t pt-1">{t("total")}</dt>
          <dd className="border-t pt-1 text-right tabular-nums">{formatINR(aging.totalPaise)}</dd>
        </div>
      </dl>
    </div>
  );
}
