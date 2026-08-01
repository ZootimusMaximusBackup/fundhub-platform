# MIGRATION-099 — consent record and the soft-pull gate

One workflow's file in the `fundhub-beta-buildout` batch. The batch board is
`docs/workflows/fundhub-beta-buildout.md`, one level up.

> **Why this is here and not in the batch board.** It started life AS the batch
> board, which was a mistake: this repo's convention is a batch board at
> `<batch>.md` and one file per workflow at `<batch>/<unit>.md` — exactly how
> `finish-the-build.md` sits beside `finish-the-build/W3.md`, `W4.md` and the
> rest. Written to the batch path, this file collided add/add with the
> MIGRATION-100 workflow, which had independently created the same path. Moving
> it here removes the collision outright: the two branches no longer touch a
> shared path, so they merge with nothing to resolve by hand.

> **TWO ROWS FOR WHOEVER OWNS THE BATCH BOARD.** The board that lands from
> MIGRATION-100 says "No other units were claimed in this batch." That was true
> when it was written and is not now. Add these:
>
> | Unit | What it is | Owner | Status |
> |---|---|---|---|
> | MIGRATION-099 | Consent record, capture flow, `hasValidConsent`, gate on the soft-pull REQUEST path | `claude/migration-099-consent-repknn` | **done** — see `fundhub-beta-buildout/099-consent.md` |
> | PGSUITE | Make the Postgres test suite return the same numbers on identical runs | *unclaimed* | **pending** — prompt in `fundhub-beta-buildout/099-consent.md` |
>
> It is two lines and it is the only manual step left between these branches.

## Branch note — RETRACTED, and what to do instead

**An earlier version of this file said `origin/main` was an unrelated, empty
history and told you not to branch from it. That was WRONG. Ignore it.**

What actually happened: at the start of the 099 session the sandbox's cached
`origin/main` ref pointed at a stale commit (`e354ebe`) carrying 13 early-phase
commits and zero migrations, with no common ancestor with the working branch.
Re-fetching later force-updated the ref to the real `main` (`e67e2db`), which is
correct and has all 54 migrations. The real repository was fine the whole time.

**Branch from `main` as normal.** If `git log origin/main` looks impossibly old
or `git ls-tree origin/main db/migrations/` returns nothing, you have the stale
ref, not a broken repo — run `git fetch origin main --force` and look again.
Confirm against the real GitHub repo before concluding anything about history.

The lesson worth keeping: a sandbox git ref is not authoritative. Check the real
remote before you act on a scary-looking history finding.

## Tasks

| # | Task | Owner | Status |
|---|---|---|---|
| 099 | Consent record + capture flow + `hasValidConsent` + gate on the soft-pull REQUEST path | migration-099-consent | **done** |
| PGSUITE | Make the Postgres test suite return the same numbers on identical runs | *unclaimed* | **pending** |

Other workflows: append your rows here.

### PGSUITE — copy-paste prompt

Chris asked for this as its own workflow. Everything a fresh session needs is
below; it does not depend on the 099 session's context.

