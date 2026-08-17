# Reconcile — AUDIT-FINDINGS.md (re-verified 2026-08-16, HEAD 8887286)

Auditor: claude-fable-5 (read-only). Method: read the whole doc, listed every distinct finding (duplicates from two lenses merged into one id), grepped/read the cited files at HEAD, plus a handful of unauthenticated GET/empty-POST probes against https://fundhub.ai (no login used). Prior status for every row is "FIXED" per the doc's 2026-07-31 header unless marked otherwise.

Counts: total 55 · done 43 · still open 9 · superseded 3 · unverified 0.

| Id | Prior finding (short) | Prior status | Now | Evidence | Note |
|---|---|---|---|---|---|
| B1 | Every provider webhook 500s on Netlify (req not a stream) — 2 dup lenses | FIXED | done | api/webhooks/[provider].mjs:26-28 reads req.rawBody; netlify/functions/api.mjs:862 passes rawBody; live POST {} /api/webhooks/commas → 401 | adapter contract fixed |
| B2 | calendar.html paints live schedule into hidden #demoBody | FIXED | done | public/app/calendar.html:978-990 wire → paintAll(); demoBody only touched by toggle at :936 | |
| B3 | /api/dashboard/* open with no credential (fail-open gate) | FIXED | done | src/http/dashboard-auth.mjs:9-24 fail-closed, header-only; api/dashboard/clients.mjs:60-72 gate+role+org; live GET /api/dashboard/clients → 401 | |
| B4 | 031 renamed invoice columns; createInvoice/markSent dead — 2 dup lenses | FIXED | done | src/invoices/index.mjs:58-61 amount_due/external_ref, :82 sent_at; src/invoices/invoices.pg.test.mjs exists | |
| H1 | HANDOFF says content-admin has "no table" | FIXED | done | HANDOFF.md:138 now names entitlement_catalog as partial source | |
| H2 | HANDOFF summary "14 of 21 / 7 screens" contradicts body "15 of 21" | FIXED | still open | HANDOFF.md:48 still "14 of 21…7 screens"; HANDOFF.md:125 "15 of 21" | doc contradiction never edited |
| H3 | Setup steps never start the API server | FIXED | done | HANDOFF.md:79 `node scripts/dev-server.mjs`, :83 note; scripts/dev-server.mjs exists | |
| H4 | POST /api/auth/logout never revokes account sessions | FIXED | done | api/auth/logout.mjs:7,24 revokeAccountSession | |
| H5 | /api/inngest not registered on Netlify — 2 dup lenses | FIXED | done | netlify/functions/api.mjs:160,768; live GET /api/inngest → 401 (not 404) | |
| H6 | Adapter catch-all / login leak raw err.message (DB host:port) — 2 dup lenses | FIXED | done | netlify/functions/api.mjs:896 safeError; api/auth/login.mjs:17,99 | see M3 for dashboard handlers |
| H7 | documents.html filters revert to sample rows | FIXED | done | public/app/documents.html:397-415 wire empties DOCS and feeds real rows to render() | |
| H8 | partner-galaxy census overwritten by 1s ticker | FIXED | done | public/app/partner-galaxy.html:1656-1659 chrome() writes clock only; :1684 census reported in banner | |
| H9 | pipeline.html renders 5 of 10 stages | FIXED | done | public/app/pipeline.html:1712 buildColumn() per API stage; static board has 1 placeholder col (:558) | |
| H10 | products-commissions live rows misaligned, row click dead | FIXED | done | public/app/products-commissions.html:719-760 wire feeds PRODUCTS → renderProducts() (data-p rows :429) | |
| H11 | Sign out never calls /api/auth/logout | FIXED | done | public/app/shell.js:874-907 fetch("/api/auth/logout") | |
| H12 | staff-teams filter replaces real roster with sample | FIXED | done | public/app/staff-teams.html:962-990 wire feeds PEOPLE → renderAll() | |
| H13 | staff-teams live roster values in wrong columns | FIXED | done | same wire maps role/active/consent/clock into PEOPLE (:975-990); renderRoster() draws it | |
| H14 | Commas webhook with no event id double-counts transactions | FIXED | done | src/adapters/commas.mjs:402-452 idempotency = inbox row.dedupe_key anchored to payment_id | replay not re-run here |
| H15 | Mailgun accepts unsigned when key unset | FIXED | done | src/adapters/mailgun.mjs:367-376 unconditional; live POST {} /api/webhooks/mailgun → 401 | |
| H16 | Nothing writes sales/funding_rounds/commissions/entitlements/referrals | FIXED | done | src/handlers/money-chain.mjs:166,262,305,620 INSERTs; registered src/register-all.mjs:9 | |
| H17 | Malformed session cookie 500s every route | FIXED | done | src/http/middleware/requireAuth.mjs:55 try/catch decodeURIComponent | |
| H18 | DB outage reported as 401 | FIXED | done | src/http/middleware/requireAuth.mjs:65-115 → 503 auth_unavailable db:down | |
| M1 | Client/affiliate/partner login loops back to login.html | FIXED | done | public/login.html:230 reads principal; api/auth/session.mjs header projects principals | live role walks are batch-2's job |
| M2 | VERIFICATION.md check 10 "closer 403 on inquiry" false (read/inquiries is STAFF) | FIXED | superseded | VERIFICATION.md:1 SUPERSEDED banner; line 47 unchanged; api/read/inquiries.mjs:26 ROLE_SETS.STAFF; read-api.mjs:139 STAFF includes closer | code unchanged — closer still reads inquiries; no owner call found |
| M3 | dashboard/clients + pipeline echo raw driver error | FIXED | still open | api/dashboard/pipeline.mjs:140 safeError ✓; api/dashboard/clients.mjs:109 and api/dashboard/seed.mjs:56 still `error: err.message` | now behind auth gate, so authenticated-only leak |
| M4 | dashboard/pipeline reports every failure as 503 db:down | FIXED | done | api/dashboard/pipeline.mjs:134-140 CLIENT_DATA_ERRORS → 400 | |
| M5 | partner-brand PUT returns raw CHECK-constraint text | FIXED | still open | api/partner-brand.mjs:85 HEX.test(body.ink) no typeof guard (array coerces); :253 `problems: [m]` raw | |
| M6 | partner-brand PUT persists non-strings / unbounded strings | FIXED | done | api/partner-brand.mjs:110-120 TEXT_MAX type+length | |
| M7 | Negative limit unbounded on 3 routes | FIXED | done | src/http/read-api.mjs:59-63 boundedLimit; api/tasks.mjs:85, dashboard/clients.mjs:74, pipeline.mjs:76 | |
| M8 | PATCH /api/tasks nonexistent assignee → 500 naming FK | FIXED | still open | api/tasks.mjs:231 still 500 update_failed with detail:safeError(err); read-api.mjs:45-50 CLIENT_DATA_ERRORS lacks 23503; safeError does not strip constraint names (health.mjs:81-89) | status still 500 |
| M9 | Object.prototype names resolve as routes | FIXED | done | netlify/functions/api.mjs:774 hasOwnProperty; live GET /api/constructor → 404 | |
| M10 | agent-editor tiles never re-rendered after wire | FIXED | done | public/app/agent-editor.html:849 renderStats() | |
| M11 | data.js reports outage as "not signed in" | FIXED | done | public/app/data.js:130-134 503/db:down → nodb; requireAuth 503 | |
| M12 | pipeline summary/rail counts stay sample | FIXED | done | public/app/pipeline.html:409-416 "—" placeholders; :1101 setSummary from API | |
| M13 | pipeline Owner filter built once from sample | FIXED | done | public/app/pipeline.html:883-889 rebuilds #fOwner from live cards | |
| M14 | Affiliate commission computed in float | FIXED | done | src/affiliates/economics.mjs:36,185 percentOf/toCents | |
| M15 | No pg connect timeout | FIXED | done | src/db.mjs:47-49 connectionTimeoutMillis 5000, statement_timeout 15000 | |
| M16 | Replay un-revokes revoked entitlement | FIXED | done | src/entitlements/entitlements.mjs:108-116 revoked → {granted:false, reason:"revoked"} | |
| M17 | Dead-letter queue never drained | FIXED | done | scripts/drain-dead-letters.mjs calls retryDue; header says deliberately a script | nothing schedules it (no cron/package.json entry) |
| M18 | NUL byte → 500 with raw pg text | FIXED | done | netlify/functions/api.mjs:796-805 query NUL → 400 invalid_parameter | JSON-body NUL path not separately guarded; adapter catch-all scrubs (api.mjs:896) |
| M19 | read-api 500 branch echoes raw pg message | FIXED | still open | src/http/read-api.mjs:257-260 only scrubs DSN, returns message | relation/constraint names still echoed to authed callers |
| M20 | Invoices written with NULL idempotency key | FIXED | done | src/workflows/ds-02-diy-letters.mjs:137 / f-07-funding-locked.mjs:86 sourceEventId; src/invoices/index.mjs:59-68 source_event_id + ON CONFLICT | |
| L1 | APPLY-NOTES diagnostic wrong; INQUIRY_API_* absent from .env.example | FIXED | still open | APPLY-NOTES.md:83 still says "upstream unreachable → secret missing"; api/inquiry.mjs:38-40 now answers 503 not_configured | .env.example not read (tool permission blocked that path) |
| L2 | HANDOFF "db/migrations/ 33 files" | FIXED | done | HANDOFF.md:107 "db/schema + migrations + seed — 33 total (10+21+2)" | |
| L3 | HANDOFF contradicts itself on wired count (dup of H2) | FIXED | still open | HANDOFF.md:48 vs :125 | same as H2 |
| L4 | health, dashboard/clients, dashboard/pipeline accept every method | FIXED | still open | clients.mjs:57-59 and pipeline.mjs:64-66 405 ✓; live POST /api/dashboard/clients → 405; api/health.mjs has no req.method check | partial: /api/health only |
| L5 | /api/inquiry 500 for missing env var | FIXED | done | api/inquiry.mjs:33-40 → 503 not_configured | |
| X1 | src/partners/scope.mjs has zero importers | (missed) | done | importers: src/http/read-api.mjs, api/read/partners.mjs, api/campaigns/detail.mjs, src/partners/rls.mjs, src/auth/account-session.mjs | |
| X2 | src/documents dead; no /api/documents/:id route | (missed) | done | netlify/functions/api.mjs:161 documentById; api/documents/[id].mjs; src/contracts/signed-link.mjs | |
| X3 | /api/webhooks/lendflow 404 | (missed) | done | src/http/router.mjs:52 lendflow registered; live GET /api/webhooks/lendflow → 405 (route exists) | |
| X4/O1 | Nothing transmits (no outbound provider) | OPEN (deliberate) | superseded | src/messaging/providers/* (8 fetch call sites); messageDispatchSweeper listed src/workflows/index.mjs:92 | live drop still gated by creds + INNGEST_EVENT_KEY (owner-set) |
| X5 | scripts/marketing/lib tests never run | (missed) | done | scripts/run-suite.mjs:50 walks scripts/ recursively | |
| O2 | Six screens have no data source | OPEN (deliberate) | still open | automations.html:412, galaxy.html:1807, closer-dashboard.html:1134, sample-data.html:374 now fetch; content-admin.html and index.html: 0 FHData/api refs | partial — 2 of 6 remain |
| O3 | inquiry-remover has no inquiry_log write path | OPEN (deliberate) | done | src/inquiry-removal/cases.mjs:277,296,423 INSERT/UPDATE inquiry_log | endpoint wiring not traced |
| O4 | DATABASE_URL + Inngest keys are operator actions | OPEN (deliberate) | superseded | live DB-backed routes answer 401 not 500; CLAUDE.md §11 lists INNGEST_EVENT_KEY as owner-gated | owner-set |
