# Full End-To-End Audit — 2026-08-27

**When:** 2026-08-27 night.  
**Gate:** run Combo lane **YES**. CRS / bureau = **SANDBOX** — sample credit only. No live $32 pull.  
**Other money:** mint invoices / pay links. **Do not charge.**  
**No extra SMS.** Agent phone only: `+16616054248`.  
**Org:** `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`  
**This pass:** walk + prove + score. **STOP. Do not fix.**

Remint board was missing when the five walk chats started. Combo lane mints the new Combo person through the live homepage (`https://fundhub.ai`) so main site → CRM can be scored. Does not delete the old five horses. Does not walk Funding / Repair / Inquiry / Course / White-label.

## Split

| Lane | Owner | Status | Person |
|---|---|---|---|
| Remint | remint chat | pending (no IDs on disk at Combo claim) | — |
| Funding | Funding chat | **done — FAIL** | Sim Fund Horse27 `89f1a12f-f824-4451-9a53-5705b55374ca` |
| Repair | this chat (Repair lane) | **done — FAIL** | Sim Repair 27 `93b6bd19-54fe-4d1c-bdda-90ddfa57a140` |
| Combo | this chat | **done — FAIL** | Sim Combo 27 `ac1ac964-e02b-468b-9cbe-7030e03dd13b` |
| Inquiry | inquiry chat | **done — FAIL** | Sim Inquiry 27 `40f063e1-27e3-4857-be1a-91640eee90e1` |
| Course / EDU | this chat (Course lane) | **done — FAIL** | Sim Course 27 `03c232cb-…` + Sim Edu 27 `55d04ebd-…` |
| White-label | this chat (White-label lane) | **done — FAIL** | Sim Wlabel E2e27 / Sim WL Book E2e27 `ed962d4b-e373-444d-8e47-8a156446d5be` |

## Combo file (this lane)

| Field | Value |
|---|---|
| Name | Sim Combo 27 |
| Email | `stanbridgejchris+sim-combo-20260827@gmail.com` |
| Phone | `+16616054248` |
| client_id | `ac1ac964-e02b-468b-9cbe-7030e03dd13b` |
| client_code | FH-000373 |
| Door | live `https://fundhub.ai` homepage. `channel_source=website:home` |
| Survey | $100k–$200k · Equipment · Grow faster · **700–749** · negatives **Yes** · Yes 2–5 years · $250k–$499k · bank statements · $5k–$25k · Combo 27 Holdings · **DOWNSELL** → `apply.fundhub.ai/thank-you` |
| Sample CRS | copied old Combo Horse, stamped `simulated`. `crs_results` `588d27b7-…`. EX **630** / EQ **636** / TU **725**. **Not a live pull.** |
| Businesses | Combo 27 One (60 mo) · Two (36) · Three (12). Austin TX. `incorporated_date` **null** |
| Cards | Sales `survey_complete` · Funding `apply_now` · Optimization `intake`. **No** Inquiry card. |
| Old horses | `f2bc2425-…` / `8a4ac427-…` / `90ec6cee-…` left in CRM. Not walked. |
| Cite | `client-intended.md` doors only. `role-closer-intended.md` doors only. `role-funding-advisor-intended.md` doors only. `role-inquiry-remover-intended.md` desk path (Repair toggle). **No talk / event list.** Live fire: system map §1 Client + Closer + Funding + §4 Repair. Sequence **UNVERIFIED**. |

## Hard stops

No live CRS. No card charge. No paper mail / PostGrid. No bureau phone. No ClickFunnels apply score. No wipe of real people. No extra SMS. No product fix.

## Combo scorecard

Walked live 2026-08-27 by Combo lane. System map `docs/workflows/system-map-2026-08-26.md`. Shots: `docs/workflows/full-e2e-audit-2026-08-27-evidence/combo/shots/`.

