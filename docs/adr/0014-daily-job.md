# ADR 0014: The daily job, idempotent sends and cross-tenant reads

- **Status:** Accepted
- **Date:** 2026-11-12

## Context

SPEC F9 asks for a once-a-day job: email payment reminders to customers (due today, 1, 7 and 14 days overdue) and an owner digest of what is overdue. Vercel Hobby runs a cron at most once a day, roughly in the hour asked for, and a function for at most 60 seconds. The cron can fire twice, a run can be cut off, and someone may run it again by hand, but a customer must never get the same reminder twice (SPEC F9 AC). The job also has to look at every business, while CLAUDE.md rule 3 keeps every query inside one tenant.

## Decision

- **Schedule:** `vercel.json` crons `30 3 * * *` (03:30 UTC = 09:00 IST) calls `GET /api/cron/daily`. The route is thin: it checks `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends), comparing SHA-256 digests with `timingSafeEqual`; 401 for anything else, **503 when `CRON_SECRET` is not set**, so a misconfigured deployment never runs the job unprotected.
- **One cross-tenant read:** `src/server/db/admin/businesses.ts` lists businesses with work (not demo, email reminders or digest on), 25 at a time, keyset-paged by id. ESLint lets only `src/server/jobs/` import `db/admin`. It returns ids and switches only; everything else is read per business through a normal `TenantContext` and the usual repos.
- **The job's context:** `jobContext(businessId)` has a fixed user id no real user can have (`00000000-…`, users have UUIDv7 ids) and owner rights, so the job can reuse services such as the WhatsApp reminder text. The two job services call `assertJob(ctx)`, so no signed-in user can trigger a send. Rows the job writes have `created_by` null (system).
- **Claim, then send** (decision 9 of the Phase 10 plan): a reminder is inserted into `reminders_sent` (unique per business, invoice, kind and channel) with `ON CONFLICT DO NOTHING RETURNING` before the email goes out, and only invoices this run actually claimed are put in the email. Two runs at once can't both claim the same row. If sending fails, the claims are deleted, so the next run retries; a crash between claiming and sending loses that reminder rather than sending it twice. The owner digest does the same with `owner_digests_sent` (unique per business and date).
- **Which stage:** a pure function (`src/server/domain/reminders/schedule.ts`, property-tested) picks the latest stage reached within a 2-day catch-up window and never one already sent, so a missed day still sends, a stage never repeats and never comes after a later one. An invoice due on receipt gets no "due today" email (the customer was just handed it).
- **Time budget:** the job starts no new business after 45 seconds and reports `stoppedEarly`; the rest wait for tomorrow, inside the catch-up window. It logs one summary line with counts only (no names, emails or amounts).
- **Opt-in for customers:** email reminders are off until the owner turns them on in Settings; the owner digest is on. Demo businesses are skipped by the admin read and again by the services, and `sendEmail` refuses them anyway (SPEC F12). Without email set up (on Vercel, no `RESEND_API_KEY`) the job sends and claims nothing.

## Consequences

- Running the job by hand is safe: `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/daily` (runbook).
- With many businesses, one run may not reach them all. At 25 per batch and a few hundred milliseconds each, that is hundreds of businesses a day; a queue (Upstash QStash) is the next step when the summary shows `stoppedEarly` regularly.
- No retry queue: a failed email is counted and retried on the next daily run (within the catch-up window). Resend's free tier (100 a day) is the pilot's ceiling.
- WhatsApp reminders (`reminders_sent` channel `WHATSAPP`) are still sent by people from the customer page; the job only emails.
