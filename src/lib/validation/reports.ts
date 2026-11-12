import { z } from "zod";

import { REPORT_PRESETS } from "@/server/domain/reports/period";

/*
 * Report periods from the URL (SPEC F8, decision 10 of the Phase 9 plan): a preset, or a custom
 * `from`–`to`. The page falls back to "this month" for anything it can't read; the download routes
 * refuse unknown keys (CLAUDE.md rule 7).
 */

export const REPORT_FORMATS = ["csv", "xlsx"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

const period = {
  preset: z.enum(REPORT_PRESETS).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
};

/** The Reports page: bad values are dropped, never an error page. */
export const reportPageQuerySchema = z.object({
  preset: period.preset.catch(undefined),
  from: period.from.catch(undefined),
  to: period.to.catch(undefined),
});

export const salesRegisterQuerySchema = z.strictObject({
  ...period,
  format: z.enum(REPORT_FORMATS).default("csv"),
});

export const hsnQuerySchema = z.strictObject(period);

export type ReportPeriodQuery = z.output<typeof reportPageQuerySchema>;

/** `?period=2026-11` (a month) or `?period=26-27-Q3` (a quarter) for the GSTR-1 helper. */
export const gstr1QuerySchema = z.strictObject({
  period: z.string().trim().max(10),
});
