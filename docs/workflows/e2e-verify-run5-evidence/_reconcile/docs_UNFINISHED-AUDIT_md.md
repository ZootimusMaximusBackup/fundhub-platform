# Reconcile — docs/UNFINISHED-AUDIT.md

Re-verified 2026-08-16 at HEAD `8887286` by claude-fable-5 (read-only). Prior doc measured 2026-08-02 at `df3e3b8`.
Method: code grep at HEAD + owner-decision memories + `docs/workflows/*2026-08-1*.md` + unauthenticated GET route-existence probes on https://fundhub.ai (405 = POST-only route present, 401 = auth-gated route present). No login, no writes.

Counts: total 48 · done 15 · still open 26 · superseded 5 · unverified 2

| Id | Prior finding (short) | Prior status | Now | Evidence | Note |
|----|------------------------|--------------|-----|----------|------|
| W-L1 | Hiring screen hardcoded, never called API | Fixed | done | public/app/hiring.html:278 "fetched live"; netlify/functions/api.mjs:499-504; live GET /api/hiring/candidates → 401 | still true |
| W-L2 | Creative tiles false "ok" | Fixed | done | api.mjs:488-494 seven creative routes; live GET creative/generate → 405 (route present) | — |
| W-L3 | Content-admin hardcoded stats | Honest now | still open | public/app/content-admin.html:277 "No backend exists"; :634 upload disabled; no api/content/* dir | honest, still no backend |
| W-L4 | Galaxy static pretending live | Honest now | done | public/app/galaxy.html:373 boots from /api/read/company-activity (api.mjs:418; live 401); partner-galaxy fake people removed docs/workflows/honest-fix-2026-08-16.md:148 | no fake rows; empty until presence |
| W-L5 | Social action-log route unreachable | Fixed | done | api.mjs:470-472 social routes; social-studio.html:1866 fetch /api/social/schedule | — |
| W-D1-4 | Dead reads: invoices, funding-rounds, finance-os, banking-surface | Still true | still open | invoices now read by public/app/ops-admin.html:831; no public caller for read/funding-rounds, read/finance-os (api.mjs:334), read/banking-surface (api.mjs:342) | 1 of 4 closed |
| W-D5 | No screen calls /api/shifts | Still true | done | public/app/staff-teams.html:910 FHData.write("/api/shifts",{action}) | — |
| W-D6-19 | Hiring/creative APIs unused, no write HTTP | Mostly fixed reads | still open | creative writes exist (api/creative/generate.mjs:12 POST); api/hiring/* all GET (candidates.mjs:1), no POST handler | creative done, hiring open |
| W-D7 | banking/revoke no UI | Still true | still open | api.mjs:534 routed; grep public/ finds no caller | — |
| W-D8 | privacy/erasure no UI | Still true | still open | api.mjs:535 routed; no public caller; live GET → 401 | — |
| W-D9 | finance/cashflow no UI | Still true | still open | api.mjs:593; no public caller; live GET → 401 | — |
| W-D10 | banking/accounts no callers | Still true | still open | api.mjs:611; grep public/ no caller | — |
| A1 | Workflow outbound mail queued, rarely drained | open (P0) | still open | INNGEST_EVENT_KEY not flipped (docs/workflows/comprehensive-fix-report-2026-08-16.md:24,38; netlify.toml:47-49); staff sweeper staff-only netlify/functions/staff-message-sweeper.mjs:35-40; outbox paused outbound_enabled=false (fix-report:41) | owner-set: outbox paused, GHL out, Twilio awaits A2P; piece (5) channel routing now done via message_channel_routing (src/messaging/dispatch.mjs:230) |
| A2 | Magic-link queues only, always ok:true | open | still open | src/auth/magic-link.mjs:41-43; api/auth/magic-link.mjs:92 | depends on A1 |
| A3 | Direct mail intake built, no drop | owner-gated | superseded | src/mail/README.md:44-47 no activation/scheduler; fix-report:47 "Prescreen mail drop … deliberately not mailing (FCRA gate)" | owner-set gate, unchanged |
| A4 | Alerts/reminders rows only; misleading "text" toast | open | still open | public/app/finance-os.html:869 toast still says "You will get a text"; src/alerts/store.mjs:25 no cron; no ack/resolve/dismiss calls in finance-os.html (API has them api/finance/alerts.mjs:422-440) | — |
| B1 | Inngest 49 fns dormant without keys | open (P0) | still open | fix-report:24 "NOT flipped: INNGEST_EVENT_KEY"; src/events/bus.mjs:49; functions.length=51 now (src/workflows/index.mjs:55) | owner-gated; count drifted 49→51 |
| B2 | Hard-decline detector deferred | open | still open | src/workflows/c-06-crs-results-router.mjs:51 HARD_DECLINE_SIGNALS_DEFERRED = true | — |
| B3 | Contract chaser needs Inngest | open | still open | src/workflows/contract-chaser.mjs:97 cron; api/contracts.mjs:375 manual run_reminders | blocked on B1/A1 |
| B4 | Dead-letter retry not scheduled | open | still open | retryDue only called from scripts/drain-dead-letters.mjs:72; not in netlify.toml schedules (lines 51-69) | — |
| B5 | Workflows never migrated from GHL (N-07, BC-03, CT-00..03) | open | still open | no src/workflows/ct-*, n-07, bc-03 files; docs/workflows/status-mailgun-sms-ct-closer.md:41 CT deferred; referenced workflow-migration-table.md not found in repo | source table doc absent |
| C1 | No production INSERT sales/funding_rounds | open (P1) | done | src/handlers/money-chain.mjs:166 (sales), :620 (funding_rounds); registered src/register-all.mjs:23; commit 01a0e87 2026-08-04 | — |
| C2 | Commission ledger calculator only | open (P1) | done | src/handlers/money-chain.mjs:345 db.query(SQL_INSERT_LEDGER) | — |
| C3 | grant() never called from handlers | open (P1) | done | src/handlers/money-chain.mjs:37,438 grantFromTransaction; owner call: product_entitlements map stays empty in migrations (docs/workflows/money-chain-writers.md owner call 4) | grants no-op until product map seeded — owner-set |
| C4 | Subscriptions no charging | owner-gated | superseded | src/subscriptions/store.mjs:4-5 still no processor/scheduler | owner-set: compliance-flagged, unchanged |
| C5 | Payment links no Commas create-session | open | done | src/payment-links/index.mjs:13,49 createCheckoutSession (src/payments/commas-api.mjs); docs/workflows/crm-soft-pull-populate-2026-08-15.md "FanBasis checkout-session mint done", $1 link minted | webhook secret still listed missing in STILL-MISSING |
| C6 | Soft pulls request queue only, no bureau | open (P2) | done | provider src/messaging/providers/crs-softview.mjs (TRANSMITS=true); coordinator src/finance/crs-pull.mjs; inline handler src/handlers/diagnostic-soft-pull.mjs:13 runs C-00; CRS_ALLOW_LIVE on Netlify (crm-soft-pull-populate board) | owner-set CRS_ACTIVE_BUREAUS=EX,EQ (TU E1006) |
| C7 | Plaid link not_implemented | open (P2) | still open | src/banking/plaid.mjs:479-543 SEAM_REASONS.NOT_IMPLEMENTED | owner-gated (SOC2/consent) |
| C8 | Finance 501 comments stale | doc-only | still open | netlify/functions/api.mjs:550-554; public/app/data.js:317-319 still describe 501 | docs only |
| D1 | Hiring GET-only, no write API/UI | open (P2) | still open | api/hiring/*.mjs all GET (candidates.mjs:1); fix-report:70,181 hiring = furniture page | — |
| D2 | Creative no generate path | open (P2) | done | api/creative/generate.mjs:12 POST; run/actions/approvals routed api.mjs:488-494; runner cron netlify.toml:57-58 → src/creative/runner.mjs; live GET generate → 405 | provider keys unset (STILL-MISSING CREATIVE_*); brand-studio.html:441 BS-06 still "Coming soon" |
| D3 | Social schedule/publish no HTTP, Queue button dead | open (P2) | done | api.mjs:470-472; social-studio.html:520 Queue post → :1866 fetch /api/social/schedule; netlify.toml:54-55 social-publish-sweeper → publishDueAll registers adapters (src/social/publish-all.mjs:5-10); live GET → 405 | channel page tokens still missing (STILL-MISSING) |
| E1 | Content admin in-memory only | open (P3) | still open | content-admin.html:277,634; no api/content route | — |
| E2 | Galaxy simulated; no presence/handoff/money feed | open (P3) | still open | presence feed wired galaxy.html:373 (/api/read/company-activity); partner-galaxy census live but "No new partner API" (honest-fix-2026-08-16.md:148); handoff/money feeds not found | partial — presence done |
| E3a | Staff clock UI never calls /api/shifts | open (P1) | done | staff-teams.html:531-534,908-928 | — |
| E3b | autoCloseStale has no scheduler | open (P1) | still open | no non-test caller of autoCloseStale outside src/shifts/store.mjs; not in netlify.toml | — |
| E4-invoices | GET /api/read/invoices no screen | open | done | public/app/ops-admin.html:831-832 FHData.invoices | — |
| E4-rest | erasure, revoke, cashflow, banking/accounts, funding-rounds, finance-os, banking-surface no screen | open | still open | see W-D1-4, W-D7-10; read/finance-os + banking-surface still routed (api.mjs:334,342), not removed/aliased | — |
| F-inngest | INNGEST_EVENT_KEY / SIGNING_KEY unset | off | still open | fix-report:24,38; EVENT_KEY owner-gated; SIGNING_KEY presence unverified (Netlify env not readable here) | owner-set |
| F-outbound | messaging_settings.outbound_enabled | per-org | superseded | fix-report:41 outbox paused outbound_enabled=false on purpose | owner-set pause |
| F-providers | Mailgun/GHL/Twilio send env unset; Twilio ENABLED=false | off | superseded | src/messaging/providers/twilio.mjs:53 ENABLED = true (owner 2026-08-14); ghl-relay.mjs:49,72-78 GHL dead/no-op; Mailgun keys present on Netlify by name (docs/STILL-MISSING.md) | owner-set: GHL out, SMS=Twilio, A2P pending |
| F-demo | DEMO_LOGINS_ENABLED unset | off | unverified | src/auth/demo-logins.mjs:4 still fails closed; env value not readable read-only | role logins now real seeded rows (fix-report §2) |
| F-banking | BANKING_MOCK_PROVIDER / BANKING_PROVIDER=mock | off | still open | src/banking/providers/mock.mjs:133; plaid seams C7 | — |
| F-creative | creative_providers rows none seeded | off | still open | no INSERT INTO creative_providers in db/seed or db/migrations; src/creative/providers/index.mjs:56-63 throws when empty | 052_config_defaults only reports the count |
| OG1-5 | Intentionally unfinished: mail drop, Plaid, subscription charging, INNGEST key, backlog drain | owner-gated | superseded | see A3, C7, C4, B1, A1; owner memories + fix-report §1 | all five still gated, unchanged |
| P3-doc | Doc drift: 501 comments, "47 functions", sweeper "unregistered" | open (P3) | still open | CLAUDE.md:281 "47", :307 "deliberately not registered" vs src/workflows/index.mjs:92 registered and functions.length=51; netlify.toml:47 "47" | docs only |
| LU1 | Left unchecked: Mailgun/GHL creds on Netlify | unchecked | done | docs/STILL-MISSING.md "Already present on Netlify (by name only)": MAILGUN_SEND_*, GHL_* | GHL now dead by owner call |
| LU2 | Left unchecked: sales/funding_rounds rows exist; Commas double-count | unchecked | unverified | needs DB read; not done read-only | — |
