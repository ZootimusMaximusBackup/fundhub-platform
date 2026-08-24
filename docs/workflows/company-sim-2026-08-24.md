# Company sim — five clients (2026-08-24)

**Status:** play done on live pages. Fail rows named.  
**Live:** `https://fundhub.ai` · funnel `https://apply.fundhub.ai`  
**Evidence:** `docs/workflows/company-sim-2026-08-24-evidence/`  
**Door:** play and prove. Named holes only. No HighLevel. No bureau Pull.  
**Cursor:** agentic-audit guardrails rule landed at `.cursor/rules/agentic-audit-guardrails.mdc` (2026-08-24).

## Drive access (2026-08-24 update)

**Status: good to go (local).** Drive blocker cleared. Personal Google Drive OAuth wired for `stanbridgejchris@gmail.com`. FundHub Company Brain / Sales Floor “Refresh from Drive” uses `GOOGLE_DRIVE_OAUTH_TOKEN_PATH` → file-sweep `token.json`. Live probe (FundHub code path): `authMode=oauth`, **7,566 files** listed, metadata read OK (sample: Fundhub-Credit-Mastery-System), `walkDriveAndExtract` OK. Company service-account delegate (`chris@fundhub.ai`) still broken (`invalid_grant`) — personal OAuth is the active path. Netlify production not updated yet (local `.env` only).

## Fences

- Plus-tag only (`stanbridgejchris+sim24-*@gmail.com`).
- Credit host is production (`mware.crscreditapi.com`). **Pull was not clicked.**
- No real card. No bureau mail.
- Wipe only `is_demo`. Real people stayed.
- `INNGEST_EVENT_KEY` left on.
- COMPLIANCE REVIEW REQUIRED — invoices, fee timing, consent, repair letters.

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| W0 Brief + wipe + CRS gate | this session | done |
| W1 Funding | this session | done |
| W2 Repair + text-to-agent | this session | done |
| W3 Combo | this session | done |
| W4 Inquiry | this session | done |
| W5 Course | this session | done |
| W-SM Sales manager | this session | done |
| W-COO AI COO pulse | this session | done |

## W0

- Demo people: **0**. Demo Mode **off**.
- Real people: **117** (112 after wipe + these five).
- Sim docs on disk: id, bank, utility, inquiry.
- Credit host is **not** sandbox. W1–W5 ran without Pull.
- See `w0-snapshot.json`.

## Five people (do not mint a second set)

| Lane | Name | client_id | Offer | Unlock on file | Desk seen |
|------|------|-----------|-------|----------------|-----------|
| fund | Sim Funding | `9667b74a-…a03e` | Funding DFY $3,000 | funding-snapshot | control panel |
| repair | Sim Repair | `fcd71a6d-…b2783` | Repair DFY $1,000 | metro2-letter-pack | repair tab |
| combo | Sim Combo | `90ec6cee-…f893472b` | Both | both | both desks |
| inquiry | Sim Inquiry | `740bd99f-…4eedc376` | Soft-pull $32 | credit-analysis-report | specialist · IRC-1787563508032 Queued |
| course | Sim Course | `b36cf9af-…ce507f` | Funding Mastery $5,000 | funding-mastery-course | portal Unlocked |

Prove phone **+16616180865** was on Sim Funding. Taken off at 15:39 UTC after an 18-text blast. Phone is back to `+15550124101`.

## PASS (live HTML)

- All five cards on the sales board. No `demo.client` cards.
- Client portal magic-link: all five files load (fund on retry). Welcome video is there.
- Course tile **Funding Mastery** reads **UNLOCKED**. Locked tiles say talk to an advisor.
- Staff control panel opens each file. Pull was not clicked. Generate Apps clicked.
- Specialist desk shows Sim Inquiry. Repair tab shows Sim Repair / Sim Combo.
- Sales manager (`sales@`): Sales Floor, Pipeline, all five files, products page. Pulse refused (owner-only law).
- Owner Ops Admin: CEO brief and Chris brief loaded. Pulse moved (90 new clients, 5 booked, 2 deposits). Write tasks pressed once → “Review tasks already on file. LinkedIn: not_configured.” No second hire. Card says no fire / raise / bonus rule.
- Outbound text **Fundhub prove** delivered to +16616180865 (Twilio). Repair file has an inbound photo (`inbound-mms`).

## Doc Gate — Chris Stanbridge (2026-08-24)

