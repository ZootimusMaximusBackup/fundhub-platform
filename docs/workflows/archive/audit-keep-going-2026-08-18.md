# Keep going — leftover product doors — 2026-08-18

Chris: stop asking. Audit. Fire the remaining doors.

Auditor. Findings only. No app edits. No deploy. No commits.
Never open/write `9af65808-…`. No real card charge. Do not flip Netlify `INNGEST_EVENT_KEY`.
No vendor sandbox. Secrets: names only.
TEST: `8556bedc-…`. New funnel client from F-FUNNEL: `edca0767-…`.
Live: `https://fundhub.ai` · `https://apply.fundhub.ai`
Evidence: `docs/workflows/audit-keep-going-2026-08-18-evidence/`

| id | owns | status |
|---|---|---|
| K1 | Calendar + Messaging paint after tonight’s fires | done |
| K2 | Why magic-link portal cannot load the file | done |
| K3 | Consent capture then bureau pull on TEST | done |
| K4 | Closer Present: send-contract / remaining live buttons on TEST | done |
| K5 | Company Brain ask, Affiliate money, education play, Repair Send | done |

## Findings

## K3 findings

**COMPLIANCE REVIEW REQUIRED** — consent + credit-pull.

Consent page bounces to Pipeline. API grant wrote `soft_pull_consent`. Experian once → **422** “no identity on file.” Scores still dashes. No TransUnion. No live file.

Evidence: `docs/workflows/audit-keep-going-2026-08-18-evidence/k3/REPORT.md`

## K4 findings

Present opened TEST. Send contract **PASS** (draft + send both 200, one sign link). Did not click pay. Did not open the live file.

Evidence: `docs/workflows/audit-keep-going-2026-08-18-evidence/k4/REPORT.md`

---

## K1 findings

1. Calendar today (Aug 18) still says **Nothing booked.** The 8:00 PM E2e Fire hold does **not** show. Same as G5b, after the new book.
2. Database has it: booking `f370a046-…` (ClickFunnels) and task `d5300a31-…` “Strategy session booked” due 8:00 PM Phoenix. Client is `edca0767-…`.
3. Same login, `GET /api/tasks` **200** and **has the task**. The page never paints. Counts stay dashes.
4. TEST EMAIL thread: inbound **e2e fire reply** is visible. PASS.
5. TEST SMS thread: **Fundhub e2e ping** is visible on first paint. Left list only shows EMAIL. Ping PASS.
6. Documents for E2e Fire: **nothing**. Zero files. Honest empty.
7. Pipeline: E2e Fire card in **Booked**. Side panel says Aug 18, 8:00 PM, Strategy session booked. PASS.
8. Day / Week / arrows / Today / week-strip all change the date. Every day stays empty. No event row to click. Demo button not on screen.
9. Did not open `9af65808-…`. Did not send. Did not Join Call.
10. Evidence: `docs/workflows/audit-keep-going-2026-08-18-evidence/k1/` (`REPORT.md`, shots `01`–`20b`, `db.json`).

## K2 findings

1. New plus-tag magic-link: `POST /api/auth/magic-link` **200**. Opened the real link as **client**. Not staff. Not the live file.
2. Header: `TEST — Client Role · client`. Page: **“We could not load your file.”** Video missing. No n/6. Dispute says sign in. Did not press Sign.
3. Verify **200**: `account.clientId` = TEST `8556bedc-…`. Token saved. `fh_account` **not** saved. URL has **no** file id.
4. Session **200**, principal `client`, name TEST. `fh_account.clientId` = **null**. Not a wrong id.
5. Live `portal-login.html` still does **not** store `fh_account`. Live `login.html` does. W1 still true.
6. Page called verify + session only. It never asked entitlements. That is why there is no n/6.
7. Probe with the same token: portal-summary **200** (`ok`, `prequal_amount`, `prequal_display`, `soft_pull_complete`). portal-contracts **200** (`ok`, `count`, `items`, count 1).
8. Broken hop: **front-end quit**. Not session missing. Not wrong id. Not API 401. Not API 200 empty.
9. The server handed TEST’s file id back. The magic-link page dropped it. The portal only reads URL id or `fh_account`, so it stopped.
10. Evidence: `docs/workflows/audit-keep-going-2026-08-18-evidence/k2/` (`REPORT.md`, `01-file-paint.png`, `05-portal.json`, `06-fetches.json`, `09-hop.json`). Live file untouched.

## K5 findings

**COMPLIANCE REVIEW REQUIRED** — Repair Send.

Company Brain Ask **502**. Upload **502**. Affiliate money dashes / “not connected.” Education has no player. Repair Send still **VIEW is not defined**.

Evidence: `docs/workflows/audit-keep-going-2026-08-18-evidence/k5/REPORT.md`
