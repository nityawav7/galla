/**
 * Typed application errors. Services throw these; route handlers and server
 * actions map them to HTTP/UI responses in one place via `toHttpStatus` and
 * `toPublicError` (SPEC §7.2).
 */

export type ErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface FieldIssue {
  path: string;
  message: string;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly httpStatus: number;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND";
  readonly httpStatus = 404;

  constructor(entity: string, options?: ErrorOptions) {
    super(`${entity} not found`, options);
  }
}

export class ForbiddenError extends AppError {
  readonly code = "FORBIDDEN";
  readonly httpStatus = 403;

  constructor(message = "You do not have permission to do this", options?: ErrorOptions) {
    super(message, options);
  }
}

export class UnauthorizedError extends AppError {
  readonly code = "UNAUTHORIZED";
  readonly httpStatus = 401;

  constructor(message = "Please sign in", options?: ErrorOptions) {
    super(message, options);
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION";
  readonly httpStatus = 422;

  constructor(
    message: string,
    readonly issues: readonly FieldIssue[] = [],
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT";
  readonly httpStatus = 409;
}

export class RateLimitError extends AppError {
  readonly code = "RATE_LIMITED";
  readonly httpStatus = 429;

  constructor(
    readonly retryAfterSeconds: number,
    options?: ErrorOptions,
  ) {
    super("Too many requests, please try again shortly", options);
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toHttpStatus(error: unknown): number {
  return isAppError(error) ? error.httpStatus : 500;
}

export interface PublicError {
  code: ErrorCode;
  message: string;
  issues?: readonly FieldIssue[];
}

/** Safe to send to clients: unknown errors never leak their internal message. */
export function toPublicError(error: unknown): PublicError {
  if (!isAppError(error)) {
    return { code: "INTERNAL", message: "Something went wrong" };
  }
  if (error instanceof ValidationError) {
    return { code: error.code, message: error.message, issues: error.issues };
  }
  return { code: error.code, message: error.message };
}
