import { randomBytes } from "node:crypto";

/** 128 random bits for an invoice's public link (SPEC F5, §6.2): 22 base64url characters. */
export function newPublicToken(): string {
  return randomBytes(16).toString("base64url");
}

/** The shape of a token; anything else is never looked up. */
export const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
