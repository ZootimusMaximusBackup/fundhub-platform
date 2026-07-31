# Netlify deploy — shared board

Batch started 2026-07-31. Chris is loading the missing env var himself directly
in the Netlify UI (suspected DATABASE_URL and/or DASHBOARD_SECRET). No workflow
below sets secrets — that's Chris's action, not ours.

## Task list

| # | Owner | Task | Status |
|---|---|---|---|
| A | (assistant, this session) | Verify Netlify build config + redirect/bounce behavior | done |
| B | (Opus session) | Debug login bounce / confirm missing env var | pending |
| C | (Sonnet session) | Audit frontend-to-API wiring across screens | pending |
| D | (Sonnet session) | Deploy + end-to-end verification | pending |

Claim a row by changing its status to `claimed` before starting. Mark `done`
and add a manifest below before reporting complete to Chris. Mark `blocked`
and say why if you can't proceed.

## Context brief (read before starting)

- Repo: `netlify.toml` publishes `public/`, functions live in
  `netlify/functions/api.mjs` (one function handles all of `/api/*`).
- `netlify.toml` already fixed one redirect loop (`/app` vs `/app.html`) —
  see the comment block at the top of that file before assuming a new one.
- Backend handlers live in `api/*.mjs`, business logic in `src/`.
- `HANDOFF.md` documents which of the 21 screens are wired to real data vs
  sample/demo (15 wired, 6 not — see the table there before re-auditing from
  scratch).
- Login flow: `POST /api/auth/login` → `src/auth/login.mjs` (staff) or
  `src/auth/account-session.mjs` (client/affiliate/partner) → sets
  `fundhub_session` cookie.
- No production DATABASE_URL was set as of session start — this is the
  likely cause of the login bounce (auth call fails, frontend redirects back
  to login).

## Blockers / open questions

(none yet)

## Change manifests

### A — Netlify build config (done)

No files changed. Findings:

- `netlify.toml` build settings, functions directory, and redirects are all
  correct. No new redirect loop found; the documented `/app` vs `/app.html`
  fix is intact.
- Traced the actual bounce mechanism to confirm it's the missing env var, not
  a config bug: `public/app/shell.js` calls `GET /api/auth/session` on every
  `/app/*` load. `src/db.mjs:9` throws `"DATABASE_URL not set"` on first query
  when the var is absent, so the session check always fails, and `shell.js`
  redirects to `/login.html`. That's the full loop: app → session check fails
  → login → sign in → app → session check fails again → login.
- No code fix needed for this — expected to resolve once `DATABASE_URL` is
  set in Netlify. Workflow B should verify this is actually true after Chris
  loads the var (login itself will also 500 under the same missing var until
  then — see `src/auth/login.mjs` → `login()` → `db.query`).
