# Learning log

What I learned and what broke while building Galla, phase by phase.

## Phase 1: scaffold

- Next.js 16 with `cacheComponents` prerenders route handlers by default. A health check must call `await connection()` so it runs on every request. (`cacheComponents` was turned off in Phase 11a, ADR 0015; the call stays.)
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
- The payload `url` is the deployment's own address (e.g. `galla-abc123-….vercel.app`), not the production domain, and Vercel Authentication protects it even for production. Without the bypass secret, Playwright followed the redirect to `vercel.com/login`, got a 200 and failed on the missing heading, which looked like an app bug. The health test now refuses redirects and says why.
- Vercel's payload `url` is not documented as including `https://`, so `playwright.config.ts` adds it when missing. GitHub also turns a missing expression into an empty string, which must count as "not set".

## Phase 3: database schema and tenant isolation

- drizzle-kit 0.31 crashes with "Do not know how to serialize a BigInt" on `.default(0n)`. Give `bigint` columns an SQL default instead: ``.default(sql`0`)``.
- With `casing: "snake_case"`, `phoneE164` becomes `phone_e_164`. Name such columns explicitly (`text("phone_e164")`) and read the generated SQL before committing.
- A CHECK that evaluates to NULL passes. `length(trim(cancel_reason)) > 0` let a cancelled invoice with no reason through; `coalesce(…, 0) > 0` fixes it. Test the NULL case of every CHECK on a nullable column.
- Postgres reports only the first failing CHECK (checked in name order), so each constraint test must break exactly one rule, or it passes for the wrong reason.
- Composite foreign keys on `(business_id, id)` make cross-tenant links impossible in the database itself, not just in the repos.
- pg_trgm's `<%` operator uses a 0.6 word-similarity threshold, which misses one-letter typos in short words ("basmti" scores 0.57 against "Basmati"). The repos compare `word_similarity` with an explicit 0.5.

## Phase 4a: sign-in

- Better Auth checks the Drizzle schema at startup and refuses required columns it never writes (`businesses.gst_scheme`, `state_code`). Declaring them as `additionalFields` with `input: false` satisfies the check without letting its endpoints set them.
- Better Auth looks `verifications` rows up by ids it derives itself, which aren't UUIDs, so that one table needs a `text` id. A `uuid` column fails at the first code sign-in, not at sign-up, so test every flow against real Postgres.
- Better Auth's built-in rate limiter counts in memory, which serverless instances don't share. Ours wraps the route handler and uses Upstash in production.
- Next 16 keeps pages you visited earlier mounted but hidden (React Activity). In Playwright, `getByLabel("Email")` then matches the hidden sign-up form too; filter with `{ visible: true }`.
- `getByLabel` also matches elements labelled _by_ another element, such as a tab panel named after its "Password" tab. Pair it with `locator("input")`.
- The `auth` instance is cached on `globalThis`, so config changes need a dev-server restart.

## Phase 4b: onboarding and tenant pages

- With Cache Components, pages stream. A `notFound()` inside a Suspense boundary shows the 404 page but keeps HTTP 200, because the headers are already sent. A real 404 for non-members has to come from the proxy (it rewrites to an unmatched path).
- Zod 4 runs an object-level `superRefine` even when a field inside already failed, so cross-field rules must guard against invalid inputs (an invalid state code produced a second, confusing GSTIN error).
- `getByRole("button", { name: "Next" })` also matches Next.js's own "Open Next.js Dev Tools" button in dev. Use `exact: true`.
- The auth rate limit (5 sign-ups a minute per IP) also limits the e2e suite, which runs from one IP. Each account-creating test runs in one browser size only.
- React `cache()` makes `requireTenant(slug)` run once per request even though the layout and the page both call it.

## Phase 4c: invites and members

- Better Auth serves every plugin endpoint over HTTP, including organization ones that would bypass our permission checks and audit log. Its `disabledPaths` only takes exact paths, so the route handler blocks the whole `/api/auth/organization/` prefix and services call `auth.api.*` instead.
- Better Auth's member hooks receive the affected user, not the one acting, so they cannot fill an audit row's actor. The service, which has the `TenantContext`, writes it.
- An id from a URL must be checked before it reaches a `uuid` column, or a typo becomes a 500 (`invalid input syntax for type uuid`) instead of a 404.
- Vitest's global setup failing (here: Docker not running) shows up only as "code.charCodeAt is not a function". Check `docker ps` first.
- After a restart the dev server compiles each page on first visit (4–30 s), which breaks 5 s Playwright assertions. Local runs now wait 15 s; CI uses a production build.

