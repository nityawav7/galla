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
