/**
 * Credit notes by returned quantity (SPEC §4.8, ADR 0007). A credit note line credits part of
 * one issued invoice line, at that line's own price, discount, rate and tax split: nothing is
 * recalculated from scratch, so the taxes always match what was charged.
 *
 * For a line of quantity Q, the amounts credited once `c` units are back are
 * F(c) = each stored amount × c / Q, rounded half up. A return of `q` more units credits
 * F(before + q) − F(before). F(Q) is exactly the stored line, so any series of returns adds up
 * to the line to the paisa, and equal CGST/SGST halves stay equal.
 */

import { ValidationError } from "@/lib/errors";

import { divRoundHalfUp, sumPaise } from "../money";

/** The stored amounts of an issued invoice line. */
export interface CreditableLine {
  qtyMilli: bigint;
  discountPaise: bigint;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
  lineTotalPaise: bigint;
}

export interface LineCredit {
  discountPaise: bigint;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
  totalPaise: bigint;
}

export interface CreditNoteTotals {
  discountPaise: bigint;
  taxablePaise: bigint;
  cgstPaise: bigint;
  sgstPaise: bigint;
  utgstPaise: bigint;
  igstPaise: bigint;
  roundOffPaise: bigint;
  grandTotalPaise: bigint;
}

function invalid(message: string): ValidationError {
  return new ValidationError("Check the quantity returned", [{ path: "qty", message }]);
}

/** F(c): what is credited once `returnedMilli` of the line's units are back. */
function creditedAt(line: CreditableLine, returnedMilli: bigint): Omit<LineCredit, "totalPaise"> {
  const part = (amount: bigint) => divRoundHalfUp(amount * returnedMilli, line.qtyMilli);
  return {
    discountPaise: part(line.discountPaise),
    taxablePaise: part(line.taxablePaise),
    cgstPaise: part(line.cgstPaise),
    sgstPaise: part(line.sgstPaise),
    utgstPaise: part(line.utgstPaise),
    igstPaise: part(line.igstPaise),
  };
}

/** The credit for returning `qtyMilli` more units, after `returnedMilli` already credited. */
export function creditForReturn(
  line: CreditableLine,
  returnedMilli: bigint,
  qtyMilli: bigint,
): LineCredit {
  if (qtyMilli <= 0n) throw invalid("qtyPositive");
  if (returnedMilli < 0n || returnedMilli + qtyMilli > line.qtyMilli) {
    throw invalid("returnTooMany");
  }
  const before = creditedAt(line, returnedMilli);
  const after = creditedAt(line, returnedMilli + qtyMilli);
  const credit = {
    discountPaise: after.discountPaise - before.discountPaise,
    taxablePaise: after.taxablePaise - before.taxablePaise,
    cgstPaise: after.cgstPaise - before.cgstPaise,
    sgstPaise: after.sgstPaise - before.sgstPaise,
    utgstPaise: after.utgstPaise - before.utgstPaise,
    igstPaise: after.igstPaise - before.igstPaise,
  };
  return {
    ...credit,
    totalPaise:
      credit.taxablePaise +
      credit.cgstPaise +
      credit.sgstPaise +
      credit.utgstPaise +
      credit.igstPaise,
  };
}

/**
 * Totals are sums of the credit lines. Only the credit note that returns the last unit of the
 * invoice carries the invoice's round-off (`completingRoundOffPaise`), so all the credit notes
 * of a fully returned invoice add up to its grand total exactly. Others have none (null).
 */
export function creditNoteTotals(
  lines: readonly LineCredit[],
  completingRoundOffPaise: bigint | null,
): CreditNoteTotals {
  const sum = (pick: (credit: LineCredit) => bigint) => sumPaise(lines.map(pick));
  const roundOffPaise = completingRoundOffPaise ?? 0n;
  return {
    discountPaise: sum((credit) => credit.discountPaise),
    taxablePaise: sum((credit) => credit.taxablePaise),
    cgstPaise: sum((credit) => credit.cgstPaise),
    sgstPaise: sum((credit) => credit.sgstPaise),
    utgstPaise: sum((credit) => credit.utgstPaise),
    igstPaise: sum((credit) => credit.igstPaise),
    roundOffPaise,
    grandTotalPaise: sum((credit) => credit.totalPaise) + roundOffPaise,
  };
}
