import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { closeDb, getDb } from "@/server/db/client";
import { insertMember } from "@/server/db/repos/members.repo";
import { ownerDigestsSent } from "@/server/db/schema";
import type * as email from "@/server/notifications/email";
import { clearTestOutbox, readTestOutbox } from "@/server/notifications/email";
import { sendOwnerDigest } from "@/server/services/owner-digest.service";

import { customer, day, invoice, shop } from "../support/daily-job";
import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createUser } from "../support/users";

const sending = vi.hoisted(() => ({ fail: false }));

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

const sentTo = (address: string) => readTestOutbox().filter((sent) => sent.to === address);

describe("sendOwnerDigest", () => {
  it("emails each owner what is overdue, biggest first, with WhatsApp links (decision 10)", async () => {
    const tenant = await shop();
    const ramesh = await customer(tenant, { creditDays: 1, name: "Ramesh Traders" });
    await invoice(tenant, ramesh);
    await invoice(tenant, ramesh);
    const asha = await customer(tenant, { creditDays: 1, name: "Asha Stores" });
    await invoice(tenant, asha);
    // Not yet overdue on day 2 (due day 5).
    const later = await customer(tenant, { creditDays: 5, name: "Later Ltd" });
    await invoice(tenant, later);
    const accountant = await createUser("Accountant");
    await insertMember(getDb(), tenant.ctx, { userId: accountant.id, role: "ACCOUNTANT" });

    expect(await sendOwnerDigest(tenant.job, day(2))).toEqual({ emails: 1, failed: 0 });
    const [message] = sentTo(tenant.ownerEmail);
    expect(message?.subject).toBe("₹1,062.00 overdue from 2 customers · Sharma Hardware");
    const text = message?.text ?? "";
    expect(text.indexOf("Ramesh Traders · ₹708.00")).toBeGreaterThan(-1);
    expect(text.indexOf("Asha Stores · ₹354.00")).toBeGreaterThan(text.indexOf("Ramesh"));
    expect(text).not.toContain("Later Ltd");
    expect(text).toMatch(/Remind on WhatsApp: https:\/\/wa\.me\/\?text=Namaste%20Ramesh/);
    expect(text).toMatch(/Open the dashboard: http.*\/b\/t-[a-z0-9]+\/dashboard/);
    expect(message?.html).toContain(`/customers/${ramesh.id}`);
    expect(sentTo(accountant.email)).toEqual([]);
  });

  it("sends once a day, and only when something is overdue", async () => {
    const tenant = await shop();
    const ramesh = await customer(tenant, { creditDays: 3 });
    await invoice(tenant, ramesh);
    // Due day 3: nothing overdue yet on day 3.
    expect(await sendOwnerDigest(tenant.job, day(3))).toEqual({ emails: 0, failed: 0 });
    expect(await sendOwnerDigest(tenant.job, day(4))).toEqual({ emails: 1, failed: 0 });
    expect(await sendOwnerDigest(tenant.job, day(4))).toEqual({ emails: 0, failed: 0 });
    expect(await sendOwnerDigest(tenant.job, day(5))).toEqual({ emails: 1, failed: 0 });
    expect(sentTo(tenant.ownerEmail)).toHaveLength(2);
  });

  it("lists the 10 biggest and says how many more", async () => {
    const tenant = await shop();
    for (let index = 0; index < 11; index += 1) {
      await invoice(tenant, await customer(tenant, { name: `Customer ${String(index)}` }));
    }
    await sendOwnerDigest(tenant.job, day(1));
    const text = sentTo(tenant.ownerEmail)[0]?.text ?? "";
    expect(text.match(/ · ₹354\.00/g)).toHaveLength(10);
    expect(text).toContain("…and 1 more customer.");
  });

  it("is written in Hindi for a Hindi business", async () => {
    const tenant = await shop({ locale: "hi" });
    await invoice(tenant, await customer(tenant, {}));
    await sendOwnerDigest(tenant.job, day(1));
    expect(sentTo(tenant.ownerEmail)[0]?.subject).toBe(
      "1 ग्राहक से ₹354.00 बकाया · Sharma Hardware",
    );
  });

  it("sends nothing when switched off, for a demo business, or with no owner", async () => {
    for (const overrides of [{ ownerDigest: false }, { isDemo: true }]) {
      const tenant = await shop(overrides);
      await invoice(tenant, await customer(tenant, {}));
      expect(await sendOwnerDigest(tenant.job, day(1))).toEqual({ emails: 0, failed: 0 });
      expect(sentTo(tenant.ownerEmail)).toEqual([]);
    }
  });

  it("gives the day back when no owner could be emailed", async () => {
    const tenant = await shop();
    await invoice(tenant, await customer(tenant, {}));
    sending.fail = true;
    expect(await sendOwnerDigest(tenant.job, day(1))).toEqual({ emails: 0, failed: 1 });
    const claims = await getDb()
      .select()
      .from(ownerDigestsSent)
      .where(and(eq(ownerDigestsSent.businessId, tenant.business.id)));
    expect(claims).toEqual([]);
    sending.fail = false;
    expect(await sendOwnerDigest(tenant.job, day(1))).toEqual({ emails: 1, failed: 0 });
  });

  it("is only for the daily job, never a signed-in user", async () => {
    const tenant = await shop();
    await expect(sendOwnerDigest(tenant.ctx, day(1))).rejects.toBeInstanceOf(ForbiddenError);
  });

  itIsolatesTenants({
    sendOwnerDigest: isolationCase({
      arrange: async (owner) => {
        await invoice(owner, await customer(owner, {}));
        return owner.business.id;
      },
      act: async (intruder) => {
        const { jobContext } = await import("@/server/authz/context");
        return sendOwnerDigest(jobContext(intruder.business.id), day(1));
      },
      verify: () => {
        expect(readTestOutbox()).toEqual([]);
        return Promise.resolve();
      },
    }),
  });
});
