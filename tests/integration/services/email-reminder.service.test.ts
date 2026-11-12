import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { closeDb, getDb } from "@/server/db/client";
import { remindersSent } from "@/server/db/schema";
import type * as email from "@/server/notifications/email";
import { clearTestOutbox, readTestOutbox } from "@/server/notifications/email";
import { cancelInvoice } from "@/server/services/credit-note.service";
import { sendDueReminders } from "@/server/services/email-reminder.service";
import { recordPayment } from "@/server/services/payment.service";
import { revokePublicLink } from "@/server/services/public-link.service";

import { customer, day, invoice, shop } from "../support/daily-job";
import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";

const sending = vi.hoisted(() => ({ fail: false }));

// The real sender (test outbox), unless a test makes it fail.
vi.mock("@/server/notifications/email", async (importOriginal) => {
  const actual = await importOriginal<typeof email>();
  return {
    ...actual,
    sendEmail: (message: email.Email, sender: email.EmailSender) =>
      sending.fail
        ? Promise.reject(new Error("Resend is down"))
        : actual.sendEmail(message, sender),
  };
});

afterAll(async () => {
  await closeDb();
});

beforeEach(() => {
  clearTestOutbox();
  sending.fail = false;
});

const sentTo = (address: string | null) => readTestOutbox().filter((sent) => sent.to === address);

async function reminderRows(invoiceId: string) {
  return getDb()
    .select()
    .from(remindersSent)
    .where(and(eq(remindersSent.invoiceId, invoiceId), eq(remindersSent.channel, "EMAIL")));
}

