# Runbook

To be written in Phase 11: rolling back a deploy, restoring the database and rotating secrets (SPEC §6.4).

## Invoice numbers out of sequence

Numbers are assigned only when issuing, from `number_sequences` (one row per business, series `INV`/`CN` and FY), in the same transaction as the invoice ([ADR 0006](adr/0006-gapless-numbering-and-immutable-invoices.md)). A failed issue rolls the counter back, so gaps should never happen.

If someone reports a gap or a duplicate:

1. **Never edit or delete an issued invoice or a number.** The database refuses it anyway (SQLSTATE `23001`). Cancelled invoices keep their number on purpose.
2. Compare the counter with what was issued, in the Neon SQL editor (replace the business id):
   ```sql
   select s.series, s.fy, s.next_value - 1 as last_taken,
          count(i.id) as issued, max(split_part(i.number, '/', 3)::int) as highest
   from number_sequences s
   left join invoices i on i.business_id = s.business_id and i.fy = s.fy
     and s.series = 'INV' and i.status <> 'DRAFT'
   where s.business_id = '<business id>'
   group by s.series, s.fy, s.next_value;
   ```
   For `INV`, `last_taken`, `issued` and `highest` should be equal.
3. A "gap" the owner sees is usually a changed prefix (the counter continues across prefixes), a new FY starting at 0001, or a cancelled invoice. Explain it; don't fix it.
4. If the counter really is behind the highest number (only possible after a manual database change), set `next_value` to `highest + 1` in a transaction, and write down why in `docs/learning-log.md`. Never lower it.

## E2E after deploys

`.github/workflows/e2e-deployed.yml` runs the Playwright suite after every successful Vercel deployment. It needs:

1. **Vercel → Project → Settings → Git → repository_dispatch Events: on.** Without it the workflow never starts.
2. **The `VERCEL_AUTOMATION_BYPASS_SECRET` repository secret.** Vercel sends the deployment's own URL, which Vercel Authentication protects (production included). Create the secret in Vercel → Settings → Deployment Protection → Protection Bypass for Automation, then add it in GitHub → Settings → Secrets and variables → Actions. Rotating it in Vercel means updating it in GitHub too.

If the run fails with "VERCEL_AUTOMATION_BYPASS_SECRET is not set" or a health check status of 302/401, step 2 is missing or out of date. To re-run against any URL, use **Actions → E2E on Vercel deployment → Run workflow** and paste the URL.

## Database migrations and seed

- Every Vercel build runs `db:migrate`, then `db:seed:reference` (states, tax rates, units; idempotent upserts), then `build`. A failed migration fails the deploy, so the previous deployment keeps serving.
- **Preview deployments must have their own Neon branch** (Vercel → project → Storage → the Neon database → deployments setting, with Preview ticked). Otherwise a PR's build would migrate the production database before merge.
- To change reference data (a new GST rate, a renamed state), edit `src/server/db/seed/reference.ts` and deploy. Rows are never deleted, because old invoices refer to them; retire a rate with `active: false`.
- `pnpm db:seed` (with the dev business) refuses to run against a Neon database.

## Auth, email and rate-limit settings

Set these in **Vercel → Project → Settings → Environment Variables**. Each one lists the environments it belongs in. A change takes effect on the next deployment.

