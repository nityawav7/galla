import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  actionsInCategory,
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
  AUDIT_FIELDS,
  auditValue,
  describeAuditRow,
  isAuditAction,
} from "@/server/domain/audit/describe";

const ID = "0190a3b2-0000-7000-8000-000000000001";
const USER = "0190a3b2-0000-7000-8000-000000000002";

describe("audit categories", () => {
  it("puts every action in exactly one category", () => {
    const all = AUDIT_CATEGORIES.flatMap((category) => actionsInCategory(category));
    expect(all.toSorted()).toEqual(AUDIT_ACTIONS.toSorted());
  });

  it("files actions by what they are, not the entity they point at", () => {
    expect(actionsInCategory("payments")).toEqual([
      "payment.recorded",
      "payment.voided",
      "payment.applied",
      "refund.recorded",
      "refund.voided",
    ]);
    expect(actionsInCategory("invoices")).toContain("creditNote.issued");
    expect(actionsInCategory("customers")).toContain("customer.reminderShared");
    expect(actionsInCategory("settings")).toEqual(["business.created", "business.updated"]);
  });

  it("knows its own actions only", () => {
    expect(isAuditAction("invoice.issued")).toBe(true);
    expect(isAuditAction("invoice.hacked")).toBe(false);
    expect(isAuditAction("toString")).toBe(false);
  });
});

describe("auditValue", () => {
  it("formats by field", () => {
    expect(auditValue("amountPaise", "50000")).toEqual({ kind: "money", paise: 50000n });
    expect(auditValue("amountPaise", 125)).toEqual({ kind: "money", paise: 125n });
    expect(auditValue("rateBp", 1800)).toEqual({ kind: "rate", bp: 1800 });
    expect(auditValue("creditDays", 30)).toEqual({ kind: "count", value: 30 });
    expect(auditValue("voided", true)).toEqual({ kind: "bool", value: true });
    expect(auditValue("paymentDate", "2026-11-12")).toEqual({ kind: "date", date: "2026-11-12" });
    expect(auditValue("billingStateCode", "27")).toEqual({ kind: "text", text: "Maharashtra" });
    expect(auditValue("name", "Asha Traders")).toEqual({ kind: "text", text: "Asha Traders" });
    expect(auditValue("mode", "UPI")).toEqual({ kind: "enum", group: "mode", value: "UPI" });
    expect(auditValue("role", "STAFF")).toEqual({ kind: "enum", group: "role", value: "STAFF" });
    expect(auditValue("source", "csv")).toEqual({ kind: "enum", group: "source", value: "csv" });
  });

  it("shows nothing for empty values", () => {
    for (const raw of [null, undefined, ""]) {
      expect(auditValue("email", raw)).toEqual({ kind: "empty" });
    }
  });

  it("falls back to plain text for anything unexpected", () => {
    expect(auditValue("amountPaise", "12.5")).toEqual({ kind: "text", text: "12.5" });
    expect(auditValue("amountPaise", 1.5)).toEqual({ kind: "text", text: "1.5" });
    expect(auditValue("rateBp", 12.5)).toEqual({ kind: "text", text: "12.5" });
    expect(auditValue("creditDays", "30")).toEqual({ kind: "text", text: "30" });
    expect(auditValue("voided", "yes")).toEqual({ kind: "text", text: "yes" });
    expect(auditValue("paymentDate", "12-11-2026")).toEqual({ kind: "text", text: "12-11-2026" });
    expect(auditValue("stateCode", "99")).toEqual({ kind: "text", text: "99" });
    expect(auditValue("stateCode", 27)).toEqual({ kind: "text", text: "27" });
    expect(auditValue("mode", "BARTER")).toEqual({ kind: "text", text: "BARTER" });
    expect(auditValue("name", false)).toEqual({ kind: "text", text: "false" });
    expect(auditValue("name", { nested: true })).toEqual({ kind: "empty" });
  });

  it("never throws, whatever is stored", () => {
    fc.assert(
      fc.property(fc.constantFrom(...AUDIT_FIELDS), fc.jsonValue(), (field, raw) => {
        expect(() => auditValue(field, raw)).not.toThrow();
      }),
    );
  });
});

