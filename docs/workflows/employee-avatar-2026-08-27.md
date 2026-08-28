# Employee profile photo — 2026-08-27

Feature: each internal employee (owner, sales-manager, closer, funding-advisor,
inquiry-remover) can upload a photo of themselves and see it in their own dashboard.
Client and affiliate portals are out of scope — internal staff only.

No tracked journey (`docs/journeys/`) covers this — it's an account/settings action,
not part of the lead/deal flow. Not touching any `-actual.md` file for it.

## API contract (fixed up front so both workflows build independently)

```
POST /api/staff/avatar   multipart, field "photo", PNG/JPEG, <=5MB, auth required,
                          always acts on the caller's own staff id (no staffId param)
GET  /api/staff/avatar   streams the caller's own photo, 404 if none set
GET  /api/auth/session   response gains "avatarUrl": string path or null
```

## Task list

| Unit | Owner | Status |
|---|---|---|
| Backend: migration + api/staff/avatar.mjs + session wiring + route registration + pg test | Workflow A | done |
| Frontend: shell.js mountChip() avatar display + upload UI | Workflow B | done |
| Integration verify (deploy preview, live upload test per role) | main session | pending |

## Ground brief

- No per-role dashboard files — `public/app/shell.js` is shared across all 5 employee
  dashboards via the `HOME` map in `shell.js`. One frontend change covers all 5 roles.
- Canonical identity table is `staff` (not `users`), PK `id uuid`,
  `db/schema/001_init.sql:382`. No `avatar_url`/`photo_url` column exists yet.
- Session → staff lookup: `src/auth/session.mjs` `verifySession()` (~line 75-115) does a
  fixed-column SELECT and returns a fixed object shape — not `SELECT *`. Any new column
  must be added there explicitly or the frontend never sees it.
- Reuse `src/documents/store.mjs` (`storeFromEnv().provider.put()`) and
  `src/documents/upload-validate.mjs` (`sniffMimeType`, PNG/JPEG already recognized) —
  same pattern as `api/documents-upload.mjs`. No Supabase Storage, no base64-in-Postgres
  anywhere in this repo.
- Route registration trap: a handler not present in `netlify/functions/api.mjs`'s
  `ROUTES` map 404s even if the file exists. `src/http/routes.test.mjs` enforces this.