| Path | Result | Evidence |
|---|---|---|
| Main site survey → file born | **PASS** | Live homepage has “Any negatives?”. 700–749 + Yes → thank-you (downsell). `entry.captured` + `survey.submitted`. New id `ac1ac964-…`. |
| Kanban Sales from main site | **PASS** | R-01 Sales · Survey Complete. Name / phone / plus-tag match. Shot `10-pipeline-sales.png`. |
| Kanban Funding after MOVE | **PASS** | R-02 Apply Now. Name + 700–749 + `+16616054248`. Sales card **also** stayed Survey Complete. Shot `30-funding-rail-after-move.png`. |
| Kanban Inquiry | **PASS** (correct empty) | R-05 search: no Combo 27 card. Did not fake an inquiry file. |
| Fulfillment list | **PASS** (name) | Name on Fulfillment after search. |
| CCP | **PASS** (name + scores) / **FAIL** (honesty) | `?id=` shows Sim Combo 27 · EX 630 / EQ 636 / TU 725. Next job **Apply for Funding**. Status still **New Lead**. Blocker **No written permission** while scores already sit on the page. `?client=` does not open the file. Shot `14-ccp.png`. |
| Present | **PASS** (`?contact=` / `?client_id=`) / **FAIL** (`?id=` + money + incorp) | Right URL: name + Combo 27 One. S-07: scores 630 / 725 / 636. Client slide: “projects to **—**”. Staff rail: **$369,600**. No incorporation ask (3 companies, ages 60/36/12, dates empty). `?id=` says needs `?contact=`. Shots `15-present.png` · `31-present-contact.png` · `34-present-s07.png`. |
| Closer Dashboard | **PASS** | `?id=` shows Sim Combo 27. Shot `16-closer.png`. |
| Welcome email | **PASS** | Gmail anywhere: “You're in — here's what happens next” 27 Aug 2026 07:35 UTC. DB `EMAIL-S00-WELCOME` **delivered**. |
| Welcome SMS | **PASS** | `SMS-S00-WELCOME` to `+16616054248` **delivered**. Twilio `SMd97bad23…`. |
| Extra SMS | **PASS** | Only welcome + `SMS-ROUND-STARTED-NOTIFY` after MOVE (still **queued**, not Twilio-accepted yet). Enroll queued **email** only. Pay links were **create**, not send. No blast. |
| Book | **FAIL** | Thank-you downsell. 0 bookings. ClickFunnels book not walked (owner-ok). |
| Josh / AI call | **FAIL** | No book → no Josh. Did not spray Bland. |
| Mint $32 + $3,000 + $200 | **PASS** (mint) | Links created unpaid: diagnostic 3200 · deposit 300000 · repair 20000. Did not charge. Did not send (no extra text). |
| Sample CRS + businesses | **PASS** (scores) / **FAIL** (engine) | CCP + Present scores match planted file. UnderwriteIQ `fundable=false` and **$369,600** combined. Suggestion says LLC seasoned and also “no LLC data.” |
| Soft-pull consent form | **FAIL** | Consent none on file. Approve form not filled (needs incorporation month/year; planted dates are empty). |
| Docs upload | **FAIL** | 0 `documents` rows. Documents search: Nothing matches. Shot `32-documents-filter.png`. |
| AI doc follow-up | **FAIL** | No upload → no chase. GHL-DOC retired. |
| Apply | **FAIL** | Lenders page has Apply. Chrome add-on off. Did not submit a bank app. Shot `33-lenders-scoped.png`. |
| Advisor next action | **FAIL** | Next job **Apply for Funding** (true). Main status still **New Lead**. Apply not finished. |
| Repair enroll | **PASS** (row) / **FAIL** (events) | Trial active · $200 unpaid · Optimization **intake**. Specialist Repair shows the name. Events table has **no** `repair.enrolled`. Shot `17-specialist-repair.png`. |
| Repair generate / letters | **FAIL** | `POST /api/repair/generate` → `no_authorization` / “No signed repair agreement.” 0 letters. Desk still says `authorization_ok: true`. Did not Send. Paper **not-live**. |
| Repair welcome email | **FAIL** (not out) | `EMAIL-REPAIR-WELCOME` still **queued**. Not in Gmail. |
| Specialist Inquiry | **PASS** (correct empty) | Name not on Inquiries queue. Shot `18-specialist-inquiry.png`. |
| Portal | **PASS** (name) | `/app/client-portal.html?id=` shows Sim Combo 27. Shot `26-portal.png`. |
| Messaging / Calendar / Sales floor / Finance / Consent / Ops | **FAIL** / expected miss | Opened from main site → CRM. No client filter: name not on those pages. Calendar empty (no book). |
| Meet / `said:` | **FAIL** | `/api/read/agent-context` has no `said:`. No Meet tape. |
| Intended talk / event order | **UNVERIFIED** | Intended files are doors (Specialist is a desk path). Live fire skipped book → S-04 → Josh. MOVE jumped to Apply Now. |

**Combo overall: FAIL.**

## Combo notes

- Live homepage **does** ask “Any negatives?” (repo JS on disk still does not). 700–749 + Yes went to thank-you. That is the real Combo door.
- MOVE put them on Funding Apply Now while Sales stayed Survey Complete. Same split-card as Funding.
- Present only opens with `?contact=` or `?client_id=`. CCP `?id=` works. CCP `?client=` does not.
- Staff Present rail quotes **$369,600**. Client slide and after-fix are a dash. Engine also says not fundable.
- Hard stops kept: no live CRS · no card charge · no paper · no CF apply walk · no extra SMS · no product fix · did not ask Chris.
- Evidence: `docs/workflows/full-e2e-audit-2026-08-27-evidence/combo/` (`homepage.json` · `crm-walk.json` · `followup.json` · `present-s07.json`). Do not commit the planted tradeline dump.

