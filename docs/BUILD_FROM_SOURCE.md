# Build and Run From Source (Clean-Room)

**Purpose:** stand up VeritaAssure from source on a clean machine, with no prior
state. Written for a source-code escrow verifier or a successor engineer. Pairs
with `docs/disaster-recovery.md` (recovery + credential rotation) and `.env.example`
(the full environment variable list).

The application is a single Node.js + Express server that serves a built React
client and stores data in a single SQLite file (via better-sqlite3). There is no
external database server and no other runtime service dependency. PDF generation
uses a bundled headless Chromium (Puppeteer); LibreOffice/Word are **not** required.

---

## 1. Prerequisites

- **Node.js 20.x** (built and verified on v20.20.2) and **npm 10.x** (10.8.2).
- A C/C++ toolchain for the `better-sqlite3` native addon:
  - Linux: `build-essential` (gcc/g++/make) and Python 3.
  - Windows: "Desktop development with C++" (MSVC build tools) and Python 3.
- Git.

## 2. Get the code and install dependencies

```
git clone <repository-url> veritas-lab-services
cd veritas-lab-services
npm install
```

`npm install` compiles the `better-sqlite3` native addon and installs Puppeteer's
Chromium. If Chromium download is blocked, set `PUPPETEER_SKIP_DOWNLOAD` and provide
a system Chromium path per Puppeteer's docs.

## 3. Configure environment

```
cp .env.example .env
```

Fill in the **REQUIRED** values (`JWT_SECRET`, `ADMIN_SECRET`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`). Generate the two secrets with:

```
openssl rand -hex 64   # JWT_SECRET
openssl rand -hex 32   # ADMIN_SECRET
```

Everything else is optional (see `.env.example` for what each var does). With email
(`RESEND_API_KEY`) and backups (`BACKUP_S3_*`) unset, those subsystems log a skip and
the app still runs. Use Stripe **test** keys outside production.

## 4. Database

The database is a single SQLite file at `DB_PATH` (default `/data/veritas.db`, falling
back to `./veritas.db` when `/data` does not exist).

- **Empty start:** on first boot the server creates the **complete** schema
  automatically (148 tables as of 2026-09-28). A from-scratch boot reproduces the
  full production schema exactly; no manual migration step is required.
  (Verify with `node scripts/audit-sql-columns.mjs <path-to-db>`, which prepares every
  static query against the schema and should report 0 failures.)
- **Restore production data:** to bring up an instance with existing data, place a
  decompressed backup snapshot at `DB_PATH` **before** first boot. See
  `docs/disaster-recovery.md` section 2b (download the latest `.db.gz` from off-site
  backup, `gunzip`, put it at `DB_PATH`).

## 5. Build

```
npm run build
```

This runs `tsx script/build.ts`, which builds the React client (Vite) and bundles the
server to `dist/index.cjs`.

## 6. Run

```
npm start          # NODE_ENV=production node dist/index.cjs
```

The server listens on `PORT` (default 5000). For local development instead use
`npm run dev` (`tsx server/index.ts`, no build step).

## 7. Verify the instance

```
curl -sI http://localhost:5000/          # expect HTTP 200
```

Then open the app, sign in with the seeded owner (or register), and confirm the
dashboard loads. `npm run check` runs the TypeScript type-check.

## 8. Notes for an escrow verifier

- **Builds and runs from source with no external services.** SQLite is file-based;
  Stripe/Resend/Sentry/S3 are optional integrations gated behind env vars.
- **No hidden state in the schema.** As of 2026-09-28 a clean boot yields the same
  148-table / 1820-column schema as production; there is no dependency on an
  accumulated volume to obtain a complete schema.
- All operational credentials live in environment variables (Section 3); none are
  compiled into the source.
