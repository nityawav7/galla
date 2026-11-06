import { afterAll, describe, expect, it } from "vitest";

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { type CustomerFormValues, EMPTY_CUSTOMER_FORM } from "@/lib/validation/customers";
import { type Role } from "@/server/authz/context";
import { closeDb, getDb } from "@/server/db/client";
import { listAuditLogs } from "@/server/db/repos/audit.repo";
import {
  findCustomerById,
  insertCustomers,
  listCustomers as listCustomerRows,
} from "@/server/db/repos/customers.repo";
import {
  archiveCustomer,
  createCustomer,
  CUSTOMERS_PAGE_SIZE,
  getCustomer,
  importCustomers,
  listCustomers,
  previewCustomerImport,
  restoreCustomer,
  type SaveCustomerResult,
  updateCustomer,
} from "@/server/services/customer.service";

import { isolationCase, itIsolatesTenants } from "../support/tenant-isolation";
import { createTenant, type Tenant } from "../support/tenants";

afterAll(async () => {
  await closeDb();
});

const db = () => getDb();

const ramesh: CustomerFormValues = {
  ...EMPTY_CUSTOMER_FORM,
  name: "Ramesh Traders",
  phone: "98765 43210",
  gstin: "29AAACI1681G1ZL",
  billingCity: "Bengaluru",
  openingBalance: "1500",
  creditDays: "15",
};

const HEADER =
  "name,phone,email,gstin,billing_address_line1,billing_address_line2,billing_city," +
  "billing_pincode,billing_state,shipping_address_line1,shipping_address_line2,shipping_city," +
  "shipping_pincode,shipping_state,opening_balance,credit_days";

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join("\r\n");
}

/** A row with only these columns set, in header order. */
function row(values: Partial<Record<string, string>>): string {
  return HEADER.split(",")
    .map((column) => values[column] ?? "")
    .join(",");
}

async function tenantAs(role: Role): Promise<Tenant> {
  const owner = await createTenant();
  return { ...owner, ctx: { ...owner.ctx, role } };
}

function saved(result: SaveCustomerResult) {
  if (result.status !== "saved") throw new Error(`expected saved, got ${result.status}`);
  return result.customer;
}

async function issuesOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return (error as ValidationError).issues;
}