**Client:** `0d04742a-de3e-47fc-b30f-250f986143e2`  
**Email:** `stanbridgejchris+sim-docgate@gmail.com`  
**Phone:** `+16616054248` (agent Twilio)  
**Unlock:** `funding-snapshot`  
**Evidence:** `docs/workflows/company-sim-2026-08-24-evidence/doc-gate/`

| Check | Result |
|-------|--------|
| Gmail access (`stanbridgejchris@gmail.com`) | PASS — FundHub mail listed (plus-tags + docgate) |
| V1 good ID + SSN + bank | PASS — all three `accept` (after on-file address + date + SSN rules) |
| V2 wrong Princess ID | PASS — `request_more` |
| V3 outdated bank | PASS — `request_more` |
| V4 blurry | PASS — `request_more` |
| V5 cutoff | PASS — `request_more` |
| Portal doors / client upload | PASS — live no longer forces `no-docs`; magic-link client upload 200 |
| Contracts / soft-pull consent | NONE on this file yet — nothing to sign |
| MMS agent → company | PASS — auth restored from agent transcript store into local `.env` (name only). MMS FROM `+16616054248` TO `+15613048368` delivered. Company number had empty `SmsUrl`; set to `https://fundhub.ai/api/webhooks/twilio`. Inbound message + `inbound-mms` doc on doc-gate client. Evidence: `doc-gate/mms-prove.json`. |

**Code shipped (prod deploy):** portal `no-docs` fix; GHL-DOC now injects client name/address/today into the model prompt (fixes false address / future-date / SSN / ZIP+4 nags).

## FAIL (named holes)

1. **Apply page** — `apply.fundhub.ai` opens a ClickFunnels placeholder (“SOMETHING AWESOME HERE”). Five files were not booked on that form. They already existed.
2. **Credit Pull** — skipped on purpose. Live host is not sandbox. Present says “your numbers are not on this file yet.”
3. ~~**Portal upload doors**~~ — **FIXED 2026-08-24.** Live portal no longer forces `no-docs` before entitlements. Doc-gate client sees “Send a file”; client magic-link upload proved.
4. **Inquiry upload door** — also needs a funding unlock in the page rules. Inquiry-only unlock does not open `inquiry_doc`.
5. **Present pay link** — “Send agreement + pay link” is on the close screen. Clicking it says pick downsell or upsell, because the file has no credit numbers so it is not treated as Funding DFY. No second send. Pay links from the earlier fulfill still exist.
6. **Invoice this client** — no button on control panel or Present. Success-fee invoices ($2,500) exist and were emailed from the earlier fulfill.
7. **Pulse funded count** — briefs say 0 funded files this window. Funding + combo have funded rounds of $25,000 on the file.
8. ~~**MMS from agent number**~~ — **FIXED 2026-08-24.** Auth restored locally; company Twilio `SmsUrl` was empty (that blocked inbound). MMS + inbound doc proved on doc-gate client.

## What you check

1. Phone: **Fundhub prove** on 661-618-0865.
2. Open the five files on the live board. Same names as the table.
3. Course portal: Funding Mastery says Unlocked.

## Agents restore (2026-08-24)

**FIXED:** AG-04 Setter Josh + AG-09 Inquiry Removal AI set `live` again (were retired by verify:e2e 2026-08-22). VF-LIVE + VF-SHADOW drafted. Bland readiness OK (short prompts kept). No dial. AG-06 / GHL-* untouched.

## Change manifest

- Evidence only: `w0-snapshot.json`, `plan-play.json`, `plan-retry.json`, `plan-close.json`, `plan-pay.json`, `plan-pay2.json`, `plan-play/*.png`
- Live DB unchanged this pass except the earlier Sim Funding phone / text permission
- **Drive OAuth (local, uncommitted):** `src/company-brain/auth.mjs`, `config.mjs`, `drive-client.mjs`, `sync.mjs`, `walk.mjs`, `config.test.mjs`, `.env.example`; env `GOOGLE_DRIVE_OAUTH_TOKEN_PATH` in gitignored `.env`
- **Doc Gate (2026-08-24, deployed prod):** `public/app/client-portal.html` (stop forcing `no-docs`); `src/handlers/ghl-doc.mjs` + test (inject on-file client context). Evidence under `…/doc-gate/` (`v1-v5-prove.json`, `gmail-prove.json`, `portal-upload-prove.json`, `portal-doors*.png`).
