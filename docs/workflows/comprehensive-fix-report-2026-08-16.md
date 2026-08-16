# Comprehensive fix report — 2026-08-16

**For:** Chris  
**Live site:** https://fundhub.ai  
**Prove client:** `9af65808-a619-4e65-ae91-239766a006b7` (Chris ProveFunding)  
**Purpose:** Everything that is NOT wired, NOT on main, NOT deployed, or NOT testable — before the full company click-through test.

**COMPLIANCE REVIEW REQUIRED** on anything touching: dispute letters, credit pulls, fee timing, payment rails, consent, SMS, income display on sales screens.

---

## 0. STOP — read this first (merge + deploy)

| Item | Status | What it means |
|------|--------|---------------|
| Local `main` vs `origin/main` | **2 commits ahead, not pushed** | Affiliate/WL website apply + “test means human click” rule exist only on your laptop until push + deploy |
| Uncommitted CRM work on disk | **~101 modified files + 49 untracked** | CRM-honest fixes, staff invite/suspend, CRS, contracts send, closer UI, ops/affiliate cleanup — **NOT on live site yet** |
| Live Playwright | **26/26 pass, 31/31 required = 100** | Script gate green against **today’s deployed** site — not the uncommitted batch |
| Full company human test | **BLOCKED until merge + deploy** | You cannot honestly test “whole CRM” on live until the dirty tree ships |

**Before you wake up and click:** merge/commit → push `main` → one Netlify deploy → re-run `npm run test:e2e:live` → then human walk every role.

---

## 1. Big switches still OFF (on purpose)

| Switch | Effect |
|--------|--------|
| **`INNGEST_EVENT_KEY`** | 47 background workflows defined but **do not run**. Automations page lists them; nothing fires on events. |
| **`MESSAGING_DRY_RUN` / outbox** | Bulk outbox was **paused** (`outbound_enabled=false`) so old queue does not blast. One-off sends may still queue. |
| **TransUnion bureau** | `CRS_ACTIVE_BUREAUS=EX,EQ`. TU returns E1006 on live; sandbox TU still works for letters. |
| **Twilio SMS live** | Waiting on A2P / Monday prove. Messages stay `queued`. GHL relay is **stubbed off** (owner law). |
| **Real staff mailboxes** | Logins only. Google Workspace not paid. |
| **Inquiry phone remover (Bland)** | On hold per owner. Mail letters work; phone AI remover not live. |
| **Prescreen mail drop** | Built but deliberately not mailing (FCRA gate). |

---

## 2. Who can log in on LIVE today

Probed against https://fundhub.ai (same password as E2E):

| Role | Email | Live result |
|------|-------|-------------|
| Owner | `chris@fundhub.ai` | **Works** |
| Owner test | `owner@fundhub.ai` | Works (test account; hidden from roster) |
| Admin test | `admin@fundhub.ai` | Works (test; hidden) |
| Sales manager | `sales@fundhub.ai` | **FAIL — invalid_credentials** (not seeded on prod) |
| Closer | `closer@fundhub.ai` | **FAIL — account_suspended** |
| Funding advisor | `advisor@fundhub.ai` | **FAIL — account_suspended** |
| Inquiry specialist | `inquiry@fundhub.ai` | **FAIL — account_suspended** |
| Setter | `setter@fundhub.ai` | Not re-probed this session — likely suspended |
| Affiliate | `affiliate@fundhub.ai` | **Works** |
| White-label partner | `partner@fundhub.ai` | **Works** (rate-limited if too many attempts) |
| Client portal | `client@fundhub.ai` | **FAIL — invalid_credentials** (not seeded on prod) |

**Only real staff person (owner-set):** Chris Stanbridge. Alvin/Jordan/Nina/Marcus/etc. are furniture — hidden, not deleted.

**Company test blocked for roles:** sales manager, closer, advisor, inquiry, client — until seed/unsuspend or invite.

---

## 3. CRS sandbox simulation (ran tonight)

