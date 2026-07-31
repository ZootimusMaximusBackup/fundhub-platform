# fundhub-beta-buildout — shared board

> This file did not exist when Migration 099 started. It was created by that
> workflow so there was a board to claim against. Other workflows in this batch:
> add your rows, do not rewrite anyone else's.

## Branch note — read before you start

`origin/main` and the working branches are **two unrelated git histories**. They
share no common ancestor (different root commits). `origin/main` holds 13 commits
of early-phase work with **zero migrations** and none of `src/finance/`,
`netlify/`, `docs/` or `CLAUDE.md`.

**Do not cut a branch from `origin/main`.** You will get a tree in which none of
this product exists. Branch from the current feature lineage instead.

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| 099 | Consent record + capture flow + `hasValidConsent` + gate on the soft-pull REQUEST path | migration-099-consent | **done** |

Other workflows: append your rows here.

## Shared context brief

Facts established while building 099. Consume these rather than re-reading the
same modules.

- **The ROUTES trap is real and enforced.** `netlify/functions/api.mjs` holds a
  hand-written `ROUTES` map. A handler absent from it 404s locally and deployed.
  `src/http/routes.test.mjs` fails on any unrouted file under `api/`, so you
  cannot forget silently — but you must add the entry in the same commit.
- **`requireAuth` ignores a `roles` key.** Its third argument is `{ db, env }`.
  Gate with a second call: either `requireRole(...)(req,res)` from
  `src/http/middleware/requireRole.mjs`, or `requireRole(res, staff, roleSet)`
  from `src/http/read-api.mjs`. `src/http/auth-gate.test.mjs` scans for the
  broken shape.
- **`src/db.mjs` exports `db` as a plain `{ query }` object.** That is a clean
  test seam: swap `db.query` in a test and the whole import graph is stubbed —
  no module mocking, no `DATABASE_URL`. `src/http/consent-capture.test.mjs`
  demonstrates it, including stubbing the session lookup that `requireAuth`
  performs.
- **`withTransaction` at `src/finance/soft-pulls.mjs:502` is the correct helper.**
  The `typeof db.connect === "function"` probe used in `src/pii/index.mjs` is
  broken against this repo's own handle, which has no `connect()` — it silently
  takes the autocommit branch for every production caller.
- **`npm test`'s glob is `src/**` and `scripts/**` only.** A test under `api/`
  never runs. Endpoint tests belong at `src/http/<name>.test.mjs`.
- **`*.pg.test.mjs` skip with no `DATABASE_URL`,** so a green `npm test` proves
  nothing about them. No-database baseline: **2324 pass, 0 fail, 321 skipped.**
- **You can run the real thing locally.** Postgres 16 is installed in this
  image, just stopped. `pg_ctlcluster 16 main start`, create a role and a
  database, point `DATABASE_URL` at it and `node db/migrate.mjs` applies all 67
  files cleanly. This is much better than trusting the skipped suite — do it.
- **The pg suite is genuinely, badly flaky, and worse than CLAUDE.md §12 says.**
  Measured on this branch: **two consecutive baseline runs with ZERO code change
  produced 47 and 60 failures**, differing by 13 — the whole `conversations`
  block appeared in one and not the other, and `campaigns` / `principal-reads`
  did the reverse. Suites that fail in a full run pass in isolation. **Do not
  read a full-run failure count as a regression signal.** Diff the failing test
  NAMES against a baseline you ran yourself, twice, and re-check anything
  suspicious in isolation.
- **Dependencies were not installed** in this environment. `npm ci` first or
  every test errors with `ERR_MODULE_NOT_FOUND` on `inngest`.
- **`docs/journeys/` did not exist.** No journey has an `-intended.md`, so no
  actual-vs-intended gap is measurable anywhere yet.

## Change manifest — task 099

**COMPLIANCE REVIEW REQUIRED.** Consent capture. Ships only after human approval.

### Files added

| File | What it is |
|---|---|
| `db/migrations/099_client_consents.sql` | `client_consents` table — what/who/when/how/expiry/revocation/document ref |
| `src/consent/index.mjs` | `hasValidConsent`, `consentStatus`, `captureConsent`, `revokeConsent`, `listConsents` |
| `src/consent/disclosures.mjs` | Server-owned consent wording, versioned, append-only. **Wording is DRAFT — needs counsel** |
| `api/consent/capture.mjs` | `GET`/`POST` capture + revoke endpoint |
| `public/app/consent-capture.html` | The capture screen |
| `src/consent/consent.test.mjs` | 67 unit tests, no database |
| `src/http/consent-capture.test.mjs` | 39 endpoint tests, stubbed db, no `DATABASE_URL` |
| `src/consent/consent.pg.test.mjs` | Schema-level tests. **Skips** without `DATABASE_URL` |
| `docs/journeys/client-actual.md` | Consent segment only |
| `docs/journeys/CHANGELOG.md` | New |

