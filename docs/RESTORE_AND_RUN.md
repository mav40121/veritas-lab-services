# Restore and Run: one page for a contract developer

For someone who has never seen this system and must bring VeritaAssure back after losing the production volume or the host. The longer references are `docs/disaster-recovery.md` (accounts, credential rotation) and `docs/BUILD_FROM_SOURCE.md` (clean-room build). Checked against the code on 2026-11-22.

## What it is

One Node 22 + Express server serving a built React client, with all records in one SQLite file (`/data/veritas.db`) and all stored documents under `/data/policies`, on one persistent volume. Production runs on Railway from this repo's `Dockerfile` (Node 22, Chromium for PDFs, Litestream 0.5.17). A merge to `main` deploys. A second Railway service, VeritaStock, runs the same code with its own volume; its backups sit under the `veritastock/` folder of the same bucket.

## Where the backups are (one Cloudflare R2 bucket: `BACKUP_S3_*` in Railway's variables)

| What | Key in the bucket | Kept | Restore with |
|---|---|---|---|
| Database, continuous (about 1 s behind) | `litestream/g<N>/veritas.db/` (N = highest number there; production's is in `/data/veritas.db.litestream-generation`) | 72 hours, any point in time | `litestream restore` (step 3a) |
| Database, hourly at :30 | `veritas-hourly-<time>.db.gz` | 7 days | download + gunzip (step 3b) |
| Database, nightly 04:00 UTC | `veritas-backup-<time>.db.gz` | 2 years | download + gunzip (step 3b) |
| Documents, nightly after the database copy | `files-manifest/veritas-files-<time>.json.gz` + `files/sha256/<hex>` | 2 years | `scripts/restore-files.mjs` (step 4) |

VeritaStock's copies have the same names with `veritastock/` in front. `/data/exports` is not backed up (it holds 24-hour export zips the app rebuilds on request).

## Restore

1. **Pick the point.** Newest state: continuous. Before a bad change made in the last 72 hours: continuous at a time. Older: the hourly or nightly copy before it.
2. **Build and configure the host.** Railway: a new service from this repo with a volume at `/data`. Elsewhere: `docker build .`, with a persistent volume at `/data`. Copy every variable from the old service (names in `.env.example`; values in Railway or Michael's password manager). Two must be **production's own values**: `MFA_KEY` and `JWT_SECRET`. Authenticator-app keys and SSO client secrets are sealed with them (`server/twoFactor.ts`), so with new values every two-factor user is locked out. Required to start: `JWT_SECRET`, `ADMIN_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`.
3. **Put the database at `/data/veritas.db` before the app's first boot.** Move any old `veritas.db` aside first, and remove `veritas.db-wal`, `veritas.db-shm` and the Litestream tracking folder beside it. The restore writes a new file and won't write over one.
   - a. Continuous: write a `litestream.yml` with the same replica block `server/continuousBackup.ts` writes (`type: s3`, `bucket`, `path: litestream/g<N>/veritas.db`, `endpoint`, `region: auto`, the two keys), then `litestream restore -config litestream.yml -o /data/veritas.db /data/veritas.db`. For a point in time add `-timestamp <ISO time>` (see `litestream restore -h`). This is the command the app's own restore test runs.
   - b. Hourly or nightly: download the `.db.gz` (any S3 tool, endpoint `BACKUP_S3_ENDPOINT`, path-style), `gunzip`, and run `PRAGMA integrity_check` (expect `ok`). `scripts/restore-drill.mjs` does download, check and a test boot of the newest copy in one go.
4. **Put the documents back:** `node scripts/restore-files.mjs /data` shows what it would write; add `--apply` to write. Add `--before <ISO time>` to match an older database point, or `--scope veritastock/` for VeritaStock. Every file is checked against its SHA-256, and a rerun writes nothing new.
5. **Before the first boot, start a new continuous-backup folder.** List `litestream/` in the bucket and write one more than the highest `g<N>` into `/data/veritas.db.litestream-generation` (for example `3`). Without it, a new volume replicates into production's old folder, and restores then read the old history (BUG-111).
6. **Boot and check:**
   - `GET /api/health` answers 200.
   - Sign in as a known user.
   - Run the three restore tests with header `x-admin-secret`:
     - `/api/admin/continuous-backup/restore-test`
     - `/api/admin/restore-self-test`
     - `POST /api/admin/file-backup/restore-test`

   Each must say PASS.
7. **Point the name at it.** Only if the host changed: at GoDaddy, set the `www` CNAME to the new host. The apex forwards to `www`.

**A test or drill host is different.** Give it no `BACKUP_S3_*`, no `RESEND_API_KEY` and no live Stripe keys. Restored data holds real customers' addresses, and the app sends reminder emails and writes backups on its own. A drill host with backup keys would also prune and overwrite production's copies.

**Times measured on production:**
- Continuous restore: 168 MB in 8.2 s (2026-10-16).
- Restore drill, end to end: 8.0 s.

A first full move to a new host is an estimate, not a measurement: plan on a working day.

## Running it afterwards

- Health and backups email `info@veritaslabservices.com` only on failure. A quiet inbox means clean nights. Status:
  - `GET /api/admin/backup-integrity-log`
  - `GET /api/admin/file-backup/status`
  - `GET /api/admin/continuous-backup/watchdog`
- A clean-room boot reproduces production's schema: on 2026-11-22, 226 tables, 0 columns missing. Nothing in CI guards that, so re-check before relying on it.
- Node 22 reaches end of life on 2027-04-30. Move the `Dockerfile` base and `nixpacks.toml` to the next LTS before then.