### What WORKS

| Phase | Result |
|-------|--------|
| CRS sandbox TU (Barbara Doty) | 4 tradelines, 4 Metro2 violations |
| CRS sandbox EX (Willie Booze) | 13 tradelines, 16 violations |
| CRS sandbox EQ (John Bialoglow) | 13 tradelines, 38 violations |
| Escalation pack script | Round 1–3 + CFPB + AG PDFs for all 3 bureaus; emailed to Chris Gmail via Resend |
| CRS ingest → tradelines | 13 tradelines stored on demo client |
| Sales pipeline | new_lead → survey_complete → booked **moved** |
| Repair pipeline (`optimization`) | intake → … → program_complete **all moved** |
| Funding pipeline | apply_now → round_submitted → approved **moved** |
| Funding round row | Round 1 created (status `started`) |
| Live CRS pull (prove client) | Pull OK; new `crs_result_id` stored |
| Card-stacking prove script | apply → approved → funded path runs; commission/closeout events fire |

### What FAILED in gauntlet (18/21 pass)

| Failure | Cause | Fix |
|---------|-------|-----|
| Inquiry case create | Script called `createCase` with wrong shape — needs `{ orgId, row: { client_id, … } }` | Fix prove script; product API likely OK |
| Application insert | Status `'approved'` invalid — DB only allows `'Apply','Applied','Approved','Denied','Missing Docs','Action Required'` (case-sensitive) | Use `'Approved'` not `'approved'` |
| Contract draft | `template_key` NOT NULL on `contracts` | Pass `template_key` from template row when drafting |
| Funded stage | Not reached because application step failed | Fix application status + re-run |
| GHL link on new client | `upsert_http_401` — GHL key bad | Fix GHL key or accept stub placeholder |
| Tags/tasks after pipeline | Empty — may need Inngest or handler registration for side effects | Expected while `INNGEST_EVENT_KEY` off |

Evidence: `docs/workflows/e2e-verify-run4-evidence/gauntlet/comprehensive-sandbox-run.json`

---

## 4. Messaging & email (honest)

| Path | Status |
|------|--------|
| Resend (Present deck, escalation pack, some CRM sends) | **Works** when API key + from set |
| Mailgun | **Dead** — subscription canceled on `mg.fundhub.ai` |
| GHL SMS relay | **Stubbed off** — do not use |
| Twilio | Keys incomplete / 401; `TWILIO_SEND_FROM` missing |
| `sendTemplated` | Can return `sent: true` when row is **queued**, not delivered |
| Most templates | `compliance_passed=false` — blocked from dispatch |
| Message dispatcher sweeper | **Defined, not scheduled** — nothing auto-drains queue |
| SMS to client phone | **Not proven** — Chris did not receive text in live-send window |

---

## 5. Credentials missing (blocks features)

From `docs/STILL-MISSING.md` — full table. Highlights:

- Oxylabs — Apply door 503  
- GHL contacts-scoped key — 403 on contact create  
- Commas webhook secret + checkout URL assumption unverified  
- Meta / LinkedIn — social + campaigns  
- OpenAI — Company Brain embeddings  
- Google Drive — call recording sync, Company Brain  
- Hubstaff — monitoring poll  
- Creative provider keys — Creative Factory  
- LexisNexis CRS paths — not in softview allow-list yet  

---

## 6. Screen-by-screen (40 CRM pages)

Legend: **Real** = live API bind. **Partial** = core works, gaps listed. **Fake** = sample people/dates/dollars still in HTML. **Off** = needs credential or owner switch. **BETA** = yellow badge in sidebar.

