# Verification re-run — 2026-08-16 (double-checked)

**When:** 2026-08-16 ~3:15 AM PT (second pass)  
**Live:** https://fundhub.ai  
**Branch:** `cursor/comprehensive-fix-report-2026-08-16` (local); **`origin/main` = `4e09dbc`**  
**Evidence:** `docs/workflows/e2e-verify-run4-evidence/`

This is the full scoreboard Chris asked for before plugging items into Grok for fix-time estimates.

---

## Executive summary

| Layer | Result | Verdict |
|-------|--------|---------|
| Lint | **1213 files clean** | PASS |
| Unit tests (`npm test`) | **5384 pass / 11 fail / 3 skip** (5398 total) | FAIL (11 known) |
| Live Playwright | **26/26 specs pass** → **31/31 required ids = 100** | PASS |
| CRS sandbox gauntlet | **22/22** | PASS |
| Card-stacking funding prove | **PASS** (funded $35k + closeout + cleanup) | PASS |
| CRS repull (prove client) | **OK** — new `crs_result_id` each run | PASS |
| Full live verify (logins + 38 shells + 16 APIs) | **6 logins fail**, **3 shells with fake names**, **1 API fail** | PARTIAL |
| Netlify deploy of `4e09dbc` | **Not confirmed live** — 3 pages still show furniture names on deployed HTML | WAITING / GAP |
| Human click every role × screen | **Not done** — blocked for 6 roles | NOT RUN |

**Bottom line:** Automated gates that can run tonight are green (Playwright 100, gauntlet 22/22, lint). Company walk is still blocked by role logins and 3 honest-UI pages. Eleven unit tests fail for documented reasons — not new regressions from merge.

---

## 1. Commands run (this session, twice where noted)

| Command | Run 1 | Run 2 | Notes |
|---------|-------|-------|-------|
| `npm run lint` | clean | **1213 clean** | |
| `npm test` | 5384/11/3 | **5384/11/3** | Stable |
| `npm run test:e2e:live` | 26/26 | **26/26** | Evidence: `live-playwright-100/last-run-rerun2.txt` |
| `node scripts/comprehensive-sandbox-gauntlet.mjs` | 22/22 | **22/22** | Gauntlet fixes local, not on origin yet |
| `node scripts/prove-card-stacking-rounds.mjs` | — | **PASS** | Needs `loadEnv()` wrapper |
| `node scripts/repull-prove-crs.mjs` | OK | **OK** | Prove client `9af65808-a619-4e65-ae91-239766a006b7` |
| `node scripts/tmp-full-live-verify.mjs` | written | **re-run** | Output: `full-live-verify-rerun.json` |

---

## 2. Unit test failures (all 11 — exact)

| # | Test | Root cause (verified) |
|---|------|------------------------|
| 1 | `docs/diagrams is in sync with the code` | Stale `docs/diagrams/*.md` — run `npm run diagrams` |
| 2 | `homepage-survey.js` ground-truth titles | Missing title **"Set Your Target Amount"** |
| 3–4 | `inline sidebars match shell.js` | **`payment-success.html`** and **`soft-pull-approve.html`** have no `<aside class="side">` (public pages, intentional?) |
| 5–7 | Journey runner coverage (2196, 2197, 2200) | Registry has **51** workflows, tests expect **50** — `messageDispatchSweeper` added to `src/workflows/index.mjs` |
| 8 | `fence: nothing reaches network except outbound-fetch` | **`src/climate/connectors.mjs`**, **`c-06-crs-results-router.mjs`**, **`ds-02-diy-letters.mjs`** fetch outside fence |
| 9 | `MESSAGING_DRY_RUN` → subtest **"the SMS path is fenced too"** | SMS dispatch not returning `dry_run` when fence up |
| 10 | `routing` → **"sms routes to the GHL relay"** | Expected `sent`, got different outcome (GHL stubbed off) |
| 11 | `pinned fixtures` → **FIXTURE 2** underwrite | `null negatives became 0` — assertion drift |

**Not introduced by merge:** diagram drift, workflow count, sidebar sync, messaging/GHL, underwrite fixture.

---

## 3. Live Playwright 100

- **Score:** 100/100 (31/31 required ids)
- **Specs executed:** 26/26 pass (~48s)
- **Targets:** `https://fundhub.ai`, `https://apply.fundhub.ai`
- **Evidence:** `docs/workflows/e2e-verify-run4-evidence/live-playwright-100/last-run-rerun2.txt`

Covers: staff auth (chris/owner/admin), CRM shells, search/filters, webhooks fail-closed, dashboard anon refuse, money reads, thank-you funnel, health, affiliate + white-label onboard.

