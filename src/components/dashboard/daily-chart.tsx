import { getTranslations } from "next-intl/server";

import { type DayValue } from "@/server/domain/dashboard/series";
import { formatIndianDate } from "@/server/domain/fy";
import { formatINR } from "@/server/domain/money";

/*
 * Net sales per day as SVG bars (decision 2 of the Phase 9 plan): no chart library, nothing to
 * download on a phone, and the same numbers as a table for screen readers. A day with more
 * credited than sold dips below the line.
 */

const WIDTH = 300;
const HEIGHT = 120;
const GAP = 2;

export async function DailyChart({ days }: { days: readonly DayValue[] }) {
  const t = await getTranslations("dashboard.charts");
  const most = days.reduce((max, day) => {
    const size = day.valuePaise < 0n ? -day.valuePaise : day.valuePaise;
    return size > max ? size : max;
  }, 0n);
  const negative = days.some((day) => day.valuePaise < 0n);
  // Where zero sits: the bottom, or a little above it when some day is negative.
  const baseline = negative ? HEIGHT * 0.75 : HEIGHT;
  const scale = (paise: bigint) =>
    most === 0n ? 0 : (Number((paise * 1000n) / most) / 1000) * (negative ? HEIGHT * 0.75 : HEIGHT);
  const bar = WIDTH / Math.max(days.length, 1);
  const first = days[0];
  const last = days.at(-1);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">{t("daily")}</figcaption>
      <svg
        viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
        className="h-32 w-full"
        preserveAspectRatio="none"
        aria-hidden
      >
        {days.map((day, index) => {
          const height = scale(day.valuePaise < 0n ? -day.valuePaise : day.valuePaise);
          return (
            <rect
              key={day.date}
              x={index * bar + GAP / 2}
              y={day.valuePaise < 0n ? baseline : baseline - height}
              width={Math.max(bar - GAP, 1)}
              height={height}
              className={day.valuePaise < 0n ? "fill-destructive" : "fill-primary"}
            />
          );
        })}
        <line x1={0} x2={WIDTH} y1={baseline} y2={baseline} className="stroke-border" />
      </svg>
      {first && last ? (
        <div aria-hidden className="flex justify-between text-xs text-muted-foreground">
          <span>{formatIndianDate(first.date)}</span>
          <span>{formatIndianDate(last.date)}</span>
        </div>
      ) : null}
      <table className="sr-only">
        <caption>{t("daily")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("date")}</th>
            <th scope="col">{t("amount")}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <td>{formatIndianDate(day.date)}</td>
              <td>{formatINR(day.valuePaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
