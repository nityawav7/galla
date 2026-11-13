# Restoring a backup

Every night at 03:00 IST, the **Nightly backup** workflow dumps the production database, encrypts it to the owner's `age` key and uploads it to Backblaze B2 as `galla-YYYY-MM-DD.dump.age`. B2 deletes each file 30 days after upload. See [ADR 0017](adr/0017-nightly-backups.md).

You need:

- the private key file `galla-backup-key.txt`, which the owner keeps offline (password manager or USB stick). **Without it no backup can be opened.**
- `age` ([installing it](#installing-age)) and Docker Desktop.

## 1. Download the backup

Backblaze → **B2 Cloud Storage** → **Browse Files** → the backup bucket → click the file for the day you want → **Download**. Save it in a new, empty folder, for example `C:\restore`.

## 2. Decrypt it

In that folder (PowerShell or Git Bash):

```bash
age --decrypt --identity "C:\path\to\galla-backup-key.txt" --output galla.dump galla-2026-11-14.dump.age
```

## 3. Restore it into a throwaway database and check it

```bash
docker run -d --name galla-restore -e POSTGRES_PASSWORD=restore postgres:18-alpine
docker cp galla.dump galla-restore:/tmp/galla.dump
docker exec galla-restore pg_restore -U postgres -d postgres --no-owner --no-privileges --exit-on-error /tmp/galla.dump
docker exec -i galla-restore psql -U postgres -d postgres < scripts/backup/check.sql
```

`scripts/backup/check.sql` prints counts (businesses, invoices, payments…), the time of the newest invoice and the sum of the next invoice numbers. It prints no names, phones or other personal data. Run the same file against production (Neon console → **SQL Editor**, paste it) and compare. Production may have moved on since the backup, but nothing in the backup should be bigger than in production.

When done: `docker rm -f galla-restore` and delete the folder (the `.dump` file is **not** encrypted).

## 4. Only in a real disaster: make it the live database

1. **Neon console** → your project → **Branches** → **Create branch**, from `main`, named `restore-YYYY-MM-DD`. Then empty it: **SQL Editor** on that branch, `drop schema public cascade; create schema public; drop schema if exists drizzle cascade;`.
2. **Connect** → that branch → copy the connection string (**pooling off**).
3. Restore into it:

   ```bash
   docker run --rm -v "C:\restore:/restore" postgres:18-alpine pg_restore --no-owner --no-privileges --exit-on-error --dbname "<connection string>" /restore/galla.dump
   ```

4. Run `scripts/backup/check.sql` on the branch and compare.
5. Vercel → **Settings** → **Environment Variables** → `DATABASE_URL` (Production) → the new branch's **pooled** connection string → save → **Deployments** → **Redeploy**.
6. Anything written to production after the backup's time is not in it: invoices issued since then need re-issuing, and their numbers continue from where the backup left off.

## Restore test

Do steps 1–3 once a month (runbook), and after any change to the workflow, and write the date and the numbers in `docs/hardening-checklist.md`. A backup nobody has opened is a guess.

## Installing age

- Windows: `winget install --id FiloSottile.age` in PowerShell, then open a new terminal.
- macOS: `brew install age`. Linux: `sudo apt install age`.

## Losing or rotating the key

The private key can't be recovered, and nobody (including GitHub and Backblaze) can open the backups without it. To replace it:

1. Make a new pair: `age-keygen --output galla-backup-key-2.txt`.
2. Put the new **public** key (the `age1…` line it prints) in `.github/backup/age-recipient.txt` in a PR.
3. Keep the old private key until the last backup made with it has expired (30 days).