**Does NOT cover:** per-button walk of 40 screens, suspended roles, client portal magic link, inquiry send, contract sign E2E, Commas pay webhook, SMS on phone, Bland call.

---

## 4. Live login matrix (re-probed)

Password: same as E2E (from `.env`, not printed).

| Role | Email | HTTP | Result |
|------|-------|------|--------|
| Owner | chris@fundhub.ai | 200 | **OK** — staff/owner |
| Owner test | owner@fundhub.ai | 200 | **OK** — staff/owner |
| Admin test | admin@fundhub.ai | 200 | **OK** — staff/admin |
| Sales manager | sales@fundhub.ai | 401 | **FAIL** — `invalid_credentials` (not on prod) |
| Closer | closer@fundhub.ai | 403 | **FAIL** — `account_suspended` |
| Funding advisor | advisor@fundhub.ai | 403 | **FAIL** — `account_suspended` |
| Inquiry | inquiry@fundhub.ai | 403 | **FAIL** — `account_suspended` |
| Setter | setter@fundhub.ai | 403 | **FAIL** — `account_suspended` |
| Affiliate | affiliate@fundhub.ai | 200 | **OK** |
| White-label partner | partner@fundhub.ai | 200 | **OK** |
| Client portal | client@fundhub.ai | 401 | **FAIL** — `invalid_credentials` (not on prod) |

**Rate-limit note ([Live probes all roles](1866286a-453e-4313-90d7-42d58455813a)):** A fast burst of login POSTs can return **429 `too_many_attempts`** for affiliate/partner even when the password is correct. Playwright `aff:own_login` and `wl:partner_login` both passed (~7 min run). Space probes out or reuse one session token.

**Company test blocked for:** sales manager, closer, advisor, inquiry, setter, client — until seed/unsuspend/invite.

---

## 5. Live API probe (owner session)

16 endpoints hit; **15 OK**, **1 FAIL**.

| Endpoint | Status | Notes |
|----------|--------|-------|
| `/api/read/messages?limit=3` | **400 expected** | Probe shape was wrong. Handler requires `conversation_id` (uuid). Fixed in `scripts/tmp-full-live-verify.mjs` — resolve thread then `?conversation_id=…&limit=3`. |
| `/api/dashboard/client?id=9af65808…` | 200 | Prove client "Chris" |
| `/api/read/tradelines?client_id=9af65808…` | 200 | 45 tradelines |
| `/api/read/search?q=prove` | 200 | |
| `/api/read/my-numbers` | 200 | |
| `/api/read/partners` | 200 | 6 items |
| `/api/read/affiliates` | 200 | 6 items |
| `/api/read/commissions` | 200 | |
| `/api/tasks?limit=5` | 200 | |
| (others) | 200 | pipeline, staff, products, payment-links, chat — all OK |

Full list in `full-live-verify-rerun.json`.

**Owner smoke ([Live probes all roles](1866286a-453e-4313-90d7-42d58455813a)) — also confirmed:**

| Probe | Result |
|-------|--------|
| `POST /api/chat/ask` | 200, answer returned |
| `GET /api/read/inquiry-cases` | 200, 0 cases |
| `GET /api/dashboard/pipeline` | 200 |
| Shells: pipeline, client-control-panel, inquiry-remover, affiliates/, partner-galaxy, client-portal | all 200 |

---

## 6. Live HTML shell scan (38 pages)

**35 clean** — no Jordan Blake / Marcus Webb / Nina Torres / Carlos Bettencourt / Meredith Yao in raw HTML.

**3 still have furniture names** (same on live AND in repo `main` source):

| Page | Fake name found | Where in source |
|------|-----------------|-----------------|
| `calendar.html` | Jordan Blake | Double-booked briefing copy line 470 |
| `template-editor.html` | Marcus Webb | Preview JSON defaults lines 395–398 |
| `hiring.html` | Jordan Blake | Demo referral source line 981 |

These are **real gaps** — honest-fix merge did not scrub these three. Not a deploy lag artifact (bytes match live vs repo).

---

## 7. CRS / sandbox simulation (re-verified)

| Script | Result |
|--------|--------|
| `comprehensive-sandbox-gauntlet.mjs` | **22/22** — CRS TU/EX/EQ sandbox, repair case, inquiry ops, funding app, funded, contract draft |
| `prove-card-stacking-rounds.mjs` | **PASS** — apply → approved → funded $35,000 → round.closeout 10% fee → cleanup |
| `repull-prove-crs.mjs` | **OK** — live EX/EQ pull for prove client |
| `tmp-sandbox-escalation-pack.mjs` (earlier) | **17 PDFs**, email **sent** to owner inbox |

