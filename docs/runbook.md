# Runbook

To be written in Phase 11: rolling back a deploy, restoring the database, rotating secrets, and handling invoice numbers out of sequence (SPEC §6.4).

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