---

## Course / EDU lane — claimed 2026-08-27

**Owner:** this chat (Course lane). **Status:** claimed.  
Cite: `docs/journeys/client-intended.md` — doors only. No talk order. Sequence **UNVERIFIED**.  
Cite: `docs/journeys/white-label-intended.md` — doors + marketing notes.  
Live fire: system map §1 Client (Course offer = Funding Mastery $5,000) + education enroll door + R-08 board check for WL people.

| Person | Name | Email | Phone | Door |
|---|---|---|---|---|
| Course sim | Sim Course 27 | `stanbridgejchris+sim-course-20260827@gmail.com` | `+16616054248` | `https://fundhub.ai` homepage survey (Not sure score → downsell / course) |
| EDU extra | Sim Edu 27 | `stanbridgejchris+sim-edu-20260827@gmail.com` | `+16616054248` | `https://fundhub.ai/education/enroll/?program=credit-mastery` |
| WL check | (white-label lane mints) | — | — | Confirm cards on Affiliates + White Label (R-08) + Partner Galaxy |

Hard stops: no live CRS · no charge · no paper · no extra SMS · no product fix.

## Funding file (this lane)

| Field | Value |
|---|---|
| Name | Sim Fund Horse27 |
| Email | `stanbridgejchris+sim-fund-20260827@gmail.com` |
| Phone | `+16616054248` |
| client_id | `89f1a12f-f824-4451-9a53-5705b55374ca` |
| Survey | 750+ · negatives No · Yes 2–5 years · Fund Horse Holdings 27 · **PASS** → `funding-book-call` (ClickFunnels apply not walked) |
| Sample CRS | copied from old Fund Horse — EX 718 / EQ 724 / TU 731 on CCP. **Not a live pull.** |
| Businesses | Fund Horse Holdings 27, Logistics 27, Retail 27 |
| Old horse | `614927f7-…` tagged `retired-2026-08-27`, last name `Fund Horse RETIRED`. Not hard-deleted (related rows). |
| Cite | `client-intended.md` doors only. `role-funding-advisor-intended.md` doors only. `role-closer-intended.md` doors only. Live fire: system map §1 Client + Funding advisor. Sequence **UNVERIFIED**. |

## Funding scorecard

Walked live 2026-08-27 by Funding lane. System map `docs/workflows/system-map-2026-08-26.md`. Shots: `docs/workflows/full-e2e-audit-2026-08-27-evidence/funding/shots/`.

