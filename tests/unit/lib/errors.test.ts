import { describe, expect, it } from "vitest";

import {
  ConflictError,
  ForbiddenError,
  isAppError,
  NotFoundError,
  RateLimitError,
  toHttpStatus,
  toPublicError,
  UnauthorizedError,
  ValidationError,
} from "@/lib/errors";

describe("errors", () => {
  it.each([
    [new NotFoundError("Invoice"), 404, "NOT_FOUND"],
    [new ForbiddenError(), 403, "FORBIDDEN"],
    [new UnauthorizedError(), 401, "UNAUTHORIZED"],
    [new ValidationError("Bad input"), 422, "VALIDATION"],
    [new ConflictError("Number already used"), 409, "CONFLICT"],
    [new RateLimitError(30), 429, "RATE_LIMITED"],
  ])("%s maps to HTTP %i", (error, status, code) => {
    expect(isAppError(error)).toBe(true);
    expect(toHttpStatus(error)).toBe(status);
    expect(toPublicError(error).code).toBe(code);
  });

  it("names errors after their class", () => {
    expect(new NotFoundError("Customer")).toMatchObject({
      name: "NotFoundError",
      message: "Customer not found",
    });
  });

  it("keeps the cause", () => {
    const cause = new Error("db down");
    expect(new ConflictError("x", { cause }).cause).toBe(cause);
  });

  it("includes field issues for validation errors", () => {
    const issues = [{ path: "gstin", message: "Invalid check character" }];
    expect(toPublicError(new ValidationError("Invalid customer", issues))).toEqual({
      code: "VALIDATION",
      message: "Invalid customer",
      issues,
    });
  });

  it("carries retry-after for rate limits", () => {
    expect(new RateLimitError(42).retryAfterSeconds).toBe(42);
  });

  it("never leaks internal messages from unknown errors", () => {
    const internal = new Error("password authentication failed for user galla");
    expect(isAppError(internal)).toBe(false);
    expect(toHttpStatus(internal)).toBe(500);
    expect(toPublicError(internal)).toEqual({ code: "INTERNAL", message: "Something went wrong" });
    expect(toPublicError("a string")).toEqual({
      code: "INTERNAL",
      message: "Something went wrong",
    });
  });
});