## Phase 5a: products and CSV import

- Audit diffs are JSON, and `JSON.stringify` throws on `bigint`. Money goes into the diff as a string of paise.
- `z.union([z.boolean(), z.string().refine(…)])` reports a failed refine as "Invalid input", which loses the message key. A single `transform` that adds the issue itself keeps it.
- Keyset pagination compares `(name, id) > (last name, last id)`, so rows with the same name are neither skipped nor repeated. It needs an index on `(business_id, name, id)`.
- Writing `"\uFEFF"` through some tools stores the invisible byte order mark itself in the source. Keep it as the escape, so reviewers can see it.
- The in-app browser can't attach files, and scripts run in an isolated world, so React never sees a faked `change` event. Playwright's `setInputFiles` is the reliable way to test an upload.

## Phase 5b: customers

- Next keeps pages visited earlier mounted (hidden), React state included. After "Add customer" saved and went back to the list, opening the form again showed the old values. Forms now `reset()` before navigating away, and the e2e test checks that the form is empty when reopened.
- Docker Compose names its project after the folder. Running `pnpm db:up` from a git worktree started a second, empty Postgres (`customers-postgres-1`) instead of the usual `galla-postgres-1`. Start the existing container instead (`docker start galla-postgres-1`).
- The Neon free plan allows 10 database branches, and every Vercel preview makes one. Merged PRs' preview branches have to be deleted, or the next preview fails with "Branch limit reached".
- GitHub uses the PR title as the squash commit message, so the title should already be a Conventional Commit (`feat(customers): …`).

## Phase 6a: drafts and issuing

- A Postgres upsert (`INSERT … ON CONFLICT DO UPDATE … RETURNING`) both creates a missing counter and locks it until commit, so it replaces "SELECT … FOR UPDATE, then INSERT if missing", which races when two issues start a new financial year at once.
- Taking the number as the _last_ step of the issue transaction keeps the counter locked for a few milliseconds instead of the whole issue.
- `to_jsonb(NEW) - ARRAY[...]` compares a whole row except some columns in a trigger, so a column added later is protected without touching the trigger.
- New CHECK constraints fail on rows written before them. The migration backfills old test and dev rows first, then adds the constraint.
- Python's text mode on Windows writes CRLF. Writing files with `newline=""` keeps them LF, which Prettier and git expect.

## Phase 6b: invoice builder

- Running the very same evaluation function in the browser and on the server (`evaluateDraft`) means the live totals can't drift from what gets issued, and the server still never trusts them.
- `window.history.replaceState` changes the URL from `/new` to `/{id}/edit` after the first autosave without remounting the page, so typing isn't interrupted.
- After adding a line from a search panel, the panel unmounts and takes focus with it. React Hook Form's `focusName` didn't win that race; focusing the new field in an effect after it renders does.
- In Playwright, `getByRole("button", { name: /Nails/ })` also matched "Add “Nails” as a one-off item", which appears before the search results load. Anchored names (`/^Nails/`) wait for the real result.
- A nested `<form>` inside a portal still bubbles its submit event through React to the outer form, so the builder is not a `<form>`; the inline customer form lives in a dialog.

## Phase 6c: cancel and credit notes

- Crediting part of a line as `F(after) − F(before)`, where F scales the stored line amounts, makes any series of partial returns add up to the original line to the paisa. Recomputing each return from the rate does not.
- A migration that must touch rows guarded by an append-only trigger can pause that one trigger (`DISABLE TRIGGER name`) around the update and turn it back on in the same migration.
- A Postgres constraint that a foreign key points at must exist before the foreign key: drizzle-kit generated them in the wrong order, so the migration was reordered by hand before merge.
- The first e2e run on a cold dev server can time out while pages compile; the same test passes warm and in CI, which runs a production build.

## Phase 7a: PDFs

- A short spike settled the biggest risk first: react-pdf 4.9 (fontkit) shapes Devanagari conjuncts, reph and pre-base vowel signs correctly, and `fontFamily` takes an array, so a line can mix Latin and Hindi with per-character fallback.
- Text extracted from a PDF comes out in visual glyph order for Devanagari, so text snapshots can't compare Hindi; the Latin text is snapshotted and the Hindi checked by eye.
- In react-pdf, `wrap={false}` ("don't split this block") on a page with no fixed height starts a new page for every such block: the 80 mm slip came out as five pages until it was removed.
- `useSyncExternalStore` with a server snapshot reads `localStorage` without a hydration mismatch and without a "setState in an effect" lint warning.
- Cutting a payee name to 50 characters with `[...text]` can split a Hindi letter from its vowel sign; `Intl.Segmenter` cuts by grapheme.