| Step | Result | Evidence |
|---|---|---|
| Main site survey → file born | **PASS** | Live homepage has “Any negatives?”. File `89f1a12f-…` from `website:home`. 750+ / No / has business. `entry.captured` + `survey.submitted`. PASS → book-a-call (CF book not walked). |
| Kanban Sales from main site | **PASS** | Pipeline Sales search: Sim Fund Horse27 visible. Survey Complete. Shot `10-pipeline-sales.png`. |
| Kanban Funding after MOVE | **PASS** | R-02 Apply Now. Card still also on Sales. Shot `11-pipeline-funding.png`. |
| Fulfillment list | **FAIL** | File on list. Next button **Apply for Funding**. Tags: no written permission · **Cannot start funding — CRS incomplete** while scores sit on CCP. Shot `12-pipeline-fulfillment.png`. |
| Closer Dashboard | **PASS** | `?client_id=` shows Sim Fund Horse27. Shot `13-closer-dashboard.png`. |
| Present | **PASS** (desk) / **FAIL** (incorp) | Present opened. Name + Fund Horse Holdings 27. Soft-pull + $3,000 pay + invoice buttons clicked. Slides 1–12 have **no** incorporation ask (3 companies, ages 24/48/79). Shots `14-present.png` · `31-present-soft.png` · `33-present-close.png`. |
| Welcome email | **PASS** | Gmail anywhere: “You're in — here's what happens next”. DB `delivered`. |
| Welcome SMS | **PASS** | `SMS-S00-WELCOME` to `+16616054248`. Twilio `SM84971b0f…` accepted. |
| Soft-pull + Funding offers | **PASS** (mint) | Gmail: “Your $32 soft-pull assessment” + “Funding, done-for-you — $3,000”. SMS accepted `SMd82b0f…` + `SM5babf4…`. Pay links sent $32 + $3,000. **Not paid.** Invoice draft $3,000, not sent. No contract row. |
| Extra SMS | **PASS** | Welcome + round-started (MOVE) + soft-pull + funding DFY. Upload did **not** fire a chase text. No blast. |
| Book | **FAIL** | 0 `bookings`. Calendar empty. ClickFunnels book not walked (owner-ok). |
| Josh / AI call | **FAIL** | AG-04 live prompt **3750** letters. `POST /api/agent-call` placed `aefd5da8-6adc-4429-9dd9-57f12b53f07a` to `+16616054248`. Bland **no-answer** · **call_length 0** · empty tape. Desk-load / 0s is FAIL. |
| Sample CRS + businesses | **PASS** (scores on CCP) / **FAIL** (honesty + engine) | CCP EX 718 / EQ 724 / TU 731. 3 businesses. Hold still **Awaiting CRS / CRS incomplete**. Live UnderwriteIQ `fundable=false` and **$0** combined. Prequal tile **—**. |
| Docs upload | **PASS** | Staff CCP upload. `documents` row `3f65f4fe-…` kind `client_upload`. Event `docs.received`. Shot `19-ccp-upload.png`. |
| AI doc follow-up | **FAIL** | No DOC-02/03 after upload. GHL-DOC retired. |
| Apply | **FAIL** | Generate Apps: 21 fit. Apply clicked (`data-fh-apply`). Chrome add-on off. Stayed on CCP. Bank page did not open. Shot `40-apply-clicked.png`. |
| Advisor next action | **FAIL** | Next job **Apply for Funding**. Saved record **Pull CRS**. Main status still **New Lead** while Round 1 started. |
| Messaging board | **FAIL** | Search did not show the card. 7 messages exist on the file. Shot `21-messaging.png`. |
| Calendar | **FAIL** | No booking → no card. Shot `22-calendar.png`. |
| Documents board | **PASS** | Name on Documents after upload. Shot `20-documents.png`. |
| Sales floor | **PASS** | Name visible. Shot `24-sales-floor.png`. |
| Meet / `said:` | **FAIL** | No real Meet tape. No `said:` pack. |
| Intended talk / event order | **UNVERIFIED** | Intended files are doors only. Live fire skipped book → S-04 → Josh auto (MOVE jumped to Apply Now). |

**Funding overall: FAIL.**

### Funding notes

- Live homepage **does** ask “Any negatives?” (repo JS on disk still does not). This file answered No and PASSed.
- MOVE put them on Funding Apply Now while Sales stayed Survey Complete. Same split-card as 2026-08-26.
- CCP `?id=` opens the file.
- Hard stops kept: no live CRS · no card charge · no paper · no CF apply walk · no product fix · did not ask Chris.
- Evidence JSON: `docs/workflows/full-e2e-audit-2026-08-27-evidence/funding/`.

## Course / EDU scorecard — done 2026-08-27

**Owner:** this chat (Course lane). **Overall: FAIL.** Stop. Do not fix.

**Cite:** `docs/journeys/client-intended.md` — doors only. **No talk order. No SMS order.** Sequence **UNVERIFIED**.  
**Cite:** `docs/journeys/white-label-intended.md` — doors + marketing notes.  
**Map:** `docs/workflows/system-map-2026-08-26.md` §1 Client (Course offer = Funding Mastery $5,000) + education enroll door.  
Live fire walked: homepage survey → thank-you (downsell) → Sales card → CCP / Present / Closer → mint $5,000 (no charge). Extra EDU person through `/education/enroll/`. WL board check only (WL lane minted).

### Course / EDU people

| Person | Name | client_id | Email | Phone stored | Door |
|---|---|---|---|---|---|
| Course sim | Sim Course 27 | `03c232cb-a459-44ef-8924-d408d5392841` | `stanbridgejchris+sim-course-20260827@gmail.com` | `6616054248` (no +1) | `https://fundhub.ai` homepage. Score **Not sure** + negatives **Yes** → thank-you |
| EDU extra | Sim Edu 27 | `55d04ebd-ac31-4150-a814-bea76935b5f9` | `stanbridgejchris+sim-edu-20260827@gmail.com` | `6616054248` (no +1) | `https://fundhub.ai/education/enroll/?program=credit-mastery` enroll `f97fb0ca-…` status `pending_payment` |
| WL check | Sim Wlabel E2e27 / Sim WL Book E2e27 | partner `ed962d4b-…` | `stanbridgejchris+sim-wl-e2e27-wlchat@gmail.com` | — | Confirm boards only. **Second new WL person tonight: none.** |

### Course Horse