```
Repo: fundhub-platform. Branch: cut a new branch from main as normal.
(If `git ls-tree origin/main db/migrations/` comes back empty you have a stale
cached ref — `git fetch origin main --force` and look again. The repo is fine.)
Shared board: docs/workflows/fundhub-beta-buildout.md — read it, and read
docs/workflows/fundhub-beta-buildout/099-consent.md, which is where PGSUITE is
written up. Claim PGSUITE on the batch board before starting. Write your own
file at docs/workflows/fundhub-beta-buildout/pgsuite.md — one file per workflow
is this repo's convention (see finish-the-build/W3.md and friends), and writing
your manifest straight into the batch board is how two workflows collide on it.

THE PROBLEM. The Postgres test suite reports a different number of failures on
identical runs. Measured on 2026-07-31 with no code change whatsoever between
runs: 47 failures, then 60. Whole blocks move — every `conversations` test failed
in one run and passed in the other; `campaigns` and `principal-reads` did the
reverse. Suites that fail in a full run pass when run alone. A suite that cannot
give the same answer twice cannot tell anyone whether they broke something, which
means nobody can trust `npm test` before a deploy.

YOUR JOB: make the number stable and correct. Not "make it green" — a stable
honest failure list is the deliverable. Do NOT delete, skip or weaken a test to
reach a number.

HOW TO GET A DATABASE (this is not documented anywhere else):
  pg_ctlcluster 16 main start
  su postgres -c "psql -c \"CREATE ROLE fundhub LOGIN PASSWORD 'fundhub' SUPERUSER;\""
  su postgres -c "createdb -O fundhub fundhub_test"
  export DATABASE_URL="postgresql://fundhub:fundhub@127.0.0.1:5432/fundhub_test"
  npm ci && node db/migrate.mjs
Postgres 16 is preinstalled in the image and stopped by default. Without
DATABASE_URL, ~321 tests skip and the suite reports 0 failures — that green is
meaningless (CLAUDE.md §12).

WHAT IS ALREADY KNOWN — start here, do not re-derive:
  * 52 *.pg.test.mjs files share ONE database. `node --test` runs files in
    parallel at concurrency = CPU count (4 in this image), so 4 suites are
    mutating the same tables at once.
  * Suites clean up with `DELETE ... WHERE email LIKE '<prefix>%'` patterns and
    several call resolveDefaultOrg(db), so they contend on shared org/staff rows.
  * `--test-concurrency=1` was tried and the run reported 330 failures and 553
    cancelled — but THAT RUN IS NOT EVIDENCE: the Postgres server was killed
    partway through it (a stale pid file had to be removed to restart, and no
    clean-shutdown line is in /var/log/postgresql/postgresql-16-main.log). Disk
    and memory were both fine. Re-run serially on a healthy server before
    concluding anything about serial vs parallel — and find out what killed the
    server, because a database that dies under the suite is its own bug and may
    be the whole story.
  * Many cancellations report `failureType: 'cancelledByParent'` — "test did not
    finish before its parent and was cancelled". That is usually a test-authoring
    defect (a subtest created after its parent settled, or an un-awaited async
    call in a describe body), NOT a database problem. Grep for describe blocks
    that call async work without awaiting it.

SUGGESTED ORDER: (1) find out what kills Postgres; (2) fix the cancelledByParent
authoring bugs, which are corrupting the counts; (3) only then decide whether
suites need isolation (schema-per-suite, or a unique org per suite) or serial
execution. Measure after each step by running the full suite 3x and diffing the
FAILING TEST NAMES, not the counts.

DEFINITION OF DONE: three consecutive full runs produce an identical list of
failing test names. Document the remaining real failures as a baseline in the
shared board so the next person can diff against it.

There is no lint script, no TypeScript and no Playwright in this repo. Do not
claim those gates passed.

BINDING: read the "Owner decisions are final" section of CLAUDE.md (it sits
between §2 and §3, unnumbered) before you report anything. A call Chris has made
is decided — log it as owner-set and move on. Do not re-raise it, do not
recommend legal or compliance review, and do not append "you should have someone
look at this" to a report. If something is genuinely unsafe or broken, say it
once, plainly, then drop it.
```

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
| `src/consent/disclosures.mjs` | Server-owned consent wording, versioned, append-only. **Wording APPROVED by Chris 2026-07-31** |
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

## Decisions on the record — CLOSED, do not reopen

Both owner-set by Chris on 2026-07-31. Settled — see the "Owner decisions are
final" section of CLAUDE.md. Do not re-raise either one.

1. **Consent wording approved as written.** `soft-pull-v1` in
   `src/consent/disclosures.mjs` ships as-is. The approval covers **that exact
   string only** — a reworded disclosure is a new version key and needs its own
   approval. Never edit an approved string in place.
2. **Do NOT migrate the old CRM "Yes" values.** `clients.cf_crs_softpull_consent`
   stays where it is; consent is captured fresh from here on. Recorded in the
   header of `db/migrations/099_client_consents.sql`. Writing a backfill later
   reverses an owner decision and needs a new one in writing.

**Consequence to plan for:** on the day 099 ships, every client has no consent
on file, so every soft-pull request is refused until one is captured. Intended,
not an outage.

## Blockers and open questions
3. **Migration 099 has not been applied to the real database.** It was applied
   and fully exercised against a local Postgres 16 in this container, but
   `api.netlify.com` and `api.supabase.com` are blocked by the network policy, so
   the production `DATABASE_URL` could not be read and nothing was run against
   Supabase. Somebody with access still has to run
   `DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" node db/migrate.mjs`.
4. **The screen has not been opened in a browser.** No Playwright in this repo.
