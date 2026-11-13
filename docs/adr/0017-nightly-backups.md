# ADR 0017: Nightly encrypted backups to Backblaze B2

- **Status:** Accepted
- **Date:** 2026-11-13

## Context

SPEC §6 needs backups and a tested restore. On Neon's Free plan, point-in-time restore covers only the last **6 hours**, and scheduled snapshots aren't available. A mistake noticed the next day (a bad migration, deleted data) couldn't be undone. Galla holds shops' tax invoices, so a lost day matters.

The plan (decision 11) was Cloudflare R2. Its setup asks to "complete the checkout flow" for an R2 subscription, and its billing policy talks about preauthorising cards. The owner wants no payment method on any service. Backblaze B2 states "First 10GB storage is always free" and "No credit card required", so it is used instead (the plan's alternative).

## Decision

- **`.github/workflows/backup.yml`** runs nightly at 21:30 UTC (03:00 IST) and from the Actions tab. It runs on GitHub's free runners (public repository).
- **Dump:** `pg_dump --format=custom --no-owner --no-privileges`, run from the `postgres:18-alpine` image, so the client is never older than Neon's server. Compressed, restorable into any empty database.
- **Encrypt:** [`age`](https://age-encryption.org) to a **public key committed in the repo** (`.github/backup/age-recipient.txt`). The private key never touches GitHub, Backblaze or Vercel: the owner keeps it offline. A leaked bucket or a compromised workflow yields only ciphertext.
- **Store:** a private Backblaze B2 bucket with Backblaze's encryption at rest, through B2's S3-compatible API (the AWS CLI already on the runner). A lifecycle rule hides files after 30 days and deletes them a day later. The application key is limited to that one bucket.
- **Fail loudly:** missing secrets, a non-key in the recipient file, a dump under 10 KB, a file that isn't age output, or an upload whose size doesn't match all fail the run, and GitHub emails the owner about failed scheduled runs.
- **Secrets** (GitHub → Actions secrets): `BACKUP_DATABASE_URL` (Neon, direct connection, not pooled), `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_BUCKET`, `B2_ENDPOINT`. The workflow runs only on schedule or by hand, never for pull requests, so code from a PR can't read them.
- **Restore** is documented in `docs/restore.md`: decrypt, `pg_restore` into a throwaway Docker Postgres, compare with `scripts/backup/check.sql` (counts, newest invoice, next numbers; no personal data). A real recovery restores into a new Neon branch and points Vercel at it.
- **Tested:** a monthly restore (runbook). The first test was done when the workflow went live.

## Consequences

- At most a day of data can be lost, plus whatever changed in the 6 hours Neon can rewind.
- If the owner loses the private key, every backup is unreadable. `docs/restore.md` says how to rotate it; the old key stays until its backups expire.
- The `.dump` file is unencrypted once decrypted; the restore steps delete it afterwards.
- About 30 small files a month, well under B2's free 10 GB. If B2 ever asks for payment, the workflow fails and emails the owner; nothing else in the app depends on it.