| Path | Result | Evidence |
|---|---|---|
| Main site survey → file born | **PASS** | Live clicks on `#apply`. `entry.captured` + `survey.submitted`. Redirect `apply.fundhub.ai/thank-you`. Shot `03-course-after-submit.png`. |
| Sales board card | **PASS** | R-01 Sales · **survey_complete**. Name on the board. Shot `pipe-R-01-sales.png`. |
| CCP / Present / Closer name match | **PASS** | CCP `?id=` shows Sim Course 27. Present slide 1 + S-19 **Funding Mastery $5,000**. Closer has the name. CCP `?client=` does not open the file. |
| Welcome email | **PASS** | Gmail anywhere: “You're in — here's what happens next” 27 Aug 2026 07:35 UTC. DB `EMAIL-S00-WELCOME` **delivered**. |
| Welcome SMS to +16616054248 | **FAIL** | `SMS-S00-WELCOME` **failed**. Stored phone `6616054248`. Twilio: destination is not an E.164 number. |
| Extra SMS | **PASS** | Only welcome + pay-link SMS attempted. Both failed. No blast. |
| Sample CRS + businesses | **FAIL** | `crs_results` **0**. `businesses` **0**. Present: “Your numbers are not on this file yet.” Did not click Pull (`CRS_ALLOW_LIVE` is on). |
| Next action | **FAIL** | CCP next job **Get Consent**. Honest for no written permission. No sample credit, so dash empty. |
| Mint Funding Mastery $5,000 | **PASS** (mint) | Present clicked **Send agreement + pay link**. Link `fc9a541a-…` **$5,000** status `sent` · `paid_at` empty. Did not charge. |
| Pay-link email | **PASS** | Gmail anywhere: “Funding Mastery course (A to Z) — $5,000” 07:38 UTC. |
| Pay-link SMS | **FAIL** | Same E.164 reject to `6616054248`. |
| Education / learn / portal tile | **FAIL** / **UNVERIFIED** | `/education/` and `/education/learn/` do not show this person. Portal magic link not minted (would be a new send). Unpaid, so unlock should stay locked. |
| Intended talk / event order | **UNVERIFIED** | Intended file is doors only. Overall cannot be PASS. |

### EDU main-site person

| Path | Result | Evidence |
|---|---|---|
| Education enroll form | **PASS** | Live `/education/` → Credit Mastery enroll. HTTP 200. Screen: We have your request. Not charged. Row `f97fb0ca-…` `pending_payment`. Shot `06-edu-enroll-result.png`. |
| Client file exists | **PASS** | `channel_source=website:education-enroll`. CCP `?id=` shows Sim Edu 27. Present / Closer show the name. |
| Sales board card | **FAIL** | R-01 search **no card**. Enroll does not fire `entry.captured` (by code). |
| Education desk / learn card | **FAIL** | No staff page lists `education_enrollments`. `/education/learn/` does not show Sim Edu 27. |
| Welcome email / SMS | **not-live** | Enroll sends nothing. 0 events. Gmail welcome for this plus-tag: **0**. |
| Mint $5,000 | **PASS** (mint) | Present pay click. Link `aa5abf7c-…` **$5,000** unpaid. Gmail has the $5,000 mail. SMS failed E.164. Did not charge. |

### White-label boards (confirm only)

| Path | Result | Evidence |
|---|---|---|
| Two new WL main-site people | **FAIL** | Tonight only **one** new partner: Sim Wlabel E2e27 / Sim WL Book E2e27 `ed962d4b-…`. No second 2026-08-27 WL row. |
| Pipeline R-08 named card | **FAIL** | Rail open. All stages **0**. Footer: nobody has been placed here. Same as WL lane. Shot `pipe-R-08-again.png`. |
| Partner Galaxy named card | **FAIL** | Staff Galaxy census says 13 partners. Name **Sim WL Book E2e27** is not on the sky. Shot `partner-galaxy-2.png`. |
| Affiliate desk | **FAIL** | `/app/affiliate.html` is the owner affiliate home. No WL name. `/app/affiliates.html` and `/app/partner-home.html` are 404. |

**Course / EDU overall: FAIL.**

What worked: homepage Course file + Sales card + welcome email + both $5,000 links minted unpaid + Gmail has those mails + EDU enroll row saved.

What broke: texts die because the homepage/education forms store `6616054248` without `+1`. EDU person never lands on a board. Education has no staff card list. R-08 still empty for the one new WL person. Second WL person was never born. No sample credit / businesses (sandbox; did not live-pull). Intended files have no event list.

Shots + logs: `docs/workflows/full-e2e-audit-2026-08-27-evidence/course/`

Hard stops kept: no live CRS · no card charge · no paper · no extra SMS · no product fix · did not ask Chris.

---

## Inquiry file (this lane)

