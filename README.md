# Galla

GST billing and udhaar for small Indian shops. Create a GST-correct invoice in under 60 seconds on a phone, share it on WhatsApp with a UPI QR, track who owes what, and hand your CA a one-click GST sales export.

> **Status:** hardening before launch (Phase 11 of [BUILD_PLAN.md](BUILD_PLAN.md)). You can create an account, set up your business and invite your team; add or import products and customers; build and issue GST invoices on a phone with gapless numbers, cancel them or issue credit notes; download A4 or 80 mm PDFs with a UPI QR; share on WhatsApp or by email with a private link; record payments and track udhaar with ledgers, statements and reminders; see the dashboard; download the sales register, HSN summary and a GSTR-1 helper for your CA; get daily reminder and summary emails; and see every change in the Activity log. Not tax or legal advice.

- **Live demo:** _coming in Phase 12_
- **2-minute video:** _coming in Phase 12_
- **Spec:** [SPEC.md](SPEC.md) · **Engineering rules:** [CLAUDE.md](CLAUDE.md) · **Decisions:** [docs/adr](docs/adr)

## Tech stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS + shadcn/ui · next-intl · Drizzle ORM · PostgreSQL (Neon) · Better Auth · Upstash Redis · Resend · Vitest + fast-check · Playwright · GitHub Actions · Vercel

## Run locally

Requires Node 24 (see `.nvmrc`), pnpm and Docker Desktop.

```bash
pnpm install
cp .env.example .env.local
pnpm db:up          # Postgres 16 in Docker (also creates the galla_test database)
pnpm db:migrate
pnpm db:seed        # states, tax rates, units + a local "dev-shop" business (safe to re-run)
pnpm dev            # http://localhost:3000, health check at /api/health
```

Sign up at http://localhost:3000/signup. Without `RESEND_API_KEY`, sign-in codes are printed in the `pnpm dev` terminal instead of emailed.

## Tests and checks

```bash
pnpm check              # lint, format check, typecheck, unit and integration tests
pnpm test:unit          # Vitest, no infrastructure needed
pnpm test:integration   # Vitest against the galla_test database (needs pnpm db:up)
pnpm test:e2e           # Playwright, desktop and 360 px mobile
pnpm test:coverage      # unit + integration with the coverage gates (domain 100%, services 85%)
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). A pre-commit hook runs ESLint and Prettier on staged files.

## Architecture

The data model and data-access layers are in [docs/architecture.md](docs/architecture.md); the full write-up comes in Phase 11. Decisions are recorded in [docs/adr/](docs/adr/).

## Metrics

Lighthouse mobile (13.6.0, median of 3; details in [docs/hardening-checklist.md](docs/hardening-checklist.md)):

| Page                 | Performance | Accessibility |
| -------------------- | ----------- | ------------- |
| Sign-in (production) | 83          | 100           |
| Dashboard            | 94          | 100           |
| Invoice page         | 90          | 100           |
| Public invoice       | 99          | 100           |

Dashboard, invoice page and public invoice were measured on a local production build.

Load test (k6, through the real server actions, local production build; [docs/load-test.md](docs/load-test.md)):

| Users | Invoices in 60 s | p95 create draft | p95 issue | Failures |
| ----- | ---------------- | ---------------- | --------- | -------- |
| 10    | 355              | 189 ms           | 249 ms    | 0        |
| 50    | 687              | 3.2 s            | 2.6 s     | 0        |

Gapless invoice numbers held in every test shop. At 50 users the single local server process is the limit, not the database.

## Roadmap

See [SPEC.md §11](SPEC.md#11-roadmap-after-v1).
