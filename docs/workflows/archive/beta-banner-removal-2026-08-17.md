# Beta banner + Beta nav removal

Batch: beta-banner-removal-2026-08-17
Started: 2026-08-17
Owner ask: remove the yellow "Beta — under development" banner for every role except owner.
Owner keeps it. Also remove Beta-tagged screens from staff, partner and affiliate nav.

## Task list

| Task | Owner | Status |
|---|---|---|
| code + deploy | me (workflow 1) | blocked — see below |
| closer proof | agent w2 | claimed |
| advisor proof | agent w3 | claimed |
| affiliate + partner proof | agent w4 | claimed |
| owner proof | agent w5 | claimed |

## Shared context brief

One file drives all of this: `public/app/shell.js`.

- `BETA_PAGES` (15 screens) is the single list. A screen in it gets a BETA
  badge in nav (`mountSidebar`) and the yellow banner on the page
  (`mountBetaBanner`).
- `mountBetaBanner(role)` ALREADY returns early unless the role is owner.
  That gate landed in commit 17c20bc, "Apply the 2026-08-17 UI audit owner
  answers", which is on main, 8 commits back. So the banner fix may already
  be live — round 1 captures exist to find out.
- Staff nav is ALREADY clean. All 15 BETA_PAGES are filtered out of
  `staffTabs()`: 12 via OWNER_ADMIN_ONLY, hiring via HIRING_ONLY, affiliate
  via PORTAL_ONLY, brand-studio via PRINCIPAL_ONLY.

## Open question (blocks the partner/affiliate edit)

`ROLE_TABS.affiliate` is exactly `["affiliate.html"]`, and affiliate.html is
Beta-tagged. Removing it leaves the affiliate with zero screens, and shell.js
treats zero screens as a config error and signs the user out. That is a full
lockout.

`ROLE_TABS.partner` is `["partner-galaxy.html", "brand-studio.html",
"social-studio.html", "creative-factory.html"]` — three of four are
Beta-tagged. Removing them leaves the partner a Home page only.

Awaiting owner answer: untag those screens (stay in nav, banner gone), or
genuinely lock those roles down.

## Blockers

- partner/affiliate nav edit — waiting on the owner answer above.

## Change manifest

(pending)

## What is proven (2026-08-17, live)

- The live https://fundhub.ai/app/shell.js is byte-identical to the repo copy
  at HEAD 7be91a0. sha256 461d4ac76b31216c65206ff2f4cbd0f7c433403bb85743fcc78f6d4daf6521ec.
  crm-sidebar.css and data.js match live too.
- Line 1683 of the LIVE file reads `if (normRole(role) !== "owner") return;`
  inside mountBetaBanner. So the yellow banner is ALREADY owner-only in
  production. Nothing to push or deploy for the banner itself.
- Staff nav is ALREADY clean: all 15 BETA_PAGES are filtered out of
  staffTabs() (12 OWNER_ADMIN_ONLY, hiring HIRING_ONLY, affiliate PORTAL_ONLY,
  brand-studio PRINCIPAL_ONLY).
- npm run lint: 1296 files parse clean.

## Owner decision 2026-08-17

Untag affiliate.html, brand-studio.html, social-studio.html and
creative-factory.html from BETA_PAGES. Accepted trade: the owner also stops
seeing the banner on those four screens, because one list drives both the
badge and the banner. Owner-set. Not to be re-raised.

## BLOCKER — shared working directory

15 other interactive Claude sessions are running in this same working
directory right now (started 17-20 min ago), editing 28+ files including
public/app/shell.js.

I applied the BETA_PAGES change and verified it (15 screens -> 11, node
--check clean). Within about two minutes another session reverted
public/app/shell.js back to HEAD. My change was wiped, and so was that other
session's own lenders / ADVISOR_ONLY work in the same file.

Nothing was committed. HEAD is still 7be91a0.

Consequences:
- Re-applying now just gets wiped again.
- I cannot commit shell.js alone without carrying another session's
  in-flight work in the same file.
- I must not push or deploy: that would ship 15 sessions' half-finished work
  to production.

The change is saved and ready to re-apply in one command, idempotent and
line-drift proof:
  node <scratchpad>/apply-beta-untag.mjs

Unrelated pre-existing red, caused by another session, NOT by this work:
src/http/routes.test.mjs fails because api/company-brain/threads.mjs and
api/company-brain/upload.mjs are new untracked handlers not yet added to
ROUTES in netlify/functions/api.mjs (CLAUDE.md §12, "a handler file is not a
route"). That belongs to the company-brain batch.

## LIVE OUTAGE FOUND 2026-08-17 — sign-in is down on fundhub.ai

Found while trying to capture proof. Verified directly, not taken from an
agent's word.

PROVEN:
- `POST https://fundhub.ai/api/auth/login` returns **HTTP 500** with body
  `{"ok":false,"error":"internal_error","message":"cannot execute INSERT in a read-only transaction"}`
  The probe used a made-up address (`probe-does-not-exist@example.invalid`),
  so this is NOT a bad-password path. Login crashes before credentials matter.
  A healthy login rejects an unknown user with 401/400.
- Reads still work: `GET /api/health` returns 200, `db":"up"`.
- Health reports `migrations:159, expected:156, pending:0`.
- Three migration files are staged-but-uncommitted in the working tree and
  have already been applied to the PRODUCTION database:
    db/migrations/174_company_brain_uploads.sql
    db/migrations/175_company_brain_threads.sql
    db/migrations/176_company_brain_upload_reviews.sql
  They ALTER brain_files, CREATE brain_threads / brain_messages, and ALTER
  brain_classification_reviews. They belong to the company-brain batch, not
  to this one.

IMPACT: nobody can sign in to fundhub.ai. Every write is refused, so this is
not limited to login — anything that saves data is failing.

NOT PROVEN — why the database is read-only. Most likely, in order:
1. Supabase flipped the project to read-only after hitting a disk/storage
   quota. That is the usual source of this exact Postgres message.
2. The app's DATABASE_URL now points at a read-only endpoint, or the app's
   database role was made read-only (cf. `fundhub_app`, migrations/104).
3. The database is failing over or in recovery.

CANNOT DIAGNOSE FURTHER FROM HERE: `api.supabase.com` and `api.netlify.com`
are blocked by the hosted-agent network policy (CLAUDE.md §11 egress). The
Supabase dashboard has to be checked by a human or a session with access.

DID NOT TOUCH: the database, DATABASE_URL, env vars, migrations, or the
deploy. Reporting only.

CONSEQUENCE FOR THIS BATCH: the captures Chris asked for cannot be produced
at all right now. No role can sign in, so no role's screens can be
photographed. All four capture agents were stopped rather than left hammering
a broken sign-in endpoint. Owner round-1 evidence contains sign-in-page
screenshots only, which prove the outage and nothing about the banner.