| Field | Value |
|---|---|
| Name | Sim Inquiry 27 |
| Email | `stanbridgejchris+sim-inquiry-20260827@gmail.com` |
| Phone | `+16616054248` |
| client_id | `40f063e1-27e3-4857-be1a-91640eee90e1` |
| Door | live `https://fundhub.ai` homepage survey (clicked). `channel_source=website:home`. 750+ · negatives **No** · Yes 2–5 years · Inquiry 27 Holdings |
| Sample CRS | `buildSimulatedCrsPayload` planted (EX 718 / EQ 724 / TU 731 · 7 inquiries). **Not a live pull.** `crs_results` `a3e39f1e-…` |
| Case | `392f8fcd-…` Queued · 0 items · `request_source=client_control_panel` |
| Cite | `docs/journeys/role-inquiry-remover-intended.md` — desk path (toggle → queue → Send). Phone inquiry on hold. **No talk order.** Talk **UNVERIFIED**. Map: `docs/workflows/system-map-2026-08-26.md` §1 Specialist inquiry. |

## Inquiry scorecard

| Path | Result | Evidence |
|---|---|---|
| Main site → file born | **PASS** | Live homepage clicks. `entry.captured` + `survey.submitted` 07:33:33Z. Name / plus-tag / `+16616054248` match. |
| Kanban Sales | **PASS** | R-01 Sales · **Survey Complete**. Shot `05-board-sales.png` + `20-rail-sales.png`. |
| Kanban Inquiry Removal | **FAIL** | Case exists. R-05 columns all **0**. Card table: **sales only**. Shot `20-rail-inquiry_removal.png`. |
| Other rails (Fund / Repair / AR / WL / Hiring) | **PASS** (correct empty) | Clicked each tab. Inquiry 27 not on those boards. R-03 tab missing on live. |
| CCP name / scores | **PASS** (name) / **FAIL** (status + next job) | Name + 718/724/731 match. Status **New Lead** while card is Survey Complete. Next job **No step applies** while file says Collect inquiry identity packet. Shot `06-ccp.png`. |
| Issue Inquiry Removal | **PASS** (case opened) | Clicked. Landed Specialist. Case Queued. Shot `07-after-issue-ir.png`. |
| Specialist desk | **FAIL** | File on Inquiries queue. Ready for Review · **0 items** · docs **complete**. Sample CRS has **7** inquiries; `inquiry_log` empty. Shot `09-specialist.png`. |
| FTC upload | **PASS** (staff) | Sim pack `ftc-report.pdf` attached. Documents page shows it on Sim Inquiry 27. Shot `11-specialist-detail.png` · `13-documents.png`. |
| Generate letters | **FAIL** | Button hits `/api/repair/generate`. Screen: **no signed repair agreement**. Draft empty. 0 letters. Did not Send. |
| Send / Call bureau | **not-live** / not clicked | Send = paper. Call bureau = bureau phone. Both visible. Did not press. |
| Portal | **FAIL** | Magic link signed in as Sim Inquiry 27. Footer: **0 unlocked · 6 locked**. Inquiry upload door hidden. “Your call is next” with **0 bookings**. Shot `14-portal.png`. |
| Welcome email | **PASS** | Gmail anywhere: “You're in — here's what happens next” 07:35Z. DB `EMAIL-S00-WELCOME` delivered. |
| Welcome SMS | **PASS** | `SMS-S00-WELCOME` to `+16616054248` **delivered**. |
| Doc chase | **PASS** (intended) | After FTC, `EMAIL-DOC-01-REQUEST` + `SMS-DOC-01-REQUEST` delivered. Packet still missing id / address / authorization. |
| Extra SMS | **PASS** | Only welcome + DOC-01. No blast. |
| Closer with file open | **PASS** (read) | `?client_id=` shows Sim Inquiry 27 · Survey Complete · 7 inquiries · 718/724/731. Shot `21-closer-with-id.png`. |
| AG-09 / talk | **UNVERIFIED** | Intended has no talk script. Did not Bland. Did not dial a bureau. Live AG-09 is still the 169-letter stub. |
| Intended event order | **UNVERIFIED** | Intended file is a desk path, not a talk/event list. |

**Inquiry overall: FAIL.**

### Inquiry notes

- Remint chat never wrote IDs. This lane minted **one** new person through the live homepage. Did not delete the old five.
- Live homepage **does** ask negatives (local copy was behind). Answered **No**.
- Book-a-call landing was not photographed (wait matched the homepage host). File is Survey Complete. Did not book (would start a new text chain).
- Generate on the inquiry case writes **repair** letters. Inquiry case stayed at 0 items.
- Hard stops kept: no live CRS · no card charge · no paper · no bureau phone · no extra SMS · no product fix · did not ask Chris.

Shots: `docs/workflows/full-e2e-audit-2026-08-27-evidence/shots/`.
JSON: `inquiry-boards.json`.

---

## White-label lane — done 2026-08-27

