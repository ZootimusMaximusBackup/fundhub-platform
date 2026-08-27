# Postgres least privilege — shared board

Batch started 2026-07-31. Branch `claude/postgres-superuser-migration-lzm6xt`.

Chris asked for three things: a migration creating a limited database user, a
permanent guard that fails the build if the app is ever pointed at a superuser
connection, and a paste-in run sheet. He approved running all three in one
session rather than fanning out, so the "owner" column below is one session.

No workflow here touches Netlify or Supabase. Section 11 of CLAUDE.md says
`api.netlify.com` and `api.supabase.com` are blocked by the network policy in
the hosted agent environment — every dashboard and deploy step is Chris's.

## Task list

| # | Owner | Task | Status |
|---|---|---|---|
| W1 | (assistant, this session) | `db/migrations/104_app_role.sql` + `db/migrate.mjs` admin-URL fallback | done |
| W2 | (assistant, this session) | `src/security/superuser-guard.test.mjs` + build wiring | done |
| W3 | (assistant, this session) | `docs/runbooks/postgres-least-privilege.md` | done |

## Context brief

### What was actually wrong

The app connects with one pooled connection string, `DATABASE_URL`
(`src/db.mjs`). That string currently carries a superuser. Two consequences,
the second much worse than the first:

1. Any SQL injection or handler bug runs with the power to drop tables, read
   every database on the instance, and change roles.
2. **Row Level Security is silently doing nothing.** `045_creative_factory.sql`
   installs `ENABLE` + `FORCE ROW LEVEL SECURITY` and a partner-isolation
   policy across the creative/ad/compliance/social modules (five migrations:
   045, 046, 047, 049, 050). `src/partners/rls.mjs` sets the
   `fundhub.partner_id` GUC per transaction and the policies read it. The
   migration's own header says FORCE was chosen *because* "the app connects as
   one pooled role which in most deployments owns these tables, and a table
   owner is exempt from its own RLS unless FORCE is set."

   FORCE closes the **owner** hole. It does not close the **superuser** hole.
   A superuser, and any role with `rolbypassrls`, bypasses every policy
   regardless of FORCE. So the second lock described in `rls.mjs` — the one
   meant to catch "a raw `db.query()` written in a hurry eight months from now"
   — has never been engaged in production.

   Fixing the connection role is what turns that code on. That is the real
   payload of this batch, not the generic hardening.

### What the app actually needs at runtime

Grepped `src/`, `api/`, `netlify/` excluding tests:

- No DDL of any kind. No `CREATE TABLE`, `ALTER TABLE`, `DROP`, `TRUNCATE`.
- No `COPY`, no `LISTEN`/`NOTIFY`, no `SET ROLE`, no `CREATE EXTENSION`.
- `set_config('fundhub.actor'|'fundhub.partner_id', …, true)` — transaction
  GUCs, available to any role.
- Plain `SELECT`/`INSERT`/`UPDATE`/`DELETE` plus sequence use.

So the app role needs exactly: `CONNECT`, `USAGE` on schema `public`,
`SELECT/INSERT/UPDATE/DELETE` on tables, `USAGE, SELECT` on sequences. Nothing
more.

### The two things that break if you only swap the role

Both are handled in this batch. Recording them because they are the
non-obvious part.

1. **Migrations stop working.** `db/migrate.mjs` connects with `DATABASE_URL`.
   Once that is the limited role it cannot create tables, so the next schema
   change fails. Handled by `MIGRATION_DATABASE_URL`: migrate.mjs prefers it
   and falls back to `DATABASE_URL` when unset.
2. **~14 test suites break.** They run `ALTER TABLE … DISABLE TRIGGER` to test
   the archive-only guards (entitlements, invoices, documents, failed_events,
   partner_revenue, affiliate_referrals, action_log, and the creative/social/
   compliance suites). `DISABLE TRIGGER` requires table ownership. The test
   suite must therefore keep pointing at an owner-level connection — it is a
   developer fixture, not the app's runtime identity. This is why the guard
   has a local opt-out and no deployed opt-out.

## Change manifest

