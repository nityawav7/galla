import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { addDays } from "@/server/domain/fy";
import {
  REMINDER_KINDS,
  type ReminderKind,
  reminderKindDue,
  reminderLookbackDays,
  type ReminderStages,
} from "@/server/domain/reminders/schedule";

const STAGES: ReminderStages = { DUE: 0, D1: 1, D7: 7, D14: 14 };
const CATCH_UP = 2;
const DUE = "2026-11-10";

const due = (today: string, sent: readonly ReminderKind[] = [], dueDate: string | null = DUE) =>
  reminderKindDue(
    { dueDate, invoiceDate: "2026-11-01", sent },
    { today, stages: STAGES, catchUpDays: CATCH_UP },
  );

describe("reminderKindDue", () => {
  it.each<[number, ReminderKind | null]>([
    [-1, null],
    [0, "DUE"],
    [1, "D1"],
    [2, "D1"],
    [3, "D1"],
    [4, null],
    [6, null],
    [7, "D7"],
    [9, "D7"],
    [10, null],
    [14, "D14"],
    [16, "D14"],
    [17, null],
    [90, null],
  ])("%i days after the due date → %s (nothing sent yet)", (days, kind) => {
    expect(due(addDays(DUE, days))).toBe(kind);
  });

  it("never sends a stage twice, and never an earlier stage after a later one", () => {
    expect(due(addDays(DUE, 1), ["D1"])).toBeNull();
    expect(due(addDays(DUE, 2), ["DUE", "D1"])).toBeNull();
    // DUE went out; D1 is still owed the next day.
    expect(due(addDays(DUE, 1), ["DUE"])).toBe("D1");
    // D1 went out on day 2 (DUE was missed); day 2's DUE window must not bring DUE back.
    expect(due(addDays(DUE, 2), ["D1"])).toBeNull();
    expect(due(addDays(DUE, 8), ["D7"])).toBeNull();
  });

  it("catches a missed day up to 2 days late", () => {
    // No run on the due date: the next day sends D1 (the latest stage reached), not DUE.
    expect(due(addDays(DUE, 1))).toBe("D1");
    // Runs missed on days 7 and 8: day 9 still sends D7.
    expect(due(addDays(DUE, 9), ["DUE", "D1"])).toBe("D7");
  });

  it.each([null, "2026-11-01"])(
    "counts from the invoice date when due on receipt (%s), with no 'due today'",
    (dueDate) => {
      expect(due("2026-11-01", [], dueDate)).toBeNull();
      expect(due("2026-11-02", [], dueDate)).toBe("D1");
      expect(due("2026-11-08", ["D1"], dueDate)).toBe("D7");
    },
  );

  it("looks back as far as the last stage plus the catch-up", () => {
    expect(reminderLookbackDays({ stages: STAGES, catchUpDays: CATCH_UP })).toBe(16);
  });

  it("over any run of days with some missed, sends each stage at most once, in order", () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 20, maxLength: 20 }),
        fc.option(fc.constant(DUE)),
        (ran, dueDate) => {
          const sent: ReminderKind[] = [];
          ran.forEach((didRun, day) => {
            if (!didRun) return;
            const kind = due(addDays("2026-11-08", day), sent, dueDate);
            if (kind) sent.push(kind);
          });
          expect(new Set(sent).size).toBe(sent.length);
          const order = sent.map((kind) => REMINDER_KINDS.indexOf(kind));
          expect(order).toEqual([...order].sort((a, b) => a - b));
        },
      ),
    );
  });

  it("sends every stage when the job runs every day", () => {
    const sent: ReminderKind[] = [];
    for (let day = -2; day <= 20; day += 1) {
      const kind = due(addDays(DUE, day), sent);
      if (kind) sent.push(kind);
    }
    expect(sent).toEqual(["DUE", "D1", "D7", "D14"]);
  });
});