**Owner:** this chat (White-label). **Status:** done. **Overall: FAIL.**  
**Do not fix.** Sandbox. Not the Course thread. Not a database insert.

**Cite:** `docs/journeys/white-label-intended.md` — doors + marketing notes. **No event list. No talk order.** Sequence **UNVERIFIED**. System map: overall cannot be PASS.  
**Editor tree:** create company → Brand Studio → invite team.  
**Live fire walked:** live `https://fundhub.ai/affiliates/` → Track **White-Label Partner** → `POST /api/public/partner-apply` → partner login → Partner Home → Brand Studio → public site → staff Pipeline R-08 + search + Galaxy + Brand Studio + Creative / Social / Campaign pickers.  
**Map:** `docs/workflows/system-map-2026-08-26.md`. No voice agent on this path.

### White-label file (this lane)

| Field | Value |
|---|---|
| Name | Sim Wlabel E2e27 |
| Company | Sim WL Book E2e27 |
| Email | `stanbridgejchris+sim-wl-e2e27-wlchat@gmail.com` |
| Phone | `+16616054248` |
| partner_id | `ed962d4b-e373-444d-8e47-8a156446d5be` |
| account_id | `4db9a52c-73f8-408b-8a49-63d595977965` |
| Door | `https://fundhub.ai/affiliates/` track `white_label` at 07:29:02Z |
| Site | `https://fundhub.ai/sites/ed962d4b-e373-444d-8e47-8a156446d5be/apply` |
| Status | partners.status=`active` · agreement_signed_at **null** |
| Client row | **none** |
| Pipeline card | **none** (R-08 entire rail = 0 cards) |
| Events / messages | **0** for this person |

### White-label scorecard

| Path | Result | Evidence |
|---|---|---|
| Affiliates form → White-Label Partner | **PASS** | Live form. HTTP 200. kind=partner. Screen said YOU'RE IN. Login + first password shown. Site URL shown. Shot `03-affiliates-success-MARKED.png`. |
| Partner login | **PASS** | Same password. Landed `/app/partner-galaxy.html`. Role `partner`. |
| Public partner site | **PASS** | `/sites/ed962d4b-…/apply` shows **Sim WL Book E2e27**. Shot `07-public-site-MARKED.png`. |
| Partner Brand Studio | **PASS** | Partner can open Brand Studio. Name on screen. Apply funnel published. |
| Staff Brand Studio for this partner | **PASS** | `?partner_id=` shows brand name + published apply page. Domain **not connected**. Marketing suite **OFF**. Shot `19-brand-studio-staff-partner.png`. |
| Creative / Social / Campaign pickers | **PASS** | Staff dropdowns include **Sim WL Book E2e27**. `/api/read/partners` hit=true. |
| Pipeline R-08 card | **FAIL** | Rail open. Recruiting / Invited / Agreement Signed / Active / Paused all **0**. Footer: nobody has been placed here. DB: 0 cards on `affiliates_white_label`. Shot `09-pipeline-r08-MARKED.png`. |
| CRM search | **FAIL** | Search for name and company: 0 clients, 0 cards, 0 contracts, 0 documents. Search does not look at partners. |
| Partner Home census | **FAIL** | Signed in as Sim Wlabel E2e27. Header: **No partners on file**. Own `v_partner_balance` row exists. Shot `05-partner-galaxy-MARKED.png`. |
| Staff Galaxy | **FAIL** | Staff Galaxy is workers, not this partner. Name not on the page. |
| Affiliate desk / Closer / CCP | **FAIL** | No client file. Those boards cannot carry this person. |
| Gmail anywhere | **FAIL** | Prove Gmail query 0 hits for this plus-tag / name. Screen said we cannot email them yet. Invite / follow-up mail did not send. |
| SMS to +16616054248 for this file | **FAIL** | 0 `messages` rows. SMS box was checked. No partner text. Two Twilio rows at 07:30Z say “Hey Sim… quick call” — those are **other-lane welcome texts**, not this partner. |
| Custom domain | **not-live** | Brand Studio: Domain — not connected. |
| Partner drips / events | **not-live** | 0 events. Apply does not fire `entry.captured`. |
| Review before live (page copy) | **FAIL** | Page says a person reviews first. Code set status=`active` and handed a login at once. No agreement stamp. |
| Intended talk / event order | **UNVERIFIED** | Intended file is doors only. |

**White-label overall: FAIL.**

Form → login → site works. The CRM board Chris named (Pipeline) never gets a card. Search cannot find them. Partner Home lies. No mail. No partner text.

Shots: `docs/workflows/full-e2e-audit-2026-08-27-evidence/white-label/shots/` (marked under `shots/marked/`).