## Phase 7b: public link

- A streamed page can't change its status code once it starts, so "this link is dead → 404" has to happen in the proxy, before rendering. The page still calls `notFound()` as a backup.
- Headers set on `NextResponse.next()` in the proxy reach the final response, so one place adds `noindex`, `no-referrer` and `no-store` for every `/i/*` answer.
- ESLint's `no-restricted-imports` can enforce an architecture rule ("only this one service may look up invoices by token") with a later config block that relaxes the rule for exactly one file.
- A new link is a new token, not a flag: turning the old one back on would revive every copy ever forwarded.

## Phase 7c: WhatsApp share

- next-intl messages use ICU, where `{customer}` is an argument. Templates with our own placeholders are read straight from the JSON, never through `t()`.
- `String.replace` with a replacement _string_ expands `$&` and `$1`; a replacement _function_ inserts values literally. A test feeds a customer named `$&`.
- Storing the default template as null (and turning "saved unchanged" back into null) means improving the default reaches every shop that never edited it.
- The local dev database isn't migrated by `pnpm build`; the first e2e run after a new migration failed at "Create business" until `pnpm db:migrate` ran. Docker Desktop also doesn't start by itself after a reboot.

## Phase 8a: payments

- Drizzle leaves columns unqualified in a select list, so `${payments.id}` inside a correlated subquery rendered as plain `"id"` and quietly matched the subquery's own table. Printing `.toSQL()` found it; the subquery now names `"payments"."id"` explicitly. A property-style test (12 parallel payments) is what caught the wrong sum.
- A deferred constraint trigger (`DEFERRABLE INITIALLY DEFERRED`) checks sums across rows at commit, after the service has written the payment, its allocations and the invoices in whatever order; a plain CHECK can only look at one row.
- `UNIQUE NULLS NOT DISTINCT` (Postgres 15+) lets one unique key cover allocations whose payment or invoice end is null (the opening balance), and `ON CONFLICT` still infers it.
- Drizzle wraps database errors as "Failed query: …" with the Postgres error as `cause`; tests that look for a trigger's message walk the `cause` chain.
- One lock order for every money change on a customer (customer → payment → invoices by id) is simpler to reason about than per-function lock sets, and a test runs a payment, a credit note, a void and "Apply advance" at once to show it doesn't deadlock.

## Phase 8b: payment screens

- `role="status"` on an `<h2>` replaces its heading role, so `getByRole("heading")` can't find it; the live region now wraps the heading instead.
- Playwright won't `check()` a visually hidden (`sr-only`) radio inside a chip label; the test taps the label, as a person does, and then asserts the radio is checked.
- The first e2e run of the step expected "oldest first" to pay the invoice, but the customer had a ₹1,500 opening balance from an earlier step, and the app (rightly) paid that first. Tests that assert money flows have to start from the whole customer, not the one invoice in view.
- Docker Desktop stopping mid-session shows up as e2e failures everywhere (health check 503, sign-ups failing); check `docker ps` before reading anything into them.
- The preview tool reads `.claude/launch.json` from the main checkout, so previewing a worktree needs an entry that runs `pnpm --dir <worktree> start`.
- On CI, a click right after a menu tap latched onto the old page's link of the same name a moment before Next hid that page, then waited for it to be visible again until the test timed out. Next keeps earlier pages mounted (hidden), so Playwright never re-resolved the locator. Waiting for the new URL before tapping fixed it; locally the race never showed.

## Phase 8c: customer ledger, statement and reminder

- The statement and the customer page read the same `getCustomerLedger`, so the PDF's closing balance can't drift from the screen; the period ("This FY", "Since last FY", "All time") is a pure function of today's IST date.
- Balances print as Dr/Cr on the statement, the way a shop's books (and its CA) read them, but as "Owes you" / "Advance" on screen, where most owners aren't accountants.
- The reminder's text is built on the server from the ledger, so it always matches the books; the browser only picks the language and opens `wa.me`. Opening it calls a server action that writes the audit row; the link opens whether or not that call finishes.
- One list that is cards on a phone and a five-column grid from `md` up (`md:contents` on the amounts wrapper) avoids rendering the ledger twice, which would also have doubled every e2e locator.
- CI's `playwright install --with-deps chromium` stalled for 10–20 minutes and failed three runs in a row on PR #24, before any test ran; the browser CDN answered fine from a laptop, so the apt half was the likely culprit. GitHub's Ubuntu image already ships Google Chrome, so CI now sets `PLAYWRIGHT_CHANNEL=chrome` and skips the install. The job API (`/repos/{owner}/{repo}/actions/jobs/{id}`) shows each step's result without signing in, even when the logs need it.

