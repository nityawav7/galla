import { describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib/errors";
import { JOB_USER_ID, jobContext } from "@/server/authz/context";
import { assertJob } from "@/server/authz/permissions";

describe("the daily job's context", () => {
  it("acts as the job in one business, with owner rights", () => {
    expect(jobContext("b1")).toEqual({ userId: JOB_USER_ID, businessId: "b1", role: "OWNER" });
    expect(() => {
      assertJob(jobContext("b1"));
    }).not.toThrow();
  });

  it("refuses a signed-in user, even an owner", () => {
    expect(() => {
      assertJob({ userId: "0190b2a4-0000-7000-8000-000000000000" });
    }).toThrow(ForbiddenError);
  });
});
