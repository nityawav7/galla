# ADR 0001: One Next.js app on Vercel, Postgres on Neon

- **Status:** Accepted
- **Date:** 2026-10-29

## Context

Galla is built and run by one developer on free tiers. It needs a mobile-first UI, server-side business logic with database transactions (gapless invoice numbering), a few daily background jobs, and cheap per-PR preview environments. Uptime-hour limits on free "always-on" servers make a separate API server awkward.

## Decision

- **One full-stack Next.js (App Router) app** in TypeScript `strict`, deployed to **Vercel** (preview per PR, production on `main`).
- Business logic is layered inside the app (SPEC §7.2): thin route handlers/server actions → services → pure domain + tenant-scoped repos. The domain layer has no framework or DB imports, enforced by ESLint `no-restricted-imports`.
- **PostgreSQL on Neon** with **Drizzle ORM**. In production we use Neon's serverless `Pool` (WebSockets) because interactive transactions with row locks are required. Locally and in CI we use plain Postgres 16 in Docker via `node-postgres`. `src/server/db/client.ts` picks the driver from the host (`*.neon.tech` → Neon), and both expose the same Drizzle API.
- Background work runs as **Vercel Cron → route handlers** (daily on Hobby), with no worker process.

### Toolchain versions (as of this ADR)

- **Node 24 LTS**, pinned in `.nvmrc` and `engines`. Node 26 became LTS on 28 Oct 2026; move once Vercel supports it.
- **TypeScript 6.0**, not 7.0. TS 7 is the new Go-native compiler. typescript-eslint (supports `<6.1`) and Next's TS plugin still depend on the JS compiler API. Revisit when they support 7.
- **ESLint 9**, not 10. `eslint-plugin-react` (bundled by `eslint-config-next`) does not support ESLint 10 yet.

## Consequences

- One deploy, one repo, one language. Easy to demo and to explain.
- Serverless limits apply: functions are short-lived, so long jobs must be batched and idempotent. Connection pooling relies on Neon's pooler.
- Two DB drivers mean a small risk of behaviour differences between local and production. Mitigation: e2e tests run against Vercel previews backed by a Neon branch.
- Vercel Hobby is for non-commercial use. If Galla charges money, move to Pro.
- If heavy background processing is ever needed, add Upstash QStash or a separate worker rather than restructuring the app.
