/**
 * GST state codes (SPEC §4.2). This table is the source for the `states` reference
 * table seed. Verify against the GST portal's state code list before launch; the
 * entries marked "verify" in docs/golden-fixtures.md are the uncertain ones.
 */

import { ValidationError } from "@/lib/errors";

export interface GstState {
  /** Two-digit GST state code, the first two characters of a GSTIN. */
  code: string;
  name: string;
  /** UTs without a legislature charge UTGST instead of SGST on intra-state supplies. */
  isUtWithoutLegislature: boolean;
  /** Inactive codes are kept so old documents still render, but cannot be chosen. */
  active: boolean;
}

function state(
  code: string,
  name: string,
  isUtWithoutLegislature = false,
  active = true,
): GstState {
  return { code, name, isUtWithoutLegislature, active };
}

export const GST_STATES: readonly GstState[] = [
  state("01", "Jammu and Kashmir"),
  state("02", "Himachal Pradesh"),
  state("03", "Punjab"),
  state("04", "Chandigarh", true),
  state("05", "Uttarakhand"),
  state("06", "Haryana"),
  state("07", "Delhi"),
  state("08", "Rajasthan"),
  state("09", "Uttar Pradesh"),
  state("10", "Bihar"),
  state("11", "Sikkim"),
  state("12", "Arunachal Pradesh"),
  state("13", "Nagaland"),
  state("14", "Manipur"),
  state("15", "Mizoram"),
  state("16", "Tripura"),
  state("17", "Meghalaya"),
  state("18", "Assam"),
  state("19", "West Bengal"),
  state("20", "Jharkhand"),
  state("21", "Odisha"),
  state("22", "Chhattisgarh"),
  state("23", "Madhya Pradesh"),
  state("24", "Gujarat"),
  // Merged into 26 in January 2020.
  state("25", "Daman and Diu (before 2020)", true, false),
  state("26", "Dadra and Nagar Haveli and Daman and Diu", true),
  state("27", "Maharashtra"),
  // Undivided Andhra Pradesh; registrations moved to 37 after 2014.
  state("28", "Andhra Pradesh (before 2014)", false, false),
  state("29", "Karnataka"),
  state("30", "Goa"),
  state("31", "Lakshadweep", true),
  state("32", "Kerala"),
  state("33", "Tamil Nadu"),
  state("34", "Puducherry"),
  state("35", "Andaman and Nicobar Islands", true),
  state("36", "Telangana"),
  state("37", "Andhra Pradesh"),
  state("38", "Ladakh", true),
  // Verify: assumed to be treated like a UT without legislature.
  state("97", "Other Territory", true),
];

const BY_CODE = new Map(GST_STATES.map((entry) => [entry.code, entry]));

export function findState(code: string): GstState | undefined {
  return BY_CODE.get(code);
}

export function isActiveStateCode(code: string): boolean {
  return findState(code)?.active === true;
}

export function getActiveState(code: string): GstState {
  const found = findState(code);
  if (!found?.active) {
    throw new ValidationError("Choose a valid state", [
      { path: "stateCode", message: "Unknown state" },
    ]);
  }
  return found;
}
