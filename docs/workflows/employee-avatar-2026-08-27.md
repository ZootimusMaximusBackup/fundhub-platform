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

---

## Reconciliation onto real main

Everything above was built against a **stale, shared working directory that was 268
commits behind `origin/main`** — and one file's edit (the whole `public/app/shell.js`
frontend piece) was lost outright to that directory's volatility. Copying those files
wholesale onto current `main` would have reverted 268 commits of unrelated work in the
shared files, so nothing was copied blind.

Redone in an isolated `git worktree` branched fresh from `origin/main` at **`f11f2b42`**,
branch `feature/employee-avatar`. The shared checkout was never written to.

### Migration renumbered 262 → 270

`262` is taken on real `main` by `262_inquiry_expected_name.sql`, an unrelated
already-merged migration. Highest number in the tree was **269**
(`269_partner_views_security_invoker.sql`), so the file landed as
**`db/migrations/270_staff_avatar_key.sql`**. Renamed, not renumbered in place — an
applied migration is never edited (CLAUDE.md §12). The SQL body is unchanged; the three
in-code references to the old filename (the migration's own header, `api/staff/avatar.mjs`,
`src/http/staff-avatar.pg.test.mjs`) were updated to say 270.

### What applied cleanly vs. what needed hand work

| Piece | Result |
|---|---|
| `netlify/functions/api.mjs` (import + `ROUTES` entry) | **applied clean** — `git apply` exit 0 |
| `src/auth/session.mjs` (`s.avatar_key` in the SELECT, `avatarUrl` projection) | **applied clean** |
| `src/auth/session.test.mjs` (fixture + one new test) | **applied clean** |
| `src/http/middleware/requireAuth.test.mjs` (`STAFF` fixture) | **applied clean** |
| `api/staff/avatar.mjs` | **copied as-is** — every assumption re-verified against current code first (below) |
| `src/http/staff-avatar.pg.test.mjs` | **copied as-is** |
| `db/expected-migrations.mjs` | regenerated with `npm run migrations:manifest`; diff is **exactly one added line** (`migrations/270_staff_avatar_key.sql`) and nothing else — none of the three other sessions' stray migration files that contaminated the stale run |
| `public/app/shell.js` | **rewritten from scratch** against current code — the original edit was lost, nothing to patch |

All four backend patches applied clean, which is the surprising part given 268 commits of
drift: none of the four anchor points had moved.

**Assumptions re-verified before trusting the rescued handler** (none had changed):
`storeFromEnv()`, `.provider.put(pathname, bytes, {contentType})` returning the key,
`.provider.get(key)` returning `{body, contentType}`, plus `toBytes` / `checksumOf` /
`extensionFor` in `src/documents/store.mjs`; `sniffMimeType(buffer)` in
`src/documents/upload-validate.mjs`; `safeError` in `src/http/health.mjs`; the multipart
shape `req.body.files = [{ field, filename, mimeType, buffer, size }]` in
`netlify/functions/api.mjs`; and `staff` still having `id`, `org_id`, `updated_at`
(`db/schema/001_init.sql:382`) plus `email`/`status` (`db/schema/020_auth.sql`).
`api/auth/session.mjs` was re-read and still forwards `verifySession()`'s object
unchanged, so no edit was needed there either.

### Three things current `main` needed that the stale tree did not

1. **`src/pulse/registry.mjs`** — `src/pulse/registry.test.mjs` fails any newly routed
   `api/` handler that is not in `PULSE_REGISTRY` or `ALLOWED_UNMONITORED`. Added
   `"staff/avatar"` to `API_KEYS`, next to `staff/telemetry` and
   `staff/monitoring-consent`. Correct as a monitored uptime door: the pulse only ever
   GETs, and `isUp()` counts 401 as up, which is what an unauthenticated GET here returns.
2. **`docs/journeys/*-actual.md` + `README.md`** — regenerated with `npm run journeys`
   (CLAUDE.md §4: same commit as the code, generated from code, never hand-written). The
   whole diff is route counts 198 → 199 plus one new row per journey. The generator
   independently classified the route as **"any signed-in employee"** and put it in the
   reachable list for all five employee journeys and the **blocked** list for `client`,
   `affiliate` and `white-label` — an independent confirmation of the intended scope.
   No `-intended.md` file was touched. Changelog appended.
3. **Employee-only gate in `shell.js`** — a genuine gap the stale tree missed, not a
   port. On current `main`, `api/auth/session.mjs` projects **client, affiliate and
   partner** principals into the same `staff`-shaped object `mountChip()` receives, so
   the plain "prepend `avatarChipHtml(staff.avatarUrl)`" from the lost work would have
   shown a "+" button to those three — and `/api/staff/avatar` gates on `requireAuth`,
   which accepts staff sessions only, so their only possible outcome is a 401. They have
   no staff row for a photo to hang on. `AVATAR_EXTERNAL_ROLES = ["client","affiliate",
   "partner"]` now short-circuits both the markup and `wireAvatarUpload()`. Everything
   else in the chip is unchanged for all three.

