# ADR 0004: Better Auth for identity and membership, Galla services for businesses

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

Phase 4 adds sign-in, businesses, roles and invites (SPEC F1, §2.1). SPEC §7.1 picks Better Auth with its organization plugin, which keeps users and memberships in our own Postgres. A business row is more than an organization, though: its GSTIN, scheme and state are validated by the GST domain, changes to it must be audited (rule 10), and invoices depend on it. We also have to fit Better Auth onto the Phase 3 schema (UUIDv7 ids, snake_case, plural tables) without a second source of truth for permissions.

## Decision

- **Better Auth owns identity and membership.** Tables `users`, `sessions`, `accounts`, `verifications`, `members` and `invitations` (migration `0002_auth`), written by Better Auth through its Drizzle adapter (`src/server/db/auth-adapter.ts`). Its `organization` model is our `businesses` table (`name` → `legal_name`, `logo` → `logo_url`, `organizationId` → `business_id`).
- **Galla owns businesses.** Better Auth's create, update and delete organization endpoints are switched off (`allowUserToCreateOrganization: false`, no role has `organization:update`/`delete`, `disableOrganizationDeletion`). `business.service` (Phase 4b) creates a business, its OWNER membership and the audit row in one transaction.
- **Roles are `OWNER`, `ACCOUNTANT`, `STAFF`**, stored as-is in `members.role` (CHECK constraint). Better Auth's role definitions are generated from `src/server/authz/permissions.ts`, so the SPEC §2.1 matrix lives in one file. Better Auth's check only guards its own endpoints; every Galla service still calls `assertCan`.
- **The URL picks the business.** `/b/[businessSlug]` is resolved to a `TenantContext` from the signed-in user's `members` row on every request (404 if there is none). The session's "active organization" column exists because the plugin needs it, but is unused, so two tabs can show two businesses safely.
- **Ids are UUIDv7** from `newId()` via `advanced.database.generateId`, except `verifications.id`, which is `text`: Better Auth also looks verification rows up by ids it derives itself.
- **Sign-in methods:** email and password; a 6-digit email code (5 minutes, 3 tries, stored hashed), which also verifies the email and resets the password; Google when `GOOGLE_CLIENT_ID`/`_SECRET` are set. Codes only sign in existing accounts (`disableSignUp`), and asking for a code answers the same whether or not the account exists. Magic links are not offered: they often open in a different browser (WhatsApp or Gmail in-app) than the one the user started in.
- **Email verification is not required to start billing**, so a shop can sign up and bill at once, but it is required to accept an invite (`requireEmailVerificationOnInvitation`).
- **Rate limits are ours.** Better Auth's built-in limiter keeps counts in memory, which serverless instances do not share, so it is off. `src/app/api/auth/[...all]/route.ts` applies `@upstash/ratelimit` (5 per minute per hashed IP, per group: sign-in, sign-up, code, password) before Better Auth sees the request. Production requires Upstash Redis; elsewhere an in-memory limiter is used.
- **Email goes through Resend** (`src/server/notifications/email.ts`). Without a verified domain, Resend's shared sender only reaches the Resend account owner; codes and invites to anyone else are not delivered until a domain is added. Without an API key, dev prints the email text (never the address), tests keep an outbox, and deployed environments drop it with a warning.
- **`created_by` and `actor_user_id` have no foreign key to `users`**, so audit history outlives a deleted user. `members`, `invitations`, `sessions` and `accounts` do reference `users`.
- **Membership changes write audit rows from Better Auth's hooks** (Phase 4c), after Better Auth's own write rather than in the same transaction. Rule 10 covers financial data; memberships are not.

## Consequences

- Better Auth validates our Drizzle schema at startup. Required `businesses` columns it never writes (`gst_scheme`, `state_code`) are declared to it as `additionalFields` with `input: false`.
- Upgrading Better Auth can add or rename columns. Run its schema check (it fails loudly at startup) and add a new migration; never edit `0002_auth`.
- A user whose email is not yet verified can bill but cannot join someone else's business. The invite page asks for a code first.
- Previews have no Google sign-in (their URLs change per deployment and Google needs exact redirect URIs) and no shared rate-limit counts unless Upstash is connected for Preview too.
- Hindi messages are complete, but every page renders in English until the business language setting (SPEC F10) chooses per business.