| Screen | BETA | Status | Works | Broken / missing |
|--------|------|--------|-------|------------------|
| `index.html` | | Real | Login, role pick | — |
| `pipeline.html` | | Real | Live board | Decorative week strip; clock now live |
| `closer-dashboard.html` | | Partial | Tradelines/lenders with `?client_id=` | Deal math dash; needs client id |
| `closer-call.html` | | Partial | Present, send contract, deck | Join disabled until `meeting_url` |
| `my-numbers.html` | | Partial | Session name + API rows | Empty until closer activity |
| `sales-floor.html` | | Partial | Chris-only roster (after ship) | Bianca row may linger until deploy |
| `calendar.html` | | Partial | Real dates, tasks, roster | No-show/show rate dash; Join needs URL |
| `lenders.html` | | Partial | CRUD wired | Tables empty until import |
| `finance-os.html` | BETA | Partial | Simulated client loader | Full bank link needs Plaid creds |
| `contracts.html` | | Partial | Wordings CRUD | Send moved to call cockpit |
| `subscriptions.html` | BETA | Partial | Finance sibling | Same as finance-os gaps |
| `client-control-panel.html` | | Real* | Live client bind (*after ship) | Oxylabs Apply 503; GHL link |
| `messaging.html` | | Partial | Inbox + compose | Outbound needs working SMS/email |
| `documents.html` | | Partial | Library API | Sample rows without client |
| `inquiry-remover.html` | | Partial | Case API | Empty until import; phone remover on hold |
| `company-brain.html` | BETA | Off | UI exists | Drive + OpenAI keys |
| `command-center.html` | BETA | Partial | KPIs | Cost/funded until ad sync |
| `galaxy.html` | BETA | Partial | Nav map | Sample copy possible |
| `ops-admin.html` | BETA | Partial | KPIs, DLQ | Staff pay/comp dash; affiliate summary empty |
| `agent-editor.html` | BETA | Partial | Registry | Promote/runtime needs owner |
| `automations.html` | | Off | Lists 47 workflows | Inngest off = nothing runs |
| `journeys.html` | BETA | Partial | Docs + runner | Tracks mock screens |
| `template-editor.html` | | Partial | CRUD | `[DRAFT]` blocked from send |
| `campaign-manager.html` | BETA | Off | UI | Meta Marketing token |
| `social-studio.html` | BETA | Off | OAuth wired | Meta/LinkedIn keys |
| `creative-factory.html` | BETA | Off | UI | Creative keys; demo markup |
| `content-admin.html` | BETA | Partial | Entitlements | Video upload stub |
| `staff-teams.html` | | Partial | Directory, clock-in, invite* | *invite after ship; matrix blanks |
| `hiring.html` | BETA | Partial | Pipeline | Demo interview rows |
| `products-commissions.html` | | Partial | Product ladder | Commission writes local-only |
| `sample-data.html` | BETA | Fake | Demo toggle | Not a live ops path |
| `brand-studio.html` | BETA | Partial | Partner brand + publish | Custom domain = DNS ops |
| `client-portal.html` | | Partial | Live bind with `?client_id=` | No login for `client@`; sample timeline hidden when no funding |
| `affiliate.html` | BETA | Partial | Own code, referral link | Payouts held; no funnel builder |
| `partner-galaxy.html` | | Partial | Partner nav | Sample filenames possible |
| `present.html` | | Partial | 24-screen deck, sends | COMPLIANCE flagged |
| `soft-pull-approve.html` | | Partial | Consent + CRS | Public token flow |
| `consent-capture.html` | | Partial | Built | No shell nav link (owner decision) |
| `payment-success.html` | | Partial | Thank-you | Commas webhook echo unverified |
| `sidebar.fragment.html` | | N/A | Fragment | — |

**Not in sidebar but exists:** `partner-galaxy.html` (partner login), `public/affiliates/`, `public/start.html?ref=`

---

## 7. Affiliate & white-label gaps

| Item | Status |
|------|--------|
| Website apply → real login | **Shipped in local commits**, not pushed |
| `/start?ref=CODE` | Page exists but lands **wrong ClickFunnels** theme |
| Affiliate “funnel” | Stats bar only — not a builder |
| White-label `/sites/<id>/apply` | Works after partner-site fix |
| Intended journey docs | Frozen; do not edit `-intended.md` |
| Login rate limit | Partner/affiliate login counts as failed staff attempt — 5 in 15 min locks |