## Phase 8d: credit notes on paid invoices, refunds

- Releasing money from an invoice is a small pure function (newest payment first, exact excess), and the service only writes what it returns; the property test checks the sum and that no row gives more than it holds.
- The invoice's paid and credited amounts change in one UPDATE: two UPDATEs would each have to pass the status CHECK on their own, with a made-up status in between.
- One deferred trigger function serves four tables (refunds, payments, allocations, customers) by looking at `TG_TABLE_NAME`; it finds the customer of an allocation through its payment when the row has none.
- A refund form's amount comes from on-account paise turned into rupees with the same integer helper as the payment form; `Number(paise) / 100` would have been the first float in a money path.

## Phase 9a: dashboard

- Seeding 10,000 invoices through the real issue path would take minutes; three set-based `INSERT … SELECT … FROM generate_series` statements take about a second. The immutability triggers rightly refuse lines on an issued invoice, so the seed runs with `set local session_replication_role = replica` inside its own transaction (test data only).
- `date ${value}` doesn't work as a bound parameter in Postgres (`date $3` is a syntax error); `${value}::date` does.
- The dashboard queries all used existing indexes (EXPLAIN ANALYZE: bitmap index scans, under 10 ms each), so no migration was needed; p95 was 133 ms against the 300 ms limit.
- Bars drawn as SVG on the server cost no JavaScript at all; a screen-reader table carries the same numbers, so the picture can stay `aria-hidden`.

## Phase 9b: reports

- `TextDecoder` drops a UTF-8 byte-order mark by default, so a test "the CSV starts with a BOM" failed on a correct file; `new TextDecoder("utf-8", { ignoreBOM: true })` keeps it.
- A formula-injection guard must not touch negative numbers: `-118.00` starts with `-` but is data, so only cells that aren't plain numbers get the leading apostrophe.
- `exceljs` looked like the default choice but hadn't been released since 2023 and carried nine old dependencies; a write-only library with one dependency did everything the reports need. Checking `npm view <pkg> time.modified dependencies` before adding anything took a minute.

## Phase 9c: GSTR-1 helper

- One property ("every rupee of taxable value lands in exactly one table") checks the whole classification at once, including credit notes that cross tables; it found nothing, but it is the test that would catch a double count.
- Zip archives store file names uncompressed, so a test can see that an .xlsx has ten sheets (`xl/worksheets/sheet10.xml`) without unzipping it.
- Docker Desktop doesn't start by itself after the laptop restarts overnight; the integration tests then fail at startup with an unhelpful stack-trace error rather than "connection refused".

## Phase 10a: email an invoice

- The plan was to write email templates as React components and render them with `react-dom/server`. Next.js builds server actions and route handlers against React's server-components build, where `react-dom/server` is a file that only throws "not supported in React Server Components". Vitest runs in plain Node, so the unit tests would have passed and the first click in production would have failed. Emails are built with a 30-line `html` tagged template instead: every value is escaped unless it is already `SafeHtml`, which is the same safety React gives, with no dependency.
- Better Auth sends invite emails as a background task and still returns the invite, so throwing from the email callback only logs an error; a demo business's invite skips the email instead, and the link is still there to copy.
- A per-business rate limit needs no new code: the existing Upstash limiter takes any key, so the business id is the key and the window is an hour.

## Phase 10b: the daily job

- "Claim, then send" makes idempotency a database question: `INSERT … ON CONFLICT DO NOTHING RETURNING` tells each run exactly which reminders are its own, even when two runs overlap, and deleting the claims after a failed send turns a lost email into a retry instead of a duplicate.
- A customer with no credit days gets a due date equal to the invoice date, not an empty one, so "due on receipt" has two spellings. A test caught the job about to send "due today" on the day of the sale.
- The test database keeps every business earlier runs created (13,000 of them), so a job test that walked them all would be slow and would claim other tests' digests. The job tests page over their own businesses through a mocked admin read, and the real admin read is tested by paging after a marker business: UUIDv7 ids sort by creation time.
- `connection()` from `next/server` throws outside a real request, so a route handler that calls it can't be tested by calling `GET` directly. Reading `request.headers` already makes a route dynamic.
- Request headers are trimmed by the `Headers` class, so "a trailing space" is not a case the secret check can ever see.
- ICU plurals in Hindi: `one` covers 0 and 1, so "{count, plural, one {# ग्राहक} other {# ग्राहकों}}" reads right for both.