describe("createCustomer", () => {
  it.each<Role>(["OWNER", "STAFF"])(
    "lets %s add a customer, filling the state from the GSTIN",
    async (role) => {
      const { ctx } = await tenantAs(role);
      const customer = saved(await createCustomer(ctx, ramesh));
      expect(customer).toMatchObject({
        businessId: ctx.businessId,
        name: "Ramesh Traders",
        phoneE164: "+919876543210",
        gstin: "29AAACI1681G1ZL",
        billingStateCode: "29",
        openingBalancePaise: 150000n,
        creditDays: 15,
        createdBy: ctx.userId,
      });
      const [audit] = await listAuditLogs(db(), ctx, { entityId: customer.id });
      expect(audit).toMatchObject({
        action: "customer.created",
        diff: { after: { name: "Ramesh Traders", openingBalancePaise: "150000" } },
      });
    },
  );

  it("refuses accountants", async () => {
    const { ctx } = await tenantAs("ACCOUNTANT");
    await expect(createCustomer(ctx, ramesh)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects an invalid GSTIN checksum with a clear message key (SPEC F3 AC)", async () => {
    const { ctx } = await createTenant();
    expect(await issuesOf(createCustomer(ctx, { ...ramesh, gstin: "29AAACI1681G1ZM" }))).toEqual([
      { path: "gstin", message: "gstinChecksum" },
    ]);
  });

  it("needs the override for a state other than the GSTIN's, and audits it", async () => {
    const { ctx } = await createTenant();
    expect(await issuesOf(createCustomer(ctx, { ...ramesh, billingStateCode: "27" }))).toEqual([
      { path: "billingStateCode", message: "customerStateMismatch" },
    ]);
    const customer = saved(
      await createCustomer(ctx, { ...ramesh, billingStateCode: "27", stateOverride: true }),
    );
    expect(customer.billingStateCode).toBe("27");
    const [audit] = await listAuditLogs(db(), ctx, { entityId: customer.id });
    expect(audit?.diff).toMatchObject({ stateOverride: true });
  });

  it("asks before saving a second customer with the same phone, then saves on confirm", async () => {
    const { ctx } = await createTenant();
    const first = saved(await createCustomer(ctx, { ...ramesh, gstin: "" }));
    const asked = await createCustomer(ctx, { ...ramesh, gstin: "", name: "Ramesh's son" });
    expect(asked).toEqual({
      status: "possibleDuplicate",
      matches: [{ id: first.id, name: "Ramesh Traders" }],
    });
    expect(await listCustomerRows(db(), ctx)).toHaveLength(1);
    const second = await createCustomer(ctx, {
      ...ramesh,
      gstin: "",
      name: "Ramesh's son",
      confirmDuplicatePhone: true,
    });
    expect(second.status).toBe("saved");
  });

  it("refuses a GSTIN another active customer has", async () => {
    const { ctx } = await createTenant();
    await createCustomer(ctx, ramesh);
    expect(
      await issuesOf(createCustomer(ctx, { ...ramesh, phone: "", name: "Duplicate" })),
    ).toEqual([{ path: "gstin", message: "gstinTaken" }]);
    expect(await listAuditLogs(db(), ctx)).toHaveLength(1);
  });
});

describe("updateCustomer", () => {
  it("records only changed fields, and does not ask about the customer's own phone", async () => {
    const { ctx } = await createTenant();
    const customer = saved(await createCustomer(ctx, ramesh));
    const updated = saved(await updateCustomer(ctx, customer.id, { ...ramesh, creditDays: "30" }));
    expect(updated.creditDays).toBe(30);
    const audits = await listAuditLogs(db(), ctx, { entityId: customer.id });
    expect(audits[0]).toMatchObject({
      action: "customer.updated",
      diff: { before: { creditDays: 15 }, after: { creditDays: 30 } },
    });
    await updateCustomer(ctx, customer.id, { ...ramesh, creditDays: "30" });
    expect(await listAuditLogs(db(), ctx, { entityId: customer.id })).toHaveLength(2);
  });

  it("asks when the phone changes to another customer's", async () => {
    const { ctx } = await createTenant();
    const asha = saved(
      await createCustomer(ctx, { ...EMPTY_CUSTOMER_FORM, name: "Asha", phone: "9822222222" }),
    );
    const ravi = saved(await createCustomer(ctx, { ...EMPTY_CUSTOMER_FORM, name: "Ravi" }));
    const result = await updateCustomer(ctx, ravi.id, {
      ...EMPTY_CUSTOMER_FORM,
      name: "Ravi",
      phone: "9822222222",
    });
    expect(result).toEqual({
      status: "possibleDuplicate",
      matches: [{ id: asha.id, name: "Asha" }],
    });
    expect((await findCustomerById(db(), ctx, ravi.id))?.phoneE164).toBeNull();
  });

  it("maps a GSTIN clash to the gstin field", async () => {
    const { ctx } = await createTenant();
    await createCustomer(ctx, ramesh);
    const other = saved(await createCustomer(ctx, { ...EMPTY_CUSTOMER_FORM, name: "Other" }));
    expect(await issuesOf(updateCustomer(ctx, other.id, { ...ramesh, phone: "" }))).toEqual([
      { path: "gstin", message: "gstinTaken" },
    ]);
  });

  it("treats bad ids as not found and refuses accountants", async () => {
    const owner = await createTenant();
    await expect(updateCustomer(owner.ctx, "nope", ramesh)).rejects.toBeInstanceOf(NotFoundError);
    const customer = saved(await createCustomer(owner.ctx, ramesh));
    const ctx = { ...owner.ctx, role: "ACCOUNTANT" as const };
    await expect(updateCustomer(ctx, customer.id, ramesh)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(archiveCustomer(ctx, customer.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(restoreCustomer(ctx, customer.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await getCustomer(ctx, customer.id)).id).toBe(customer.id);
  });
});

describe("archiveCustomer and restoreCustomer", () => {
  it("archives and restores once each, auditing both", async () => {
    const { ctx } = await createTenant();
    const customer = saved(await createCustomer(ctx, ramesh));
    expect((await archiveCustomer(ctx, customer.id)).archivedAt).toBeInstanceOf(Date);
    expect((await archiveCustomer(ctx, customer.id)).archivedAt).toBeInstanceOf(Date);
    expect((await restoreCustomer(ctx, customer.id)).archivedAt).toBeNull();
    expect((await restoreCustomer(ctx, customer.id)).archivedAt).toBeNull();
    const actions = (await listAuditLogs(db(), ctx, { entityId: customer.id })).map(
      (a) => a.action,
    );
    expect(actions.sort()).toEqual(["customer.archived", "customer.created", "customer.restored"]);
  });

  it("refuses to restore a customer whose GSTIN another active customer now has", async () => {
    const { ctx } = await createTenant();
    const customer = saved(await createCustomer(ctx, ramesh));
    await archiveCustomer(ctx, customer.id);
    await createCustomer(ctx, { ...ramesh, name: "New Ramesh", confirmDuplicatePhone: true });
    await expect(restoreCustomer(ctx, customer.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("listCustomers", () => {
  it("walks every page, searches by phone and shows archived ones on request", async () => {
    const { ctx } = await createTenant();
    const total = CUSTOMERS_PAGE_SIZE + 5;
    await insertCustomers(
      db(),
      ctx,
      Array.from({ length: total }, (_, i) => ({ name: `Customer ${String(i % 7)}` })),
    );
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listCustomers(ctx, { cursor });
      ids.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(ids).size).toBe(total);

    const asha = saved(
      await createCustomer(ctx, { ...EMPTY_CUSTOMER_FORM, name: "Asha", phone: "9811112222" }),
    );
    expect((await listCustomers(ctx, { q: "11112222" })).items.map((c) => c.id)).toEqual([asha.id]);
    await archiveCustomer(ctx, asha.id);
    expect((await listCustomers(ctx, { archived: "1" })).items.map((c) => c.id)).toEqual([asha.id]);
    await expect(getCustomer(ctx, "bad")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("customer CSV import", () => {
  it("previews rows with state names, signed balances and phone warnings", async () => {
    const { ctx } = await createTenant();
    await createCustomer(ctx, { ...EMPTY_CUSTOMER_FORM, name: "Existing", phone: "9800000001" });
    const report = await previewCustomerImport(
      ctx,
      csv(
        row({ name: "Ramesh", gstin: "29AAACI1681G1ZL", opening_balance: "1500" }),
        row({
          name: "Asha",
          phone: "9800000001",
          billing_state: "maharashtra",
          opening_balance: "-200",
        }),
        row({ name: "Bina", phone: "9800000002" }),
        row({ name: "Bina's brother", phone: "98000 00002" }),
      ),
    );
    expect(report).toEqual({
      total: 4,
      valid: 4,
      issueCount: 0,
      issues: [],
      warnings: [
        { line: 3, column: "phone", key: "phoneDuplicate" },
        { line: 5, column: "phone", key: "phoneDuplicate" },
      ],
      sample: [
        {
          line: 2,
          name: "Ramesh",
          phone: null,
          gstin: "29AAACI1681G1ZL",
          state: "Karnataka",
          balance: "₹1,500.00",
          advance: false,
        },
        {
          line: 3,
          name: "Asha",
          phone: "+91 98000 00001",
          gstin: null,
          state: "Maharashtra",
          balance: "₹200.00",
          advance: true,
        },
        {
          line: 4,
          name: "Bina",
          phone: "+91 98000 00002",
          gstin: null,
          state: null,
          balance: null,
          advance: false,
        },
        {
          line: 5,
          name: "Bina's brother",
          phone: "+91 98000 00002",
          gstin: null,
          state: null,
          balance: null,
          advance: false,
        },
      ],
    });
    expect(await listCustomerRows(db(), ctx)).toHaveLength(1);
  });

  it("imports despite warnings, in one go, with an audit row each", async () => {
    const { ctx } = await createTenant();
    const rows = Array.from({ length: 300 }, (_, i) =>
      row({ name: `Customer ${String(i)}`, phone: "9800000003" }),
    );
    expect(await importCustomers(ctx, csv(...rows))).toEqual({ status: "imported", count: 300 });
    expect(await listCustomerRows(db(), ctx, { limit: 1000 })).toHaveLength(300);
    expect(await listAuditLogs(db(), ctx, { entity: "customer", limit: 1000 })).toHaveLength(300);
  });

  it("saves nothing when a row is bad, naming its line and column", async () => {
    const { ctx } = await createTenant();
    await createCustomer(ctx, ramesh);
    const result = await importCustomers(
      ctx,
      csv(
        row({ name: "Good" }),
        row({ name: "Bad GSTIN", gstin: "29AAACI1681G1ZM" }),
        row({ name: "Wrong state", gstin: "27AAPFU0939F1ZV", billing_state: "Karnataka" }),
        row({ name: "Taken", gstin: "29AAACI1681G1ZL" }),
        row({ name: "Twice", gstin: "27AAPFU0939F1ZV" }),
        row({ name: "Twice again", gstin: "27AAPFU0939F1ZV" }),
        row({ name: "", credit_days: "400", opening_balance: "-x" }),
      ),
    );
    expect(result).toMatchObject({
      status: "invalid",
      report: {
        total: 7,
        issues: [
          { line: 3, column: "gstin", key: "gstinChecksum" },
          { line: 4, column: "billing_state", key: "customerStateMismatch" },
          { line: 5, column: "gstin", key: "gstinTaken" },
          { line: 7, column: "gstin", key: "csvDuplicateInFile" },
          { line: 8, column: "name", key: "customerNameRequired" },
          { line: 8, column: "opening_balance", key: "balanceInvalid" },
          { line: 8, column: "credit_days", key: "creditDaysInvalid" },
        ],
      },
    });
    expect(await listCustomerRows(db(), ctx)).toHaveLength(1);
  });

  it("reports file problems and refuses accountants", async () => {
    const { ctx } = await createTenant();
    expect(await previewCustomerImport(ctx, "phone\n98")).toMatchObject({
      issues: [{ line: null, column: "name", key: "csvColumnMissing" }],
    });
    expect(await importCustomers(ctx, HEADER)).toMatchObject({ status: "invalid" });
    await expect(previewCustomerImport(ctx, null)).rejects.toBeInstanceOf(ValidationError);
    const accountant = await tenantAs("ACCOUNTANT");
    await expect(
      previewCustomerImport(accountant.ctx, csv(row({ name: "A" }))),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(importCustomers(accountant.ctx, csv(row({ name: "A" })))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("customer.service isolation", () => {
  const arrange = async (owner: Tenant) => saved(await createCustomer(owner.ctx, ramesh));
  const unchanged = async (owner: Tenant, customer: { id: string; archivedAt: Date | null }) => {
    expect(await findCustomerById(db(), owner.ctx, customer.id)).toMatchObject({
      name: ramesh.name,
      archivedAt: customer.archivedAt,
    });
  };
  const ownerStillHasOne = async (owner: Tenant) => {
    expect((await listCustomers(owner.ctx, {})).items).toHaveLength(1);
  };

  itIsolatesTenants({
    listCustomers: isolationCase({ arrange, act: (intruder) => listCustomers(intruder.ctx, {}) }),
    "listCustomers search by phone and GSTIN": isolationCase({
      arrange,
      act: async (intruder) => [
        ...(await listCustomers(intruder.ctx, { q: "9876543210" })).items,
        ...(await listCustomers(intruder.ctx, { q: "29AAACI" })).items,
      ],
    }),
    getCustomer: isolationCase({
      arrange,
      act: (intruder, customer) => getCustomer(intruder.ctx, customer.id),
    }),
    createCustomer: isolationCase({
      arrange,
      // The owner's phone and GSTIN are not duplicates in another business.
      act: async (intruder) => {
        const result = await createCustomer(intruder.ctx, ramesh);
        expect(result.status).toBe("saved");
        return result;
      },
      verify: ownerStillHasOne,
    }),
    updateCustomer: isolationCase({
      arrange,
      act: (intruder, customer) =>
        updateCustomer(intruder.ctx, customer.id, { ...ramesh, name: "X" }),
      verify: unchanged,
    }),
    archiveCustomer: isolationCase({
      arrange,
      act: (intruder, customer) => archiveCustomer(intruder.ctx, customer.id),
      verify: unchanged,
    }),
    restoreCustomer: isolationCase({
      arrange: async (owner) => archiveCustomer(owner.ctx, (await arrange(owner)).id),
      act: (intruder, customer) => restoreCustomer(intruder.ctx, customer.id),
      verify: unchanged,
    }),
    previewCustomerImport: isolationCase({
      arrange,
      act: async (intruder) => {
        const report = await previewCustomerImport(
          intruder.ctx,
          csv(row({ name: "R", phone: "9876543210", gstin: "29AAACI1681G1ZL" })),
        );
        expect(report.issueCount + report.warnings.length).toBe(0);
        return report;
      },
    }),
    importCustomers: isolationCase({
      arrange,
      act: async (intruder) => {
        const result = await importCustomers(
          intruder.ctx,
          csv(row({ name: "R", gstin: "29AAACI1681G1ZL" })),
        );
        expect(result).toEqual({ status: "imported", count: 1 });
        return result;
      },
      verify: ownerStillHasOne,
    }),
  });
});