Gauntlet bug fixes (local, uncommitted on branch):
- `createCase` shape
- Application status `'Approved'` not `'approved'`
- Contract INSERT includes `template_key`, `kind`, `created_by`

---

## 8. Big switches still OFF (unchanged)

| Switch | Effect |
|--------|--------|
| `INNGEST_EVENT_KEY` | 47–51 workflows dormant |
| `MESSAGING_DRY_RUN` / outbox | Bulk outbox paused; SMS path fence test failing |
| TransUnion live | `CRS_ACTIVE_BUREAUS=EX,EQ` only |
| Twilio SMS | A2P pending; messages stay queued |
| GHL relay | Stubbed off — breaks SMS routing unit test |
| Bland phone remover | On hold |
| Prescreen mail | Built, not dropping |

---

## 9. Credentials still missing

See `docs/STILL-MISSING.md`. Headline: Oxylabs, GHL contacts scope, Commas webhook/checkout, Meta/LinkedIn, OpenAI/Drive, Hubstaff, Twilio send-from, LexisNexis paths, `INNGEST_EVENT_KEY` (owner gate).

---

## 10. Uncommitted local work (this branch)

| Path | What |
|------|------|
| `scripts/comprehensive-sandbox-gauntlet.mjs` | 22/22 fixes |
| `scripts/prove-card-stacking-rounds.mjs` | FK cleanup order |
| `scripts/tmp-full-live-verify.mjs` | New live probe script |
| `docs/workflows/comprehensive-fix-report-2026-08-16.md` | Report updates |
| `docs/workflows/screen-audit-2026-08-16.md` | 40-screen audit |
| `docs/workflows/e2e-verify-run4-evidence/*` | Rerun evidence |

**Not on `origin/main` yet** — push when Chris says.

---

## 11. Fix inventory for Grok (grouped by priority)

Use this list for time estimates. Counts are discrete work items.

### P0 — Unblock company human test (6 items)

1. Seed or invite `sales@fundhub.ai` on prod
2. Seed `client@fundhub.ai` on prod (or document magic-link-only path)
3. Unsuspend closer / advisor / inquiry / setter (or re-invite)
4. Scrub 3 HTML pages: calendar, template-editor, hiring
5. ~~Fix or document `/api/read/messages` probe (400 invalid_parameter)~~ **done** — probe fixed; handler correct
6. Commit + push gauntlet fixes; one Netlify deploy; optional Playwright regression (26 specs — **not** the 40-screen audit; that was agent browser clicks)

### P1 — Money & mail truth (~8 items)

7. Resend domain DNS OR prove from onboarding address
8. Twilio A2P + send prove
9. Commas webhook + checkout URL fix
10. GHL Private Integration with Contacts read/write
11. Flip `compliance_passed` on templates to send (COMPLIANCE REVIEW)
12. Fix SMS dry-run fence + GHL routing test (or accept stub)
13. Schedule message dispatch sweeper
14. Seed missing EMAIL-* / SMS-* template keys (29 E2E FAILs in END-TO-END-VERIFICATION)

### P2 — Honest UI + unit hygiene (~11 items)

15. Update journey tests for 51 workflows (not 50)
16. Run `npm run diagrams` + commit
17. homepage-survey.js title fix
18. Sidebar sync: payment-success + soft-pull-approve (exclude or add aside)
19. Outbound-fetch fence: climate connectors + 2 legacy workflow fetchers
20. Underwrite FIXTURE 2 pin update
21. closer-dashboard / my-numbers / client-portal sample blocks (screen audit BETA)
22. documents, products-commissions, galaxy leftovers
23. Affiliate `/start?ref=` wrong ClickFunnels landing
24. LexisNexis product path

### P3 — Automation & blocked workflows (~3+ items)

25. Owner decision: flip `INNGEST_EVENT_KEY`
26. Fix 29 BLOCKED workflows (see migration table)
27. Chris one owner pass after P0 (agent already browser-clicked 40 screens — not Playwright)

**Total discrete items listed:** 27 (some are multi-hour, some are minutes).

---

## 12. What passed — do not re-fix

- Live Playwright 100 (twice)
- CRS gauntlet 22/22 (twice)
- Card-stacking funding chain
- CRS repull for prove client
- Lint
- 5384 unit tests
- 35/38 live HTML shells clean
- Owner, admin, affiliate, partner logins
- Merge `4e09dbc` on GitHub main

---

*Generated after second verification pass. Parent report: [`comprehensive-fix-report-2026-08-16.md`](./comprehensive-fix-report-2026-08-16.md)*