**W1 — `db/migrations/104_app_role.sql`** (new)
- Creates role `fundhub_app`: `NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOBYPASSRLS NOREPLICATION`. `NOLOGIN` on purpose — a human adds `LOGIN` and a
  password by hand so no credential ever enters the repo.
- Re-run safe. On an existing role it re-asserts the `NO*` attributes and
  leaves `LOGIN`/password alone, so re-running never locks the app out.
- Grants `CONNECT` (via `format()` on `current_database()`), `USAGE` on
  `public`, `SELECT/INSERT/UPDATE/DELETE` on all tables, `USAGE, SELECT` on all
  sequences, plus matching `ALTER DEFAULT PRIVILEGES` so future migrations'
  tables are covered without editing this file.
- Deliberately withheld: `TRUNCATE` (it bypasses the `*_no_delete` triggers, so
  withholding it is what keeps the archive-only invariant true), `CREATE` on
  the schema, `REFERENCES`, `TRIGGER`.
- `REVOKE CREATE ON SCHEMA public FROM PUBLIC` — otherwise the role inherits
  create rights through `PUBLIC` on Postgres 14 and older. No-op on 15+.
- Ends with a self-check `DO` block that raises and rolls the migration back if
  the role somehow still has superuser or bypass-RLS.

**W1 — `db/migrate.mjs`** (edited)
- Prefers `MIGRATION_DATABASE_URL`, falls back to `DATABASE_URL`, prints which
  it used and never prints the value.

**W2 — `src/security/superuser-guard.test.mjs`** (new)
- New folder. The published contract said `src/db/`, changed because
  `src/db.mjs` already exists and a sibling `src/db/` directory reads as a
  typo.
- Filename has no `.pg` infix on purpose — see CLAUDE.md section 12 trap 2. The
  `.pg.test.mjs` convention skips when `DATABASE_URL` is unset, and a guard
  that skips itself is not a guard.
- Checks role attributes **through role membership** (`pg_has_role`), not just
  `current_user`'s own flags, so inherited superuser is caught. Also checks
  `current_setting('is_superuser')`, `pg_read_all_data`, `pg_write_all_data`,
  and that `current_user` is not `postgres`.
- Deployed context (`NETLIFY`, `CI`, `CONTEXT`, or `NODE_ENV=production`):
  missing `DATABASE_URL` fails, a failed connection fails, and
  `ALLOW_SUPERUSER_DB` is refused outright. No escape hatch.
- Local: same assertions, but `ALLOW_SUPERUSER_DB=1` downgrades to a loud
  warning, because the test suite genuinely needs an owner connection.

**W2 — `package.json`** (edited) — adds `guard:db`.

**W2 — `netlify.toml`** (edited) — build command now runs `npm run guard:db`
instead of `echo`. This is what makes "fails the build" true rather than
aspirational; there is no CI in this repo (no `.github/`), so the Netlify build
is the only gate that exists.

**W3 — `docs/runbooks/postgres-least-privilege.md`** (new) — the run sheet.

## Findings for Chris (reported, not silently fixed)

- RLS has never been enforced in production. Above.
- `docs/journeys/` does not exist. CLAUDE.md section 4 describes it in detail
  and names eight journeys; the directory is absent, so there is no
  `-actual.md` to update and no `CHANGELOG.md` to append to. This change alters
  no user-facing flow either way.
  **CLOSED — do not pick this up.** Chris confirmed 2026-07-31 that journeys
  are already being built by another workflow on
  `claude/journeys-actual-generated`. Leave that branch to it.
- `npm run lint` does not exist in `package.json`, and there is no TypeScript,
  so `npx tsc --noEmit` has nothing to check. Definition-of-done items 1 and 2
  cannot be run as written.
  **DEFERRED by Chris 2026-07-31** — skip lint for now. Playwright and the
  journey tests are the intended verification layer, landing as Phase 1 of the
  next spec.
- The documented test baseline was stale. **FIXED** — CLAUDE.md §12 now reads
  45, with the measurement conditions recorded alongside it.
- Netlify env var **scope** matters and is easy to get wrong: if `DATABASE_URL`
  is scoped "Functions only", the build cannot see it and the new guard fails
  the deploy. Covered as a step in the runbook.
