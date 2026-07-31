# Netlify deploy — shared board

Batch started 2026-07-31. Chris is loading the missing env var himself directly
in the Netlify UI (suspected DATABASE_URL and/or DASHBOARD_SECRET). No workflow
below sets secrets — that's Chris's action, not ours.

## Task list

| # | Owner | Task | Status |
|---|---|---|---|
| A | (assistant, this session) | Verify Netlify build config + redirect/bounce behavior | pending |
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

(fill in per workflow as completed)