- Endpoint tests must live under `src/http/*.pg.test.mjs` — a test under `api/` never runs
  (`npm test`'s glob is `src/**` and `scripts/**` only).

## Blockers / open questions

- **Workflow B — full end-to-end round trip is blocked on a live backend + DB.**
  Static server used for local verification (below) has no `/api/*` at all, so an actual
  POST → 200 → DB write → GET-back round trip has never been exercised against this
  frontend code. That's the "Integration verify" row above — needs a deploy preview or
  local `netlify dev` + real Postgres, with a real staff bearer token. Not attempted here:
  the repo's own `DATABASE_URL` in `.env` is real infra (see CLAUDE.md §11/traps), and
  this workflow's scope was frontend-only — didn't want to risk writing test uploads
  against whatever that URL actually points to.

## Change manifests

### Workflow A — backend (migration, handler, session wiring, route, pg test)

**Contract delivered exactly as specified above** — `POST/GET /api/staff/avatar`,
field name `photo`, PNG/JPEG only, 5MB cap, self-scoped via `req.staff.id` only
(no `staffId` param anywhere), `requireAuth` only (no role gate — all 5 internal
roles can use it), and `avatarUrl` on the session/who-am-i response. No shape
deviations from the contract Workflow B built against.

**Files:**

- `db/migrations/262_staff_avatar_key.sql` — new. `ALTER TABLE staff ADD COLUMN
  IF NOT EXISTS avatar_key text` (nullable, opaque storage key, never returned in
  any API response). Highest prior migration was 261; did not touch any applied file.
- `api/staff/avatar.mjs` — new. `POST` validates via a local
  `validateAvatarUpload()` (same `{ok,code,message}` shape as
  `src/documents/upload-validate.mjs`'s `validateUpload()`, reusing its
  `sniffMimeType()` but with its own png/jpeg-only allow-list and 5MB cap —
  deliberately not reusing `validateUpload()` itself since that allows PDF and
  defaults to 10MB). Stores bytes via `storeFromEnv().provider.put()` directly
  (bypassing `store.put()`'s wrapper, which requires a `clientId` this feature
  has none of) at `staff-avatars/<orgId>/<staffId>/<sha256>.<ext>`, then
  `UPDATE staff SET avatar_key = $1 WHERE id = req.staff.id`. No documents/
  document_versions row is created — an avatar is not a client-owned document,
  so there's nothing to register it under. `GET` reads `staff.avatar_key` for
  `req.staff.id` only, 404 if null, else `store.provider.get()` and streams the
  bytes back with `res.status(200).end(bytes)` (same tail pattern as
  `api/documents/[id].mjs`). No `staffId` query/body param exists on this route.
- `src/auth/session.mjs` — `verifySession()`'s SELECT now includes `s.avatar_key`
  (line ~89), and the returned `staff` object gains
  `avatarUrl: row.avatar_key ? "/api/staff/avatar" : null` (line ~112). Raw
  storage key is never returned — only the fixed path.
- `api/auth/session.mjs` — **no change needed.** Its staff branch calls
  `attachStaff()` → `req.staff = result.staff` and returns that object directly
  (`{ ok: true, principal: "staff", staff }`); it already forwards whatever
  `verifySession()` returns, so `avatarUrl` flows through automatically. Verified
  by reading the file, not assumed.
- `src/http/middleware/requireAuth.mjs` — one-line docblock update: the
  `req.staff = {...}` shape comment now lists `avatarUrl` too (accuracy only, no
  behavior change).
- `netlify/functions/api.mjs` — added `import staffAvatar from
  "../../api/staff/avatar.mjs"` next to the other `staff/*` imports, and
  `"staff/avatar": staffAvatar` in `ROUTES` next to `staff/telemetry` and
  `staff/monitoring-consent`. `src/http/routes.test.mjs` passes (15/15).
- `src/http/staff-avatar.pg.test.mjs` — new, 13 tests: auth required on both
  verbs, 404 before any upload, PNG round-trip, JPEG round-trip, re-upload
  replaces the stored photo, non-image rejected, PDF rejected (image-only,
  unlike the client document upload), oversized file rejected, no-file-in-request
  rejected, wrong field name rejected, and cross-staff isolation (a fresh staff
  member with no photo of their own gets 404, never another staff member's bytes
  — there's no parameter to even attempt naming another staff id).
- `src/auth/session.test.mjs` — updated the two `deepEqual` assertions on
  `verifySession()`'s returned staff shape to include `avatarUrl: null` (fixture
  db has no `avatar_key`), plus one new unit test asserting a set `avatar_key`
  projects to `avatarUrl: "/api/staff/avatar"`.
- `src/http/middleware/requireAuth.test.mjs` — same fix: the shared `STAFF`
  fixture used in three `deepEqual` assertions now includes `avatarUrl: null`.
- `db/expected-migrations.mjs` — regenerated via `npm run migrations:manifest`
  (203 entries, was stale even before this migration — pre-existing drift,
  fixed as a side effect of adding 262).

**Verified:**

- `npm run lint` — clean (1519 files).
- `src/http/routes.test.mjs` — 15/15 pass.
- **pg tests ran against a real, self-provisioned scratch Postgres** — never
  production, never `fundhub_ci`. Built `fh_avatar_0827` from scratch with
  `db/migrate.mjs` (203 migrations applied cleanly, my 262 included) per
  CLAUDE.md §12 / the repo's own scratch-DB convention. `src/http/staff-avatar.pg.test.mjs`:
  **13/13 pass**. `src/auth/auth.pg.test.mjs` (verifySession's own pg coverage):
  **21/21 pass** (exact count from that run). Unit suite (non-`.pg.test.mjs`,
  6496 tests): after the two fixture fixes above, every failure remaining is
  either pre-existing on a pristine `git worktree` copy of `HEAD` (16 failures —
  confirmed by running the identical file list there) or caused by OTHER
  sessions' uncommitted changes already sitting in this shared tree before I
  started (`src/http/dashboard-next-action.test.mjs` and the handlers it
  imports show as locally modified in `git status`, unrelated to this feature;
  confirmed by running that one file against the pristine worktree, where it
  passes 29/29). **Zero unit-test failures are attributable to this change.**
- **Full `*.pg.test.mjs` sweep (170 suites, 1835 tests) also run** against the
  same scratch DB for a broader regression check: 61 failures, but every one is
  in an unrelated subsystem (contracts, campaigns, partner/RLS isolation,
  invoices, social studio, telemetry, demo-mode teardown). Root cause traced to
  the shared tree itself, not this change: several partner-isolation assertions
  fail with "the policy must hide the row" (RLS not applied), and
  `src/testing/rls-pool.mjs` — which an earlier memory note (dated this same
  morning) says those tests need to read through the unprivileged role — **does
  not exist anywhere in the current tree** (`grep -rl rlsPool src` finds
  nothing). That is a pre-existing/concurrent-session state issue in this
  shared checkout, not something introduced by the 10 files this workflow
  touched (none of which touch RLS, partner scoping, contracts, campaigns, or
  telemetry). Flagging it here for visibility per CLAUDE.md's guardrails
  (report, don't silently work around) — **not fixed, out of this workflow's
  scope**, and the stuck rule applies: this is a repo/environment-state
  question for the owner or main session, not a second attempt for me to make.
- Left the scratch DB `fh_avatar_0827` in place (same convention as the ~50
  other `fh_*` scratch databases already on this Postgres instance) in case
  further verification is wanted; drop it with `psql -d postgres -c "DROP
  DATABASE fh_avatar_0827"` when done with it.

**Left undone / owner-visible notes:**

- The "Integration verify" row (deploy preview + live per-role upload test) is
  still `pending` — that's the main session's row per the board, not mine.
- No COMPLIANCE REVIEW REQUIRED flag — this touches auth/session shape and file
  upload, but not dispute logic, credit-repair messaging, fee timing, refund
  behavior, payment rails, consent capture, or credit-pull type (CLAUDE.md §7's
  list). Not flagged.

### Workflow B — frontend (shell.js)

**File:** `public/app/shell.js`

- Added two new functions immediately before `mountChip()`:
  - `avatarChipHtml(avatarUrl)` (~line 1660) — returns a 22px circular `<img>` when
    `avatarUrl` is truthy, else a 16px "+" affordance. Both variants share
    `id="fh-shell-avatar"` so click-wiring code doesn't need to branch.
  - `wireAvatarUpload(el, demo)` (~line 1685) — creates a hidden
    `<input type="file" accept="image/png,image/jpeg">`, binds a click handler on
    `#fh-shell-avatar` that opens it (short-circuits with an inline error in demo mode
    instead — a demo session has no real staff row to attach a photo to), and on file
    selection POSTs multipart to `/api/staff/avatar` with field name `photo`. Auth header
    matches `getSession()`'s existing pattern exactly: `localStorage.getItem("fh_token")`
    → `{ authorization: "Bearer " + t }` if present, no manual `content-type` (browser
    sets the multipart boundary). On success, re-runs the file's existing `getSession()`
    and swaps just the avatar span's `outerHTML` in place (cache-busting the image URL
    with `?v=timestamp` only on this swap, since the backend path itself doesn't change
    per upload and the browser would otherwise serve the stale cached image). Shows a
    4-second inline error span (`#fh-shell-avatar-err`, reusing the existing rose
    `#F2A69B` tone from the backend-status badge) on any failure. Disables the click
    target (opacity + cursor) while a request is in flight.
- `mountChip(staff, demo)` (~line 1770): prepended `avatarChipHtml(staff.avatarUrl)` to
  the chip's `innerHTML`, added a `wireAvatarUpload(el, demo);` call right after the
  existing sign-out listener binding, and updated the function's top comment (which
  previously said Sign out was "the one thing inside it that IS a control") to mention
  the new avatar button too — it's inside the same `pointer-events:none` chip and needs
  the same `pointer-events:auto` override, same as Sign out already had.
- No other functions touched. Did not touch `data.js` — `FHData.uploadFiles` exists but
  is hardcoded to field name `"file"` (contract needs `"photo"`), and more importantly
  isn't loaded on every screen this chip renders on (e.g. `automations.html`,
  `lenders.html`, `galaxy.html` include `shell.js` without `data.js`) — using it would
  have made the feature silently break on those screens. Wrote the fetch directly in
  `shell.js` instead, per the task's own instruction to match `shell.js`'s existing
  auth pattern.