### Files changed

| File | Change |
|---|---|
| `src/finance/soft-pulls.mjs` | **GUARD 0** in `requestSoftPull` — refuses without live consent, before both duplicate guards. `SoftPullError` gained an optional `code`. Added `consentRefusal()`. Header rule 0. |
| `netlify/functions/api.mjs` | Routed `consent/capture` |
| `src/finance/soft-pulls.test.mjs` | Existing queue-based fakes now satisfy the new precondition; added 10 gate tests |
| `src/finance/soft-pulls.pg.test.mjs` | `before()` now grants consent for both fixture clients — 17 tests were failing on the new precondition |
| `src/http/finance-soft-pull.pg.test.mjs` | Same fixture fix — 8 tests were failing |

### Verified against real Postgres 16

Migration 099 **applies cleanly** on a virgin database (67 files, no errors).
Isolated suite results, all with `DATABASE_URL` set:

| Suite | Result |
|---|---|
| `src/consent/consent.test.mjs` | 67 pass, 0 fail |
| `src/consent/consent.pg.test.mjs` | 27 pass, 0 fail |
| `src/http/consent-capture.test.mjs` | 39 pass, 0 fail (also 39/0 with no `DATABASE_URL`) |
| `src/finance/soft-pulls.test.mjs` | 79 pass, 0 fail |
| `src/finance/soft-pulls.pg.test.mjs` | 27 pass, 0 fail |
| `src/http/finance-soft-pull.pg.test.mjs` | 21 pass, 0 fail |
| `src/http/routes.test.mjs` | 14 pass, 0 fail |
| `src/http/auth-gate.test.mjs` | 3 pass, 0 fail |

Full suite, no `DATABASE_URL`: **2324 pass, 0 fail.**
Full suite with Postgres: 45–47 failures against a baseline that itself ranges
47–60 across runs. See the flakiness note above.

### Exports added

- `src/consent/index.mjs` — `hasValidConsent(db, {orgId, clientId, kind})`,
  `consentStatus`, `captureConsent`, `revokeConsent`, `listConsents`,
  `normalizeConsentText`, `normalizeCaptureMethod`, `normalizeGranter`,
  `normalizeExpiry`, `boundedLimit`, `decorate`, `ConsentError`,
  `CONSENT_KINDS`, `CAPTURE_METHODS`, `CONSENT_REASONS`
- `src/consent/disclosures.mjs` — `disclosureFor`, `versionsFor`,
  `SOFT_PULL_DISCLOSURES`, `CURRENT_SOFT_PULL_VERSION`
- `src/finance/soft-pulls.mjs` — `consentRefusal`

### Route added

`consent/capture` → `api/consent/capture.mjs`. Staff **and** client principals.
Staff roles: `owner`, `admin`, `closer`, `funding_advisor` — deliberately the
same set as `SOFT_PULL_ROLES`, pinned by a test. **If one set moves the other
must move with it.**

### What this does NOT touch

`src/tradelines/` ingest, `crs_results` parsing, `fulfilSoftPull`, `recordPull`.
Read from, never modified. The gate is on the REQUEST path only.

### Blocking anyone?

No. `subscription_id` on `soft_pull_requests` still carries no FK, and
`client_consents.document_id` points at `documents` (030), which already exists.
Nothing here couples to another workflow's unfinished output.

## Blockers and open questions

1. **The consent wording needs a lawyer.** `src/consent/disclosures.mjs` is
   marked DRAFT. It makes no claim about credit outcomes (pinned by a test) but
   it is customer-facing authorization text in a regulated product.
2. **Should the existing `cf_crs_softpull_consent` CRM values be honoured?**
   Deliberately **not** backfilled — that column has no wording, no capture
   method, no attribution. Backfilling would manufacture records that pass the
   gate while meeting none of the standard. Decision for Chris + counsel.
3. **Migration 099 has not been applied to the real database.** It was applied
   and fully exercised against a local Postgres 16 in this container, but
   `api.netlify.com` and `api.supabase.com` are blocked by the network policy, so
   the production `DATABASE_URL` could not be read and nothing was run against
   Supabase. Somebody with access still has to run
   `DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" node db/migrate.mjs`.
4. **The screen has not been opened in a browser.** No Playwright in this repo.