---

## 8. Workflows — 50 registered, most dormant

From `workflow-migration-table.md`:

| Bucket | Count | Meaning |
|--------|-------|---------|
| MIGRATED | Most | Code exists |
| BLOCKED | 29 | Missing events, schema, or owner decision |
| DEFERRED | 9 | Draft/test/compliance withheld |
| DEAD | Several | Wrong trigger (e.g. BS-01 at booking.created) |

**Until Inngest flips:** handlers in `src/handlers/` run on direct API/event bus in tests; background timers, drips, sweepers do not run in prod.

**Not scheduled:** `message-dispatch-sweeper` — queued emails/SMS sit until manual drain or future cron.

---

## 9. Live Playwright — what it does NOT cover

100/100 required ids cover: auth, CRM shells, search, webhooks fail-closed, dashboard anon refuse, money reads, thank-you funnel, health, affiliate/WL onboard.

**NOT covered (need human clicks):**

- All 40 app screens button-by-button  
- Closer dashboard / my-numbers with real client  
- Client portal magic link path  
- Inquiry remover send/clear  
- Contract sign end-to-end  
- Chat widget on every page  
- Every role login (most fail today)  
- Commas pay → webhook → client paid  
- SMS receive on phone  
- Bland call  

---

## 10. END-TO-END verification (data layer)

Last full run (`docs/END-TO-END-VERIFICATION.md`): **29 FAIL**, 344 PASS, 34 UNVERIFIED.

Most FAILs: **missing message template keys** in seed (EMAIL-* / SMS-* not in DB).

Headline: **Not ready for real money** without template seed + provider proves.

---

## 11. Priority fix order (when you wake up)

### P0 — unblock company test

1. **Commit + push + deploy** entire CRM dirty tree (exclude tmp PDFs)  
2. **Seed or unsuspend** role test accounts: `sales@`, `client@`, unsuspend `closer@`/`advisor@`/`inquiry@` if you want those roles in the walk  
3. Re-run **live Playwright 100** after deploy  
4. **Human click** every role × every sidebar screen  

### P1 — money & mail truth

5. Resend domain DNS OR prove with onboarding from  
6. Twilio A2P + send prove to 6616180865  
7. Commas webhook capture + fix checkout if URL-query wrong  
8. Flip **`compliance_passed`** on templates you intend to send (COMPLIANCE REVIEW)  

### P2 — honest UI (next-stack unit 4)

9. closer-dashboard, my-numbers, client-portal sample blocks  
10. documents, products-commissions, galaxy/partner-galaxy leftovers  
11. LexisNexis product (separate from consumer FICO)  

### P3 — automation

12. Owner decision: flip **`INNGEST_EVENT_KEY`**  
13. Schedule message dispatcher sweeper  
14. Fix 29 BLOCKED workflows (table in repo)  

---

## 12. Git branches note

| Branch | Note |
|--------|------|
| `main` | 2 commits ahead of origin; large uncommitted CRM batch |
| `cursor/affiliate-white-label-onboarding` | Merged into local main |
| `cursor/cloud-agent-*` | Diverged; vendor underwriteiq bulk — **not** merged; do not merge blindly |

---

## 13. Simulation scripts (for agents)

| Script | Purpose |
|--------|---------|
| `scripts/tmp-sandbox-escalation-pack.mjs` | CRS sandbox → full repair letter pack → email |
| `scripts/comprehensive-sandbox-gauntlet.mjs` | Full pipeline + funding simulation |
| `scripts/prove-card-stacking-rounds.mjs` | Funding round + commission chain |
| `scripts/repull-prove-crs.mjs` | Live EX/EQ pull for prove client |
| `scripts/prove-soft-pull-live.mjs` | Pay link + approve + CRS |
| `npm run test:e2e:live` | Live 100 gate |

---

*Report started 2026-08-16. Parallel agents updating merge status + live probes — append results below.*