## Phase 11a: security headers and CSP

- A nonce-based CSP and prerendered HTML don't mix: the build of `/login` had every script blocked by the new policy, silently (the page looked fine and did nothing). The browser's console was the only place it showed, so the e2e journey now fails on any CSP message. Turning off `cacheComponents` and awaiting `connection()` in the root layout made every page per-request, and all 18 scripts on `/login` then carried the nonce.
- The browser pane keeps console messages across reloads, so the first check after the fix still showed the old errors; comparing the nonce in the message with the one in the new response told them apart.
- pino's `mixin` plus `AsyncLocalStorage` puts the request id on every log line without passing a logger around; `requireTenant` adds the business id to the same store once it knows it.
- Searches and import previews are server actions too, and fire while typing (every 250 ms), so the mutation limit wraps only actions that change data (`runMutation`).

## Phase 11b: the activity page

- A keyset cursor on a `timestamptz` must keep Postgres's microseconds. A JavaScript `Date` rounds to milliseconds, so a cursor built from it skips rows that fall inside the same millisecond (or repeats them). The repo selects `at::text` for the cursor and compares `(at, id) < ($1::timestamptz, $2::uuid)`; the test moves rows by 1–2 µs to prove nothing is skipped.
- next-intl reads dots in message keys as nesting, so action names like `invoice.issued` became `audit.actions.invoice.issued` rather than a flat key with a dot in it.
- Showing audit rows safely meant an allow-list: only fields named in `src/server/domain/audit/describe.ts` are shown, each with a format (money, rate, state, enum). A new field in some future audit diff stays hidden until someone gives it a label, instead of leaking an id or hash.
- EXPLAIN on 40,000 rows for one business: Postgres turns `(at, id) < (…)` into an index condition `at <= …` on the existing `(business_id, at)` index, so a page 30,000 rows deep took 0.15 ms. No new index.

## Phase 11c: accessibility and Lighthouse

- axe's first run found real issues the eye missed: `text-muted-foreground` passes on white (4.7:1) but not on `bg-muted` (4.3:1), and red-600 text on a 10% red fill fails too. Fixing the two colour tokens fixed every page at once.
- `label-content-name-mismatch`: a button showing `{dueDate}` with `aria-label="Due date"` can't be clicked by voice ("click dueDate"); the accessible name has to start with the visible text.
- A table in an `overflow-x-auto` box needs `tabIndex={0}` (plus a role and label) so keyboard users can scroll it.
- Playwright `expect.soft` lets one run list every page's issues instead of stopping at the first.
- Lighthouse's default "simulated" throttling scored the same sign-in page 99 on a local production build and 83 on production; with real DevTools throttling both were about 60. The simulation flatters a server on the same machine, so production is the number that counts. Lighthouse also couldn't launch Playwright's bundled Chromium here (`spawn UNKNOWN`); the installed Chrome worked.
- Next's `polyfill` chunk (112 KB) is `noModule`, so modern browsers download nothing from it; count only the scripts that run.

## Phase 11d: Sentry and PostHog

- Measure before trusting an SDK's size: Sentry and PostHog imported up front took the sign-in page from 762 KB to 1.54 MB of JavaScript. Lazy loading (Sentry on idle, PostHog on first event) brought it to 775 KB.
- Two more surprises from counting bytes. `instrumentation-client.ts` made Turbopack ship a second copy of Next's router (about 130 KB). And `global-error.tsx`, which every page loads, had imported both message files (about 120 KB) to show one sentence.
- A Next.js rewrite to PostHog forwards the browser's cookies, including the session cookie. A small route handler that forwards only the body is safer and keeps the visitor's IP from PostHog too.
- posthog-js posts to `/e/`. Next's trailing-slash redirect turned that into a 308 to `https://localhost/...`, which the CSP blocked over plain HTTP. `skipTrailingSlashRedirect` plus a redirect in the proxy for pages fixed it.
- Sentry's SDK keeps its own reference to `fetch`, so patching `fetch` in the console shows nothing. The client's `beforeEnvelope` hook shows exactly what would be sent.
- pnpm's minimum release age refused a posthog-js published the same day; letting pnpm pick the newest allowed version beats adding an exception.

## Phase 11e: backups

