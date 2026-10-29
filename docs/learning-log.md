# Learning log

What I learned and what broke while building Galla, phase by phase.

## Phase 1: scaffold

- Next.js 16 with `cacheComponents` prerenders route handlers by default. A health check must call `await connection()` so it runs on every request.
- Neon's serverless `Pool` talks WebSockets, so it cannot connect to plain Docker Postgres. The DB client picks `node-postgres` locally and Neon in production, behind the same Drizzle API.
- pnpm 12 blocks dependency install scripts by default. Allowed builds are listed in `pnpm-workspace.yaml` (`allowBuilds`).
