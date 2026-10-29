import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createLogger } from "@/lib/logger";

function captureLogger() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      callback();
    },
  });
  return { logger: createLogger({ level: "info", destination }), lines };
}

describe("logger", () => {
  it("writes JSON with a string level and the message", () => {
    const { logger, lines } = captureLogger();
    logger.info({ invoiceId: "inv_1" }, "invoice.issued");
    expect(lines[0]).toMatchObject({ level: "info", msg: "invoice.issued", invoiceId: "inv_1" });
    expect(lines[0]?.time).toEqual(expect.any(String));
  });

  it("redacts PII at the top level", () => {
    const { logger, lines } = captureLogger();
    logger.info({ phone: "+919876543210", email: "a@b.in", gstin: "27AAPFU0939F1ZV" }, "x");
    expect(lines[0]).toMatchObject({
      phone: "[REDACTED]",
      email: "[REDACTED]",
      gstin: "[REDACTED]",
    });
  });

  it("redacts PII nested two levels deep and keeps IDs", () => {
    const { logger, lines } = captureLogger();
    logger.info(
      {
        customer: { id: "cus_1", name: "Ramesh", billing: { address: "MG Road" } },
        req: { headers: { authorization: "Bearer abc", cookie: "s=1" } },
      },
      "x",
    );
    expect(lines[0]).toMatchObject({
      customer: { id: "cus_1", name: "[REDACTED]", billing: { address: "[REDACTED]" } },
      req: { headers: { authorization: "[REDACTED]", cookie: "[REDACTED]" } },
    });
  });

  it("respects the level", () => {
    const { logger, lines } = captureLogger();
    logger.debug("hidden");
    expect(lines).toHaveLength(0);
  });
});