| Variable                                             | Environments                           | Notes                                                                                                                                                                                          |
| ---------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                                 | Production, Preview (different values) | `openssl rand -base64 32`. Signs sessions: rotating it signs everyone out. The build fails without it.                                                                                         |
| `BETTER_AUTH_URL`                                    | optional                               | Defaults to the production domain in Production and the deployment URL in Preview. Set it once there is a custom domain.                                                                       |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Production (Preview optional)          | Added by the Upstash integration (it may name them `KV_REST_API_URL` / `KV_REST_API_TOKEN`, which also work). **Without them every sign-in in production fails** with "Rate limiting needs …". |
| `RESEND_API_KEY`                                     | Production, Preview                    | Without it, emails are dropped with a warning in the logs. Until a domain is verified in Resend, only the Resend account owner receives emails.                                                |
| `EMAIL_FROM`                                         | optional                               | Defaults to Resend's shared sender. Set it to an address on the verified domain once there is one.                                                                                             |
| `CRON_SECRET`                                        | Production, Preview                    | `openssl rand -base64 32` (at least 32 characters). Vercel Cron sends it to `/api/cron/daily`; without it the route answers 503 and no reminders or digests go out.                            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`           | Production                             | The Google button only shows when both are set. The OAuth client's redirect URI must be `<production origin>/api/auth/callback/google`.                                                        |

If sign-in breaks after a deploy, check the function logs for `[Better Auth]`. A "Drizzle schema mismatch" means a Better Auth upgrade expects a column we don't have: add a migration, never edit `0002_auth`.

## The daily job

Vercel Cron calls `GET /api/cron/daily` at 03:30 UTC (09:00 IST) with `Authorization: Bearer <CRON_SECRET>` ([ADR 0014](adr/0014-daily-job.md)). On Hobby it runs once a day, some time in that hour.

- **Did it run?** Vercel → Project → **Logs**, search `daily job finished`. The line has counts only: `businesses`, `reminderEmails`, `reminders`, `digests`, `failed`, `stoppedEarly`, `emailSetUp`. Vercel → Settings → **Cron Jobs** shows the schedule and lets you run it now.
- **Run it by hand** (safe: nothing already sent is sent again):
  ```bash
  curl -H "Authorization: Bearer <CRON_SECRET>" https://<production host>/api/cron/daily
  ```
  401 means the secret is wrong; 503 means `CRON_SECRET` isn't set in that environment.
- **`emailSetUp: false`:** `RESEND_API_KEY` isn't set, so the job sent and recorded nothing.
- **`failed` above 0:** look for `reminder email failed` or `owner digest failed` (business and customer ids only). Their reminders are retried on the next run, up to 2 days late.
- **`stoppedEarly: true` often:** the 45-second budget ran out; the rest waited for the next day. Time to move the job to a queue (ADR 0014).

## Finding a request in the logs

Every page response has an `X-Request-Id` header: Vercel's own request id (`x-vercel-id`) when there is one. Every log line written while serving that request has the same `requestId` (and `businessId` once known). To follow up a user's report: get the time and page, find the request in Vercel → **Logs**, and search for its `requestId`. Logs never hold names, phones, emails or GSTINs (CLAUDE.md rule 9).

## A page stops working after a deploy, with nothing in the logs

Check the browser console for "violates the following Content Security Policy directive" ([ADR 0015](adr/0015-csp-with-nonces.md)). A new third-party script or service must be added to the policy in `src/server/http/security-headers.ts`; a page that is prerendered again (for example after turning `cacheComponents` back on) loses the nonce on all its scripts.

## Sentry and PostHog (ADR 0016)

Both are off until their keys are in Vercel (Settings → Environment Variables, Production and Preview), and a redeploy is needed after adding them (the `NEXT_PUBLIC_` ones are built into the page).

| Variable                       | Where it comes from                                                    |
| ------------------------------ | ---------------------------------------------------------------------- |
| `NEXT_PUBLIC_SENTRY_DSN`       | Sentry → project → Settings → Client Keys (DSN)                        |
| `SENTRY_AUTH_TOKEN`            | Sentry → Settings → Auth Tokens → Create (scope: project releases)     |
| `SENTRY_ORG`, `SENTRY_PROJECT` | the slugs in the Sentry project URL                                    |
| `NEXT_PUBLIC_POSTHOG_KEY`      | PostHog → Project settings → Project API key                           |
| `NEXT_PUBLIC_POSTHOG_HOST`     | `https://us.i.posthog.com` or `https://eu.i.posthog.com` (your region) |

In PostHog's project settings also turn on **Discard client IP data** and leave autocapture, session replay, heatmaps and "capture console logs" off.

**Checking it works:** after the deploy, Sentry → Issues shows nothing until an error happens. To test, open the browser console on the production site and run `setTimeout(() => { throw new Error("Sentry test") })`: the issue appears in Sentry within a minute, with `/b/:slug` instead of the shop's name. PostHog → Activity shows `invoice_issued` after you issue an invoice.

**If events stop:** our routes answer 500 (`/api/monitoring`) or 502 (`/api/relay`) when Sentry or PostHog is unreachable; check their status pages. A 404 from `/api/relay` means `NEXT_PUBLIC_POSTHOG_KEY` isn't set on that deployment.

**Rotating:** create a new Sentry DSN or auth token or PostHog key, update Vercel, redeploy, then revoke the old one.
