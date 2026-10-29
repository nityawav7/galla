# Galla

GST billing and udhaar for small Indian shops. Create a GST-correct invoice in under 60 seconds on a phone, share it on WhatsApp with a UPI QR, track who owes what, and hand your CA a one-click GST sales export.

> **Status:** early development (Phase 1 of [BUILD_PLAN.md](BUILD_PLAN.md)). Not tax or legal advice.

- **Live demo:** _coming in Phase 12_
- **2-minute video:** _coming in Phase 12_
- **Spec:** [SPEC.md](SPEC.md) · **Engineering rules:** [CLAUDE.md](CLAUDE.md) · **Decisions:** [docs/adr](docs/adr)

## Tech stack

Next.js (App Router) · TypeScript (strict) · Tailwind CSS + shadcn/ui · Drizzle ORM · PostgreSQL (Neon) · Vitest + fast-check · Playwright · GitHub Actions · Vercel

## Run locally

Requires Node 24 (see `.nvmrc`), pnpm and Docker Desktop.

```bash
pnpm install
cp .env.example .env.local
pnpm db:up          # Postgres 16 in Docker (also creates the galla_test database)
pnpm db:migrate
pnpm dev            # http://localhost:3000, health check at /api/health
```

## Tests and checks

```bash
pnpm check              # lint, format check, typecheck, unit and integration tests
pnpm test:unit          # Vitest, no infrastructure needed
pnpm test:integration   # Vitest against the galla_test database (needs pnpm db:up)
pnpm test:e2e           # Playwright, desktop and 360 px mobile
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/). A pre-commit hook runs ESLint and Prettier on staged files.

## Architecture

_Diagram and write-up coming in Phase 11 ([docs/architecture.md](docs/architecture.md))._

## Metrics

_Load test p95 and Lighthouse scores coming in Phase 11._

## Roadmap

See [SPEC.md §11](SPEC.md#11-roadmap-after-v1).
