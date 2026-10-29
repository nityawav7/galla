import { describe, expect, it, vi } from "vitest";

import { checkHealth } from "@/server/services/health.service";

import packageJson from "../../../package.json";

describe("checkHealth", () => {
  it("is ok when the database answers", async () => {
    const db = { execute: vi.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }) };
    await expect(checkHealth(db)).resolves.toEqual({
      status: "ok",
      db: "ok",
      version: packageJson.version,
      commitSha: "local",
    });
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it("is degraded when the database errors", async () => {
    const db = { execute: vi.fn().mockRejectedValue(new Error("connection refused")) };
    await expect(checkHealth(db)).resolves.toMatchObject({ status: "degraded", db: "error" });
  });

  it("is degraded when the database is too slow", async () => {
    const db = { execute: vi.fn().mockReturnValue(new Promise(() => undefined)) };
    await expect(checkHealth(db, 10)).resolves.toMatchObject({ status: "degraded", db: "error" });
  });
});