Hard stops kept: no live CRS · no card charge · no paper · no extra SMS from this lane · no product fix · did not ask Chris.

---

## Repair file (this lane)

| Field | Value |
|---|---|
| Name | Sim Repair 27 |
| Email | `stanbridgejchris+sim-repair-20260827@gmail.com` |
| Phone | `+16616054248` |
| client_id | `93b6bd19-54fe-4d1c-bdda-90ddfa57a140` |
| Survey | 580–649 · negatives **Yes** · Yes 1–2 years · Repair 27 Holdings · **DOWNSELL** → thank-you |
| Sample CRS | vendor sandbox EX 630 / EQ 636 (TU none). **Not a live pull.** Stamped `simulated`. |
| Program | trial · cap 2 · $200 unpaid · stage **intake** |
| Old horse | `5ce80871-…` left in CRM. Not deleted. |
| Cite | `role-inquiry-remover-intended.md` — desk path (toggle → queue → Send). **No talk order.** `client-intended.md` — doors only. Live fire: system map §4 Repair events. Sequence **UNVERIFIED**. |

## Repair scorecard

| Path | Result | Evidence |
|---|---|---|
| Main site survey → file born | **PASS** | Live homepage `https://fundhub.ai` (now has “Any negatives?”). File `93b6bd19-…`. `entry.captured` + `survey.submitted`. Card on **R-01 Sales / Survey Complete**. Phone + plus-tag match. Kanban title said **Sim S2 Repair 27**. Shot `board-pipeline-sales.png`. |
| Welcome email | **PASS** | Gmail anywhere: “You're in — here's what happens next” 07:35Z. DB `EMAIL-S00-WELCOME` delivered. |
| Welcome SMS | **PASS** | `SMS-S00-WELCOME` to `+16616054248` status `delivered`. Twilio accepted. |
| Mint $200 trial (no pay) | **PASS** | `payment_links` purpose=repair · 20000 cents · status `sent` · `paid_at` null. Gmail “Repair test run (first round, done for you) — $200”. Twilio accepted the $200 text. |
| Sample CRS on screen | **PASS** | CCP scores **EX 630 / EQ 636 / TU —**. Matches planted file. Shot `board-ccp.png`. |
| Next action honesty | **FAIL** | CCP next job **No step applies** while trial is active, $200 unpaid, stage intake, 0 letters. Main status still **New Lead**. |
| Letters / generate | **FAIL** | `POST /api/repair/generate` twice → `no_authorization`. `dispute_letters` **0**. Live `dispute_authorization` row exists (staff checkbox, valid). Did not press Send. Paper **not-live**. |
| `repair.*` events | **FAIL** | Enroll wrote `repair_programs` + queued `EMAIL-REPAIR-WELCOME`. Events table has **no** `repair.enrolled` / docs / letters events. Only entry, survey, message.queued, docs.received. |
| Portal | **PASS** | `/app/client-portal.html?id=` says **Welcome back, Sim** / Sim Repair 27. |
| Repair upload | **PASS** | Sim PDF `bureau_response` stored. `docs.received` fired. Documents page HIT. |
| Specialist Repair desk | **PASS** (queue) / **FAIL** (finish) | Repair tab lists **Sim Repair 27** trial · intake · round —/2. Cannot Send (no letters). Shot `board-specialist-repair.png`. |
| Fulfillment lens | **PASS** (name) / **FAIL** (job) | Name on Fulfillment. Staff cannot finish Send Letters. |
| Present | **FAIL** | `present.html?client=` says open from a contact, needs `?contact=`. Name not on that page. |
| Closer Dashboard | **FAIL** | Name not on the closer board (DOWNSELL thank-you, no book). |
| Messaging / Calendar / Finance OS | **FAIL** / expected miss | Messaging UI did not show the name (rows exist in DB). Calendar empty (no book). Finance OS has no card. |
| Extra SMS (this file) | **PASS** | This file’s `messages`: welcome + $200 pay-link only. Repair welcome email still **queued**. Shared agent phone also shows other-lane $32 / $3,000 texts — not this client_id. |
| Intended talk / event order | **UNVERIFIED** | Specialist intended is a desk path, no talk script. Client intended is doors only. |

**Repair overall: FAIL.**

Person comes in from the homepage and lands on Sales. Mail and the $200 link work. Sample scores show. Letters will not write. Next action lies. Repair events do not land on the event list.

Shots: `docs/workflows/full-e2e-audit-2026-08-27-evidence/repair/shots/`  
Verdict: `docs/workflows/full-e2e-audit-2026-08-27-evidence/repair/VERDICT-continue.json`

Hard stops kept: no live CRS · no card charge · no paper / Send · no bureau phone · no extra SMS from this lane · no product fix · did not ask Chris.
