import { describe, expect, it } from "vitest";

import { driverFor } from "@/server/db/client";

describe("driverFor", () => {
  it("uses the Neon serverless driver for Neon hosts", () => {
    expect(
      driverFor(
        "postgresql://u:p@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require",
      ),
    ).toBe("neon");
  });

  it("uses node-postgres for everything else", () => {
    expect(driverFor("postgres://galla:galla@localhost:5432/galla")).toBe("pg");
    expect(driverFor("postgres://u:p@db.example.com/x")).toBe("pg");
  });

  it("does not match lookalike hosts", () => {
    expect(driverFor("postgres://u:p@neon.tech.evil.com/x")).toBe("pg");
  });
});