describe("describeAuditRow", () => {
  it("names an issued invoice by its number and lists the totals", () => {
    const row = describeAuditRow({
      action: "invoice.issued",
      entityId: ID,
      diff: {
        after: {
          number: "SH/26-27/0004",
          type: "TAX_INVOICE",
          invoiceDate: "2026-11-12",
          placeOfSupplyStateCode: "27",
          customerId: USER,
          lineCount: 2,
          acknowledgedWarnings: ["x"],
          grandTotalPaise: "118000",
        },
      },
    });
    expect(row.action).toBe("invoice.issued");
    expect(row.category).toBe("invoices");
    expect(row.subject).toEqual({ kind: "invoice", id: ID, label: "SH/26-27/0004" });
    expect(row.changes).toEqual([]);
    expect(row.details.map((detail) => detail.field)).toEqual([
      "type",
      "invoiceDate",
      "placeOfSupplyStateCode",
      "lineCount",
      "grandTotalPaise",
    ]);
  });

  it("looks up an invoice that has no number in the row", () => {
    const row = describeAuditRow({
      action: "invoice.emailed",
      entityId: ID,
      diff: { after: { balancePaise: "500", locale: "hi" } },
    });
    expect(row.subject).toEqual({ kind: "invoice", id: ID });
    expect(row.details).toEqual([
      { field: "locale", value: { kind: "enum", group: "locale", value: "hi" } },
      { field: "balancePaise", value: { kind: "money", paise: 500n } },
    ]);
  });

  it("shows an edit as before → after, the name included", () => {
    const row = describeAuditRow({
      action: "customer.updated",
      entityId: ID,
      diff: {
        before: { name: "Asha", creditDays: 15 },
        after: { name: "Asha Traders", creditDays: 30 },
        stateOverride: true,
      },
    });
    expect(row.subject).toEqual({ kind: "customer", id: ID });
    expect(row.changes).toEqual([
      {
        field: "name",
        before: { kind: "text", text: "Asha" },
        after: { kind: "text", text: "Asha Traders" },
      },
      {
        field: "creditDays",
        before: { kind: "count", value: 15 },
        after: { kind: "count", value: 30 },
      },
    ]);
    expect(row.details).toEqual([{ field: "stateOverride", value: { kind: "bool", value: true } }]);
  });

  it("doesn't repeat a new customer's name, and skips empty fields", () => {
    const row = describeAuditRow({
      action: "customer.created",
      entityId: ID,
      diff: { after: { name: "Asha", email: null, creditDays: 0 }, source: "csv" },
    });
    expect(row.details).toEqual([
      { field: "creditDays", value: { kind: "count", value: 0 } },
      { field: "source", value: { kind: "enum", group: "source", value: "csv" } },
    ]);
    const deleted = describeAuditRow({
      action: "invoice.draftDeleted",
      entityId: ID,
      diff: { before: { customerId: ID, grandTotalPaise: "0", reason: null }, source: null },
    });
    expect(deleted.subject).toBeNull();
    expect(deleted.details).toEqual([
      { field: "grandTotalPaise", value: { kind: "money", paise: 0n } },
    ]);
  });

  it("never shows ids, hashes or nested lists", () => {
    const row = describeAuditRow({
      action: "payment.voided",
      entityId: ID,
      diff: {
        before: { voided: false },
        after: {
          voided: true,
          reason: "Bounced",
          amountPaise: "50000",
          released: [{ invoiceId: ID, amountPaise: "50000" }],
          invoiceStatuses: [{ id: ID, status: "ISSUED" }],
        },
      },
    });
    expect(row.subject).toEqual({ kind: "payment", id: ID });
    expect(
      JSON.stringify(row, (_, value: unknown) => (typeof value === "bigint" ? "" : value)),
    ).not.toContain("invoiceId");
    expect(row.changes.map((change) => change.field)).toEqual(["voided"]);
    expect(row.details.map((detail) => detail.field)).toEqual(["reason", "amountPaise"]);
  });

  it("names an invitation by its email and keeps the role", () => {
    const created = describeAuditRow({
      action: "invitation.created",
      entityId: ID,
      diff: { after: { email: "staff@example.com", role: "STAFF" } },
    });
    expect(created.subject).toEqual({ kind: "text", text: "staff@example.com" });
    expect(created.details).toEqual([
      { field: "role", value: { kind: "enum", group: "role", value: "STAFF" } },
    ]);
    const cancelled = describeAuditRow({
      action: "invitation.cancelled",
      entityId: ID,
      diff: { before: { email: "staff@example.com", role: "STAFF" } },
    });
    expect(cancelled.subject).toEqual({ kind: "text", text: "staff@example.com" });
    expect(cancelled.details.map((detail) => detail.field)).toEqual(["role"]);
    expect(
      describeAuditRow({ action: "invitation.created", entityId: ID, diff: { after: {} } }).subject,
    ).toBeNull();
  });

  it("names a removed member by their user", () => {
    const row = describeAuditRow({
      action: "member.removed",
      entityId: ID,
      diff: { before: { userId: USER, role: "STAFF" } },
    });
    expect(row.subject).toEqual({ kind: "user", id: USER });
    expect(
      describeAuditRow({ action: "member.removed", entityId: ID, diff: null }).subject,
    ).toBeNull();
  });

  it("has no subject for settings, and a credit note is named by its number", () => {
    expect(
      describeAuditRow({ action: "business.updated", entityId: ID, diff: {} }).subject,
    ).toBeNull();
    expect(
      describeAuditRow({
        action: "creditNote.issued",
        entityId: ID,
        diff: { after: { number: "CN/26-27/0001", invoiceNumber: "SH/26-27/0004" } },
      }),
    ).toMatchObject({
      subject: { kind: "creditNote", id: ID, label: "CN/26-27/0001" },
      details: [{ field: "invoiceNumber", value: { kind: "text", text: "SH/26-27/0004" } }],
    });
  });

  it("keeps an action it doesn't know, without a subject", () => {
    const row = describeAuditRow({
      action: "something.new",
      entityId: ID,
      diff: { after: { amountPaise: "100", secret: "x" } },
    });
    expect(row).toEqual({
      action: null,
      category: null,
      subject: null,
      changes: [],
      details: [{ field: "amountPaise", value: { kind: "money", paise: 100n } }],
    });
  });

  it("survives any diff", () => {
    fc.assert(
      fc.property(fc.constantFrom(...AUDIT_ACTIONS, "x.y"), fc.jsonValue(), (action, diff) => {
        expect(() => describeAuditRow({ action, entityId: ID, diff })).not.toThrow();
      }),
    );
  });

  it("lists values in a fixed order, whatever order jsonb stored them in", () => {
    const row = describeAuditRow({
      action: "invoice.issued",
      entityId: ID,
      diff: {
        after: { taxPaise: "18000", type: "TAX_INVOICE", grandTotalPaise: "118000", lineCount: 2 },
      },
    });
    expect(row.details.map((detail) => detail.field)).toEqual([
      "type",
      "lineCount",
      "taxPaise",
      "grandTotalPaise",
    ]);
  });
});