**Verified:**
- `npm run lint` — clean (1520 files, no new errors).
- `node --check public/app/shell.js` — valid syntax.
- Confirmed via `src/auth/session.mjs:112` (already written by Workflow A) that the
  session's staff object carries the field as `staff.avatarUrl` — matches what
  `mountChip(staff, demo)` receives and what my code reads.
- Manual full read-through of the diff for the auth-header pattern (matches
  `getSession()`/`signOut()`/`applyBrand()` exactly) and the session-refetch logic
  (re-uses `getSession()`, only swaps the avatar node, re-binds its click listener,
  re-runs `layoutShellChrome()` since the chip's width changes slightly).
- **Live-in-browser check**, no real backend involved: served `public/` with a plain
  `python3 -m http.server` (no `/api/*` at all — confirmed 404, so zero chance of
  touching any real database), seeded `localStorage.fh_demo_staff` by hand on that
  origin (the same demo-fallback path `getSession()` already has for offline use), and
  loaded `app/inquiry-remover.html`:
  - `avatarUrl: null` → rendered exactly the expected "+" `<span>` markup (verified via
    `outerHTML`), plus the hidden file input with the correct `type`/`accept`.
  - Clicked it while `demo: true` → showed the inline error
    "Demo session — sign in for real to add a photo." and did **not** invoke the file
    picker (confirmed the demo guard fires before `fileInput.click()`).
  - `avatarUrl: "/apple-touch-icon.png"` → rendered the circular `<img>` variant,
    confirmed the image actually loaded (200 OK) and screenshot showed a real (if tiny)
    circular photo in place of the "+".
  - No new console errors from this code — the only console errors on that page are
    pre-existing 404s from other widgets' own `/api/*` calls, unrelated to this feature
    and present on that harness regardless of my change.
  - Cleaned up: closed the browser tab, killed the local static server, nothing left
    running.
- **Not verified (needs the real backend, see Blockers above):** an actual POST landing
  at `api/staff/avatar.mjs`, a real 200 with a real `avatarUrl` in the response, the
  cache-busted image actually re-fetching new bytes, and the upload-in-flight/error UI
  against real network latency instead of instant local failures.