describe("sendDueReminders", () => {
  it("emails each stage once: due today, then 1, 7 and 14 days overdue (decision 7)", async () => {
    const tenant = await shop();
    const ramesh = await customer(tenant, { creditDays: 2 });
    const bill = await invoice(tenant, ramesh);

    expect(await sendDueReminders(tenant.job, day(1))).toEqual({
      emails: 0,
      reminders: 0,
      failed: 0,
    });
    const stages: [number, string][] = [
      [2, "due today"],
      [3, "1 day overdue"],
      [9, "7 days overdue"],
      [16, "14 days overdue"],
    ];
    for (const [offset, status] of stages) {
      clearTestOutbox();
      expect(await sendDueReminders(tenant.job, day(offset))).toEqual({
        emails: 1,
        reminders: 1,
        failed: 0,
      });
      // The same day again sends nothing (SPEC F9 AC).
      expect(await sendDueReminders(tenant.job, day(offset))).toMatchObject({ emails: 0 });
      const [message] = sentTo(ramesh.email);
      expect(sentTo(ramesh.email)).toHaveLength(1);
      expect(message?.text).toContain(`${bill.number ?? ""} · ₹354.00 · ${status}`);
    }
    const rows = await reminderRows(bill.id);
    expect(rows.map((row) => row.kind).sort()).toEqual(["D1", "D14", "D7", "DUE"]);
    // Written by the job: no user.
    expect(rows.every((row) => row.createdBy === null)).toBe(true);
  });

  it("puts every invoice of a customer in one email, with links and the shop's Reply-To", async () => {
    const tenant = await shop();
    const ramesh = await customer(tenant, { creditDays: 3 });
    const first = await invoice(tenant, ramesh);
    const second = await invoice(tenant, ramesh);
    const offLink = await invoice(tenant, ramesh);
    await revokePublicLink(tenant.ctx, offLink.id);
    const asha = await customer(tenant, { creditDays: 3, name: "Asha Stores" });
    await invoice(tenant, asha);

    expect(await sendDueReminders(tenant.job, day(4))).toEqual({
      emails: 2,
      reminders: 4,
      failed: 0,
    });
    const [message] = sentTo(ramesh.email);
    expect(sentTo(ramesh.email)).toHaveLength(1);
    expect(message?.subject).toBe("Payment reminder from Sharma Hardware");
    expect(message?.replyTo).toBe("shop@example.com");
    for (const bill of [first, second, offLink]) expect(message?.text).toContain(bill.number);
    expect(message?.text).toContain("Total: ₹1,062.00");
    expect(message?.text.match(/\/i\/[A-Za-z0-9_-]+/g)).toHaveLength(2);
    expect(sentTo(asha.email)).toHaveLength(1);
  });

  it("catches up a missed day, and never goes back to an earlier stage", async () => {
    const tenant = await shop();
    const ramesh = await customer(tenant, { creditDays: 1 });
    const bill = await invoice(tenant, ramesh);
    // No run on the due date (day 1) or the day after: day 3 sends D1 (2 days late).
    await sendDueReminders(tenant.job, day(3));
    expect((await reminderRows(bill.id)).map((row) => row.kind)).toEqual(["D1"]);
    expect(sentTo(ramesh.email)[0]?.text).toContain("2 days overdue");
    // 3 days late is too late for D7 (due day 8): nothing on day 11.
    expect(await sendDueReminders(tenant.job, day(11))).toMatchObject({ emails: 0 });
  });

  it("skips paid, cancelled, walk-in and email-less invoices, and those due on receipt today", async () => {
    const tenant = await shop();
    const paid = await customer(tenant, { creditDays: 1 });
    const paidBill = await invoice(tenant, paid);
    await recordPayment(tenant.ctx, {
      customerId: paid.id,
      amount: "354",
      paymentDate: day(0),
      mode: "CASH",
      allocation: { kind: "AUTO" },
    });
    const cancelled = await customer(tenant, { creditDays: 1 });
    const cancelledBill = await invoice(tenant, cancelled);
    await cancelInvoice(tenant.ctx, cancelledBill.id, { reason: "Wrong customer" });
    await invoice(tenant, null);
    const noEmail = await customer(tenant, { creditDays: 1, email: null });
    await invoice(tenant, noEmail);
    const onReceipt = await customer(tenant, {});
    await invoice(tenant, onReceipt);

    // Due on receipt: no "due today" email on the day of the sale.
    expect(await sendDueReminders(tenant.job, day(0))).toMatchObject({ emails: 0 });
    // The next day only the invoice due on receipt goes out ("1 day overdue").
    expect(await sendDueReminders(tenant.job, day(1))).toEqual({
      emails: 1,
      reminders: 1,
      failed: 0,
    });
    expect(sentTo(onReceipt.email)).toHaveLength(1);
    expect(await reminderRows(paidBill.id)).toEqual([]);
  });

  it("sends nothing while the switch is off (the default) or for a demo business", async () => {
    for (const overrides of [{ emailReminders: false }, { isDemo: true }]) {
      const tenant = await shop(overrides);
      const ramesh = await customer(tenant, { creditDays: 1 });
      await invoice(tenant, ramesh);
      expect(await sendDueReminders(tenant.job, day(1))).toMatchObject({ emails: 0 });
      expect(sentTo(ramesh.email)).toEqual([]);
    }
  });

  it("gives the claims back when sending fails, so the next run sends them", async () => {
    const tenant = await shop();
    const ramesh = await customer(tenant, { creditDays: 1 });
    const bill = await invoice(tenant, ramesh);
    sending.fail = true;
    expect(await sendDueReminders(tenant.job, day(1))).toEqual({
      emails: 0,
      reminders: 0,
      failed: 1,
    });
    expect(await reminderRows(bill.id)).toEqual([]);
    sending.fail = false;
    expect(await sendDueReminders(tenant.job, day(1))).toMatchObject({ emails: 1 });
    expect(sentTo(ramesh.email)).toHaveLength(1);
  });

  it("leaves out invoices another run already claimed", async () => {
    const tenant = await shop();
    const ramesh = await customer(tenant, { creditDays: 1 });
    const claimed = await invoice(tenant, ramesh);
    const open = await invoice(tenant, ramesh);
    await getDb().insert(remindersSent).values({
      businessId: tenant.business.id,
      invoiceId: claimed.id,
      kind: "DUE",
      channel: "EMAIL",
    });
    expect(await sendDueReminders(tenant.job, day(1))).toMatchObject({ emails: 1, reminders: 1 });
    const text = sentTo(ramesh.email)[0]?.text ?? "";
    expect(text).toContain(open.number);
    expect(text).not.toContain(claimed.number);
  });

  it("is only for the daily job, never a signed-in user", async () => {
    const tenant = await shop();
    await expect(sendDueReminders(tenant.ctx, day(1))).rejects.toBeInstanceOf(ForbiddenError);
  });

  itIsolatesTenants({
    sendDueReminders: isolationCase({
      arrange: async (owner) => {
        const ramesh = await customer(owner, { creditDays: 1 });
        await invoice(owner, ramesh);
        return ramesh;
      },
      act: async (intruder) => {
        const { jobContext } = await import("@/server/authz/context");
        const { updateCurrentBusiness } = await import("@/server/db/repos/businesses.repo");
        await updateCurrentBusiness(getDb(), intruder.ctx, { emailReminders: true });
        return sendDueReminders(jobContext(intruder.business.id), day(1));
      },
      verify: (_owner, ramesh) => {
        expect(sentTo(ramesh.email)).toEqual([]);
        return Promise.resolve();
      },
    }),
  });
});
