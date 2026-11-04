import { APIError } from "better-auth/api";

import { type AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { type MemberErrorKey } from "@/lib/validation/members";

const conflict = (key: MemberErrorKey) => () => new ConflictError(key);
const notFound = () => new NotFoundError("Invitation");

/**
 * Better Auth's organization error codes → our typed errors. Messages are `members.errors`
 * keys the UI translates. Anything that says "this invite is not yours" becomes not found,
 * so an invite id reveals nothing to the wrong person.
 */
const BY_CODE: Record<string, () => AppError> = {
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: conflict("alreadyMember"),
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: conflict("alreadyInvited"),
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: conflict("lastOwner"),
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: conflict("lastOwner"),
  INVITATION_NOT_FOUND: notFound,
  FAILED_TO_RETRIEVE_INVITATION: notFound,
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: notFound,
  INVITER_IS_NO_LONGER_A_MEMBER_OF_THE_ORGANIZATION: notFound,
  MEMBER_NOT_FOUND: () => new NotFoundError("Member"),
  EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION: () =>
    new ForbiddenError("verifyFirst"),
  EMAIL_VERIFICATION_REQUIRED_FOR_INVITATION: () => new ForbiddenError("verifyFirst"),
};

function errorCode(error: APIError): string | undefined {
  const body: unknown = error.body;
  if (typeof body === "object" && body !== null && "code" in body) {
    return typeof body.code === "string" ? body.code : undefined;
  }
  return undefined;
}

/** Runs a server-side Better Auth API call and maps its errors (ADR 0004). */
export async function callAuth<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof APIError)) throw error;
    const mapped = BY_CODE[errorCode(error) ?? ""];
    if (mapped) throw mapped();
    if (error.statusCode === 403 || error.statusCode === 401) {
      throw new ForbiddenError(undefined, { cause: error });
    }
    if (error.statusCode === 404) throw new NotFoundError("Invitation", { cause: error });
    throw error;
  }
}
