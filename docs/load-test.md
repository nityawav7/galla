# Load test: issuing invoices

`load/issue-invoice.js` is a [k6](https://k6.io) script. Ten people each create a draft and issue it, over and over, for one minute, through the **real server actions** (the same requests the invoice builder sends), with a 1.5 s pause between invoices. Decision 13 of the Phase 11 plan: it runs against a **local production build with local Postgres**, never against Vercel or Neon (free-tier limits, and it would fill the real database).

## Results (2026-11-13)

**10 users** (decision 13 of the Phase 11 plan):

|                                          | p50   | p95        | max    |
| ---------------------------------------- | ----- | ---------- | ------ |
| Create a draft                           | 74 ms | **189 ms** | 266 ms |
| Issue it (lock, number, snapshot, audit) | 94 ms | **249 ms** | 341 ms |
| All requests                             | 86 ms | 219 ms     | 341 ms |

- **355 invoices in 60 s** (5.8 a second), **0 failed requests**, 710 of 710 checks passed.

**50 users** (SPEC §8's test table):

|                | p50    | p95       | max   |
| -------------- | ------ | --------- | ----- |
| Create a draft | 1.34 s | **3.2 s** | 4.3 s |
| Issue it       | 1.73 s | **2.6 s** | 2.9 s |
| All requests   | 1.51 s | 2.65 s    | 4.3 s |

- **687 invoices in 60 s** (10.9 a second), **0 failed requests**, 1,374 of 1,374 checks passed. The 1 s threshold fails at this load.
- **Why it slows:** throughput only doubled for five times the users, so the single local server was saturated. It is one Node process with a pool of 10 database connections (`src/server/db/client.ts`), and 50 users queue for them. On Vercel each function instance has its own connections to Neon's pooler, so production scales out instead of queueing. That wasn't measured here, on purpose (no load on Vercel or Neon).
- **For scale:** 50 people each issuing an invoice every 1.5 seconds is about 120,000 invoices an hour. A busy shop issues a few hundred a day.

**Numbering held under both loads:** in all 60 test shops, invoices ran from `INV/26-27/0001` with no gaps and no duplicates (1,102 invoices, checked in the database afterwards).

**Machine:** Intel Core i5-12450H (8 cores, 12 threads), 16 GB RAM, Windows 11. `next start` (production build, Next.js 16, Node 24) and Postgres 16.15 in Docker on the same laptop; k6 1.4.0 in Docker.

Production differs in three ways. Vercel's functions run in Singapore (`sin1`, `vercel.json`) next to the Neon database, which is also in Singapore. Neon's free compute is smaller and sleeps when idle, so the first request after a pause is slower. This test measures the app's own cost and its locking, not Vercel's.

## Running it

```bash
docker compose up -d                 # local Postgres
pnpm build && pnpm start             # a production build on http://localhost:3000
pnpm load:seed 10                    # 10 users, a business each, signed in; writes load/.users.json and load/.actions.json
docker run --rm -i -v "$PWD/load:/load" -e BASE_URL=http://host.docker.internal:3000 grafana/k6:1.4.0 run /load/issue-invoice.js
```

- On Windows (Git Bash) use `-v "$(pwd -W)/load:/load"` and prefix the command with `MSYS_NO_PATHCONV=1`.
- `pnpm load:seed` refuses a Neon database.
- **Why the seed script signs in on the server:** the sign-in route allows 5 a minute per IP.
- **Why the pause:** each user stays under the 120 changes a minute limit.
- The action ids change with every build, so run `pnpm load:seed` after `pnpm build`.
- **Thresholds:** p95 under 1 s for both steps, and 99% of checks passing. k6 exits non-zero if either fails.
- **Clean up:** the load-test shops are named `Load Test Shop N`, and the users `load-…@example.com`. Recreate the local database (`docker compose down -v`) to remove them.