- Check a service's free plan before building on it: Cloudflare R2's free tier still goes through a checkout flow for a subscription, and the owner wanted no card anywhere. Backblaze B2 says "No credit card required", and its S3-compatible API works with the AWS CLI already on GitHub's runners (with `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`, since B2 doesn't take the newer default checksums).
- `pg_dump` must be at least the server's major version, so the workflow runs it from the `postgres:18-alpine` image instead of whatever client the runner has.
- A pipe can hide a failed `pg_dump` (age happily encrypts an empty stream). `set -o pipefail` plus a minimum size and an `age-encryption.org/v1` header check catch it.
- The round trip was tested before going live: local database → `pg_dump --format=custom --no-owner --no-privileges` → `pg_restore` into an empty Postgres 18 → `check.sql` on both: identical.
- `age-keygen -o file` prints only the public key; the private key is only in the file, which surprised the owner. Say so in the instructions.

## Phase 11f: load test and runbook

- Server actions can be load-tested without a browser:
  - POST to the page with `Next-Action: <id>`, the arguments as a JSON array (`text/plain`), and `Origin` matching the host.
  - The ids are in `.next/server/server-reference-manifest.json` with each action's `exportedName`, and they change with every build.
  - The reply is React's stream format; the action's return value is the line with `"ok":`.
- Signing in through Better Auth's server API (`auth.api.signInEmail({ asResponse: true })`) gives a real session cookie without hitting the 5-a-minute sign-in limit, which is right for a seed script and wrong for anything public.
- Five times the users didn't bring five times the throughput: 50 users on one local Node process with a 10-connection pool queue for connections. What mattered more was that gapless numbering held under contention in every shop.
- The SPEC said 50 users and the plan said 10. Running both cost a minute and answered both.

## Phase 12a: the demo business

- Realistic demo data is mostly about _correctness_. Writing rows directly would have meant re-implementing GST, numbering, allocation, credit notes and refunds. Replaying a plan through the real services gets every number right by construction, and it took 37 s for six months of a shop.
- To replay the past, the services needed a movable clock. `AsyncLocalStorage` scopes it to one piece of work (`atTime`), so a request running at the same moment still reads the real time.
- Vercel's free plan allows 300 s per function with Fluid compute (on by default), not the 60 s assumed earlier. Check the current limits before designing around them.
- A deterministic plan needs its own seeded random generator (mulberry32) as well as `faker.seed`, and anything picked at random must not be picked twice: the first version could return the same line twice, more than was sold.
- The first plan made customers pay too rarely: 76% of what was owed was overdue. Looking at the dashboard with real eyes caught it; the tests couldn't.
- Database guards and a reset can coexist: a transaction-local setting plus `is_demo`, checked inside the trigger, lets exactly one job delete, and only in one business.

## Phase 12b: trying the demo

- **A shared account is a shared attack surface.** Hiding buttons wasn't enough; each risk was closed on the server:
  - The **settings** (a visitor's UPI ID on "Sharma Hardware" invoices is phishing with our name).
  - The **members** (locking others out).
  - The **account itself** (a new password or email takes the demo away from everyone).
  - **Sessions** ("sign out everywhere" signs every visitor out).
- **Better Auth's `hooks.before` sees both HTTP requests and server-side `auth.api` calls.** `ctx.request` is only set for the first, which is how the demo password works from our server action but not from a browser.
- Deriving the demo users' passwords from the auth secret (an HMAC) means no new setting to manage, and nothing to leak in the repo.
- A demo check placed after input validation reports "fix these fields" to a visitor who can't change anything at all. Check the demo first.

## Phase 12c: landing, privacy, terms

- `next start` serves only the files that were in `public/` at build time. Screenshots added after the build answered 404 until the next build, so make assets before building.
- Screenshots made by a script from the demo stay honest: they show the real app, banner and all, and are one command away from being redone after a UI change.
- **Looking at a screenshot found a real bug:** the public page said "Nothing is due" next to "Unpaid". Its condition was "no UPI block to show", which is also true for any shop without a UPI ID. Conditions should say what they mean (balance is zero), not what usually goes with it.

## After Phase 12: Sentry on the first error

- **Measure in production too.** The landing page scored 93 locally and 80 live. The local build had no Sentry DSN, so the SDK never loaded there. Test locally with the same settings as production (a placeholder DSN is enough).
- "Load it when the page is idle" isn't free: idle comes about a second after load, still inside the time a phone is busy, and Lighthouse counts it. For an error reporter, the honest trigger is the first error.
