import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type * as admin from "@/server/db/admin/businesses";
import { closeDb, getDb } from "@/server/db/client";
import { runDailyJob } from "@/server/jobs/daily";
import { clearTestOutbox, readTestOutbox } from "@/server/notifications/email";

import { customer, day, invoice, shop, type Shop } from "../support/daily-job";
import { createTenant } from "../support/tenants";

/*
 * The test database keeps every business earlier runs made, so the job here pages over this
 * file's businesses only. The real cross-tenant read has its own test below.
 */
const visible = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("@/server/db/admin/businesses", async (importOriginal) => {
  const actual = await importOriginal<typeof admin>();
  return {
    ...actual,
    listBusinessesForDailyJob: (
      _db: unknown,
      page: { afterId: string | null; limit: number },
    ): Promise<admin.JobBusiness[]> => {
      const ids = [...visible.ids].sort();
      const start = page.afterId === null ? 0 : ids.indexOf(page.afterId) + 1;
      return Promise.resolve(
        ids
          .slice(start, start + page.limit)
          .map((id) => ({ id, emailReminders: true, ownerDigest: true })),
      );
    },
  };
});

afterAll(async () => {
  await closeDb();
});

beforeEach(() => {
  clearTestOutbox();
  visible.ids = [];
});

/** The job's clock for a business date: 09:00 IST that day. */
const at = (date: string) => new Date(`${date}T03:30:00Z`);

async function shopWithDues(): Promise<Shop & { customerEmails: string[] }> {
  const tenant = await shop();
  visible.ids.push(tenant.business.id);
  const ramesh = await customer(tenant, { creditDays: 1 });
  await invoice(tenant, ramesh);
  await invoice(tenant, ramesh);
  const asha = await customer(tenant, { creditDays: 1, name: "Asha Stores" });
  await invoice(tenant, asha);
  return { ...tenant, customerEmails: [ramesh.email ?? "", asha.email ?? ""] };
}

describe("runDailyJob", () => {
  it("running the job twice sends each reminder once (SPEC F9 AC)", async () => {
    const first = await shopWithDues();
    const second = await shopWithDues();

    const run = await runDailyJob(at(day(2)));
    expect(run).toEqual({
      date: day(2),
      emailSetUp: true,
      businesses: 2,
      reminderEmails: 4,
      reminders: 6,
      digests: 2,
      failed: 0,
      stoppedEarly: false,
    });
    const afterFirst = readTestOutbox().length;
    expect(afterFirst).toBe(6);

    const again = await runDailyJob(at(day(2)));
    expect(again).toMatchObject({ businesses: 2, reminderEmails: 0, reminders: 0, digests: 0 });
    expect(readTestOutbox()).toHaveLength(afterFirst);
    for (const address of [...first.customerEmails, ...second.customerEmails]) {
      expect(readTestOutbox().filter((sent) => sent.to === address)).toHaveLength(1);
    }
  });

  it("pages through businesses in batches and stops starting new ones after the budget", async () => {
    for (let index = 0; index < 3; index += 1) visible.ids.push((await shop()).business.id);
    const paged = await runDailyJob(at(day(1)), { batchSize: 2 });
    expect(paged).toMatchObject({ businesses: 3, stoppedEarly: false });

    let ticks = 0;
    const stopped = await runDailyJob(at(day(1)), {
      batchSize: 2,
      budgetMs: 1,
      // 0 ms for the first business, over budget from the second.
      elapsedMs: () => (ticks++ === 0 ? 0 : 1),
    });
    expect(stopped).toMatchObject({ businesses: 1, stoppedEarly: true });
  });

  it("counts a business whose work throws and carries on with the next", async () => {
    // A malformed id makes the database refuse the first query for that business.
    visible.ids.push("not-a-uuid");
    const tenant = await shopWithDues();
    const run = await runDailyJob(at(day(1)));
    expect(run).toMatchObject({ businesses: 2, failed: 1 });
    expect(readTestOutbox().filter((sent) => tenant.customerEmails.includes(sent.to))).toHaveLength(
      2,
    );
  });
});

describe("listBusinessesForDailyJob (the only cross-tenant read)", () => {
  it("lists businesses with work, in id order, leaving out demo and switched-off ones", async () => {
    const { listBusinessesForDailyJob } = await vi.importActual<typeof admin>(
      "@/server/db/admin/businesses",
    );
    // Ids are UUIDv7 (time-ordered): everything made after the marker sorts after it.
    const marker = await createTenant();
    const both = await createTenant({ emailReminders: true });
    const digestOnly = await createTenant();
    const off = await createTenant({ ownerDigest: false });
    const demo = await createTenant({ isDemo: true, emailReminders: true });

    const seen: admin.JobBusiness[] = [];
    let afterId: string | null = marker.business.id;
    for (;;) {
      const page: admin.JobBusiness[] = await listBusinessesForDailyJob(getDb(), {
        afterId,
        limit: 2,
      });
      seen.push(...page);
      const last = page.at(-1);
      if (!last || page.length < 2) break;
      afterId = last.id;
    }
    const ours = seen.filter((row) =>
      [both, digestOnly, off, demo].some((tenant) => tenant.business.id === row.id),
    );
    expect(ours).toEqual([
      { id: both.business.id, emailReminders: true, ownerDigest: true },
      { id: digestOnly.business.id, emailReminders: false, ownerDigest: true },
    ]);
    // The first page starts from the beginning.
    expect(await listBusinessesForDailyJob(getDb(), { afterId: null, limit: 1 })).toHaveLength(1);
    const ids = seen.map((row) => row.id);
    expect(ids).toEqual([...ids].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
});