### Frontend, rebuilt (`public/app/shell.js`)

Same behaviour the lost work was verified at, re-implemented against current code:
`avatarChipHtml(avatarUrl)` (22px circular `<img>` when set, 16px "+" when not, both
`id="fh-shell-avatar"` so click-wiring never branches) and `wireAvatarUpload(el, demo)`
(hidden `<input type="file" accept="image/png,image/jpeg">`; demo sessions get the inline
"Demo session — sign in for real to add a photo." and the picker never opens; multipart
POST with field `photo`; `getSession()`'s exact auth pattern —
`localStorage.getItem("fh_token")` → `Bearer` when present — and deliberately **no**
manual `content-type`, so the browser writes the multipart boundary; on success re-run
`getSession()` and swap only the avatar node's `outerHTML` with a `?v=` cache-buster, then
re-bind its click; ~4s inline error on failure; click target dimmed and locked while a
request is in flight). Both variants set `pointer-events:auto` — the chip body is
deliberately `pointer-events:none`, same override Sign out already carries. `swap()` also
re-runs `layoutShellChrome()`, because Search is positioned off the chip's *measured*
width and the two variants differ by 6px — the same reason `setChipHidden()` does it.
`data.js` untouched, as instructed: `FHData.uploadFiles` hardcodes field name `"file"`
and is not loaded on every screen the chip renders on.

### Verification (all in the isolated worktree)

- `npm run lint` — **clean, 1537 files**.
- `node --check` on `public/app/shell.js`, `api/staff/avatar.mjs`,
  `src/http/staff-avatar.pg.test.mjs`, `netlify/functions/api.mjs`, `src/auth/session.mjs`
  — all valid.
- **Own fresh scratch Postgres, `fh_avatar_recon2`** — built from zero, never production,
  never `fundhub_ci`, never the repo's committed `.env`. `db/migrate.mjs` applied **all
  212 migrations** cleanly including 270; `staff.avatar_key text` confirmed present and
  `migrations/270_staff_avatar_key.sql` recorded in `schema_migrations`.
- `src/http/staff-avatar.pg.test.mjs` — **13/13 pass**.
- `src/http/routes.test.mjs` — **15/15 pass**.
- All five `src/auth/*.pg.test.mjs` — **83/83 pass**.
- `src/auth/session.test.mjs` + `src/http/middleware/requireAuth.test.mjs` +
  `src/http/app-nav-reachability.test.mjs` — **73/73 pass**.
- **Full `npm test`** against that database: unit phase **6882 tests, 6881 pass, 0 fail,
  1 skipped**. Postgres phase 1875 tests, 26 fail — **all 26 pre-existing and none in this
  feature's surface**: they are the partner/RLS isolation suites (creative, social,
  campaigns), which fail when connected as a Postgres superuser because that role has
  `BYPASSRLS` and the policies simply do not apply to it (CLAUDE.md §12). Proven twice
  rather than asserted: (a) re-run as the unprivileged `fundhub_app` role the way CI does,
  those suites report **100 tests, 0 fail** — only their teardown hooks error, since
  `fundhub_app` deliberately cannot TRUNCATE tables it does not own, which is why CI runs
  isolation suites only; (b) the same two files on a **pristine `origin/main`** checkout
  with the same superuser connection fail **18/44 identically**. Nothing in this change
  touches RLS, partner scoping, creative or social.
- Manual read-through of the `shell.js` diff on the two riskiest spots — the auth header
  (byte-identical to `getSession()`'s, with `signOut()`'s try/catch around the
  localStorage read) and the session-refetch/DOM-swap (re-queries by id after
  `outerHTML`, so no detached-node reference survives the swap).

### Left undone

- **The live round trip is still unproven** — the original "Integration verify" row above
  stays `pending`. Everything here is tests and a scratch database; no real browser has
  uploaded a real photo through a deployed backend. That needs a deploy preview, and per
  CLAUDE.md §11 a deploy preview shares the **production** database, so a real upload
  there writes a real `staff.avatar_key` — the owner's call, not an agent's.
- **Not deployed, not merged.** PR only.
- **No `COMPLIANCE REVIEW REQUIRED` flag.** This touches the session shape and a file
  upload, but none of CLAUDE.md §7's list: dispute logic, credit-repair messaging, fee
  timing, refund behavior, payment rails, consent capture, credit-pull type.
- Scratch database `fh_avatar_recon2` left in place for follow-up checks. Drop it with
  `dropdb fh_avatar_recon2`. Its `fundhub_app` role was given a throwaway login password
  for the CI-shaped run; that role change is local to this developer machine's Postgres
  and touches no real infrastructure.
