import { describe, expect, it } from "vitest";

import { checkCronAuth } from "@/server/http/cron-auth";

const SECRET = "x".repeat(40);

describe("checkCronAuth", () => {
  it("accepts exactly Vercel Cron's header", () => {
    expect(checkCronAuth(`Bearer ${SECRET}`, SECRET)).toBe("ok");
  });

  it.each([null, "", SECRET, `Bearer ${SECRET}y`, `Bearer ${"x".repeat(39)}`, "Basic abc"])(
    "refuses %j",
    (header) => {
      expect(checkCronAuth(header, SECRET)).toBe("unauthorized");
    },
  );

  it("refuses everything while no secret is configured", () => {
    expect(checkCronAuth("Bearer ", undefined)).toBe("notConfigured");
    expect(checkCronAuth("Bearer ", "")).toBe("notConfigured");
  });
});
