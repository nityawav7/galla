# Learning log

What I learned and what broke while building Galla, phase by phase.

## Phase 1: scaffold

- Next.js 16 with `cacheComponents` prerenders route handlers by default. A health check must call `await connection()` so it runs on every request.
- Neon's serverless `Pool` talks WebSockets, so it cannot connect to plain Docker Postgres. The DB client picks `node-postgres` locally and Neon in production, behind the same Drizzle API.
- pnpm 12 blocks dependency install scripts by default. Allowed builds are listed in `pnpm-workspace.yaml` (`allowBuilds`).
- Vercel picks the pnpm version from the lockfile format (`9.0` → pnpm 9 or 10), not from `packageManager`. `vercel.json` pins pnpm 12 in the install and build commands; keep it in sync with `packageManager`. Region, install and build settings live in `vercel.json` so they are versioned instead of hidden in the dashboard. Node 24 comes from `engines`.
- The first `/api/health` after a quiet period returned `degraded`: Neon had suspended the database and waking it took longer than the 2 s check timeout. Raised it to 8 s so uptime monitors don't report false outages.
- CI silently never ran for the first three pushes: `ci.yml` used `${{ env.X }}` inside a job-level `env:`, where GitHub doesn't allow the `env` context, so the whole file was rejected (the run shows the file path instead of the workflow name). A green CodeQL check hid it. Lint workflows before pushing: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest`.
- Vercel now recommends `repository_dispatch` (`vercel.deployment.success`) over `deployment_status` for running tests after a deploy. Those events only trigger workflows that already exist on `main`.

## Phase 2: GST domain engine

- `bigint` keeps paise exact at any size, but `JSON.stringify` throws on it. Amounts cross JSON boundaries (fixtures, server actions) as strings and are parsed with `parseRupees` / `parseQuantity`.
- Rounding each CGST/SGST half separately keeps them equal, but an intra-state total can then differ from the inter-state total by a paisa (0.25% on ₹100: 0.13 + 0.13 vs 0.25).
- Tax-inclusive prices can land 1 paisa under MRP after back-calculation (₹10 at 18% → ₹9.99). Property tests prove it is never more than 1 paisa for rates below 100%.
- `?? ""` fallbacks on array lookups that can never miss still count as uncovered branches. A small typed lookup helper keeps 100% branch coverage honest without `v8 ignore` comments.
- Vitest's `toThrow(errorInstance)` compares the error's own properties too (e.g. `issues`); match on the message instead.

## Ops: e2e after Vercel deploys

- Vercel only sends `repository_dispatch` events (e.g. `vercel.deployment.success`) when **Project Settings → Git → repository_dispatch Events** is on. With it off, the workflow sits on `main` and never runs, with no error anywhere.
- Vercel's payload `url` is not documented as including `https://`, so `playwright.config.ts` adds it when missing. GitHub also turns a missing expression into an empty string, which must count as "not set".
