# Supabase Cloud setup

Step-by-step setup for a fresh Supabase Cloud project backing this codebase.
No credentials are stored anywhere in this repository — every value below is
pasted into a local, gitignored `.env` file.

## 1. Create the Supabase project

1. Go to https://supabase.com/dashboard and create a new project (choose a
   region, a database password, and a project name — e.g. `gcrs-dev`).
2. Wait for provisioning to finish.

## 2. Get the project URL and keys

In the dashboard: **Project Settings → API Keys**.

- **Project URL** → `SUPABASE_URL` / `VITE_SUPABASE_URL`
- **Publishable key** → `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
- **Secret key** → `SUPABASE_SECRET_KEY`

> **Warning:** the Secret key bypasses Row Level Security entirely. It belongs
> **only** in `apps/api/.env`, is read only by the `seed:demo-users` script
> (never by the running server itself — see `apps/api/src/lib/supabaseClient.ts`),
> and must never be placed in `apps/web/.env`, committed to git, or logged.

## 3. Configure environment files

```bash
cp apps/web/.env.example apps/web/.env
cp apps/api/.env.example apps/api/.env
```

Fill in:

- `apps/web/.env`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_API_BASE_URL` (defaults to `http://localhost:4000/api`, fine for local dev).
- `apps/api/.env`: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (read by the
  running server), `SUPABASE_SECRET_KEY` (read only by the `seed:demo-users`
  script), `CORS_ORIGIN` (defaults to `http://localhost:5173`), and the
  `DEMO_*` variables used only by the seed script (pick any local test
  email/password — they do not need to be real inboxes; Supabase demo users
  can be created with `email_confirm: true`).

## 4. Apply database migrations

Install the [Supabase CLI](https://supabase.com/docs/guides/cli) if you don't
have it, then from the repo root:

```bash
supabase login
supabase link --project-ref <your-project-ref>   # found in Project Settings → General
supabase db push
```

This applies every file in `supabase/migrations/` in order: extensions,
tables, RLS policies, then RPC functions. See `supabase/README.md` for what
each migration does.

## 5. Seed reference data

```bash
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

`SUPABASE_DB_URL` is the connection string from **Project Settings →
Database → Connection string** (URI format). This creates one semester, one
registration period, four courses, four classes and their schedules. It is
idempotent and contains no personal data or auth users.

## 6. Seed demo user accounts

With `apps/api/.env` filled in (including the `DEMO_*` variables):

```bash
npm install
npm run seed:demo-users
```

This creates (or, if already present, re-syncs the role/status of) one
`TRAINING_STAFF` account and two `ACTIVE` `STUDENT` accounts via the Supabase
Admin API, using the Secret key from your local `.env`. This is the only
place in the codebase that reads `SUPABASE_SECRET_KEY`. It is safe to re-run.

## 7. Run the apps

```bash
npm run dev:api     # starts Express on http://localhost:4000
npm run dev:web     # starts Vite on http://localhost:5173
```

Visit `http://localhost:5173/login` and sign in with one of the demo accounts
created in step 6.

## Notes

- Steps 4–6 all require real Supabase Cloud credentials and are **not**
  executed by this repository automatically — nothing here has run migrations
  against any live project.
- If you need to reset local state, re-running `supabase db push` and
  `supabase/seed.sql` is safe (migrations are additive; seed data uses
  `ON CONFLICT DO NOTHING`). Demo user re-seeding is also safe (idempotent).
