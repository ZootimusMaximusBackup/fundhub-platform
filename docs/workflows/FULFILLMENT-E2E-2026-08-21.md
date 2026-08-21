# Fulfillment E2E — overnight live run (2026-08-21)

**Chris reads this in the morning.** Findings + evidence only. No fixes. No deploys.

**Fixer note (nav, 2026-08-21):** Nav is not a W-row. A PR is open that hides Agent Editor and Content from the menu, drops the Marketing header, moves Client Control Panel under Funding (after Lenders), and strips BETA tags. URLs still work. Proof: `docs/workflows/fulfillment-e2e-2026-08-21-evidence/fixer/`. No W-row flipped for this.

**Live:** `https://fundhub.ai` · funnel `https://apply.fundhub.ai`  
**Evidence:** `docs/workflows/fulfillment-e2e-2026-08-21-evidence/`  
**Forbidden file:** `9af65808-…` — never opened, never written  
**Test mail:** plus-tags only. Bare inbox not used.  
**Did not:** real bureau mail, real Bland dial, real card charge  
**Ambiguous steps:** **QUESTION**, never a guessed PASS  
**Adversary pass:** ran on this report’s own rows before this file was written

**Model:** this overnight run used the current Cursor Grok 4.6 session.

---

## Can this system take a real customer A to Z today?

**No.** The public site can say a call is booked while Fundhub never gets a file. Money still dies on `sale_payments.product_id`. There is only one company in the database. The dispute wheel never turns. Invoices and AR are not a staff click path.

---

## The 5 things that will waste Chris's time tomorrow

1. **The thank-you page is a ghost.** `apply.fundhub.ai` said “You’re All Set. Your Call Is Booked.” Fundhub wrote **zero** clients, **zero** events, **zero** messages for that email. A human would think they started. They did not.
2. **Staff cannot create a client on the dashboard.** Pipeline has Filter / MOVE / DEL. No New Client. Intake is supposed to be the funnel — and the funnel did not land.
3. **Deposit still does not save.** Last live `deposit.paid` at **01:08 UTC** (about 6:08pm PT, hours before this run) still failed: `null value in column "product_id" of relation "sale_payments"`. Commissions and unlocks never start. (BLK-008.)
4. **There is only one org** (`fundhub`). Staff-teams can add a person to *this* company. Nothing on the dashboard makes a second agency. Cross-company isolation was not testable. Empty “no mismatched invoices” is not a wall.
5. **AR / invoice / bureau repair are not a click path.** No “Invoice this client.” AR-01..04 are not built. Repair send refuses unless it would really mail. AG-04 is Setter Josh, not a bureau agent, and no screen starts the call.

---

## How this was walked

- Logged in as `chris@fundhub.ai` (password from gitignored `.env`, never printed).
- Screenshots at **1440** and **390**, then marked. Raw copies in `shots/_raw/`.
- After intake failed to write a row, the rest of the night used existing plus-tagged file **Gauntlet** `a7a383e0-…` so later walks were not skipped. That is **not** a new customer. Marked QUESTION where that matters.
- Adversary recodes are in the table (W1-02, W3-d, W3-c, W5-10/11).

---

## Step table

| ID | Step | Result | Evidence | If FAIL: file+line · one-sentence fix |
|---|---|---|---|---|
| W1-00 | Staff sign-in | **PASS** | `shots/w1-00-login-1440-MARKED.png` · landed on pipeline | |
| W1-01 | Create client on the dashboard | **FAIL** | `shots/w1-01-pipeline-1440-MARKED.png` · also CCP, sales floor, closer dashboard, ops admin. No Add/New/Create client. | `public/app/pipeline.html` (board only). Clients are inserted in `src/handlers/client-lifecycle.mjs:207` from funnel events. **Fix:** add a dashboard New Client form, *or* stop asking staff to create files here. |
| W1-01b | Funnel booking fallback | **QUESTION** | `shots/w1-01b-funnel-1440-MARKED.png` · UI: “CONFIRMED · You’re All Set.” Not a dashboard create. | |
| W1-01c | CRM row for that plus-tagged email | **FAIL** | `dumps/orphan-booking-probe.json` · 0 new clients, 0 events, 0 bookings, 0 messages in 20 minutes | Booking page is ClickFunnels/Cronofy (`src/adapters/calcom.mjs:14-28`). Fundhub only learns from a ClickFunnels webhook. **Fix:** make that webhook emit `booking.created` with email so `resolveClient` inserts a row. Until then the thank-you page is a lie. |
| KW-00 | Keep walking on Gauntlet `a7a383e0` | **QUESTION** | `client.json` · plus-tagged, not the forbidden file | |
| W1-02a | next_action before consent | **QUESTION** | API: `get_consent` / “Get Consent” on Gauntlet. Not a brand-new file. `shots/w1k-ccp-1440-MARKED.png` | |
| W1-02 | Authorization recorded | **PASS** *(adversary recode)* | Continue walk first said FAIL (bad SQL column `method`). DB row **is** there: `client_consents` `abdf617f-…` kind `soft_pull_consent` at 04:33:44Z. UI: “Consent recorded.” `dumps/adversary.json` · `shots/w1k-consent-1440-MARKED.png` | |
| W1-03 | Credit pulled | **FAIL** | Pull button was enabled. Click produced **no** `/api/finance/crs-pull` network hit. `crs_results` still 0. `shots/w1k-pull-1440-MARKED.png` | `public/app/client-control-panel.html:585` + `api/finance/crs-pull.mjs`. Identity gate still applies. **Fix:** capture legal name / DOB / address / SSN on CCP, then make Pull actually POST and write `crs_results`. |
| W1-04 | Underwrite paints real numbers | **FAIL** | Present: “YOUR NUMBERS ARE NOT ON THIS FILE YET.” No score-like digits on CCP. | Needs a `crs_results` row first. Then CCP/`api/dashboard/client.mjs` must paint those scores. |
| W1-05 | next_action after consent/pull | **QUESTION** | Before: `get_consent`. After consent row: follow-up GET returned `next_action: null`. Could be a paint bug or a missing fulfillment flag. Not guessing PASS. `dumps/followup-na.json` | |
| W2-01 | Pay link from Present | **FAIL** | Reached **S-23**. Clicked **Send agreement + pay link**. **Zero** `/api/closer-deck` or `/api/payment-links` calls. `shots/w2-s23-1440-MARKED.png` · `dumps/w2-s23.json` | `public/app/present.js:590` / `:860` → `api/closer-deck.mjs:93`. **Fix:** that button must POST `send_pay_link` and return a checkout URL. |
| W2-02 | payment_links row | **FAIL** | 0 rows for Gauntlet (`checkout_url` column exists; first query used a missing `url` column — adversary fixed that; still 0 rows) | Same as W2-01. |
| W2-03 | Payment row saves (BLK-008) | **FAIL** | No `sale_payments` for Gauntlet. Last live errors still `deposit.paid` **product_id NOT NULL** at 01:08:34Z (`failed_events` `d02af3ac-…`). Source on main lists `product_id` in the insert (`src/handlers/money-chain.mjs:418`) with a JS skip if missing (`:401`). Production still threw NOT NULL after that commit (15:50 PT). | **Fix:** deploy the insert that actually binds `sale.product_id`, then prove one live `deposit.paid` writes a row. Do not trust the source file until a new emit succeeds. |
| W2-04 | Commission row | **FAIL** | 0 ledger rows for this file | `src/handlers/money-chain.mjs:634` runs after payment save. **Fix:** save the payment first. |
| W2-05 | Entitlement granted | **FAIL** | First query used a missing `product_code` column. Adversary: still not a tonight grant. | `src/handlers/money-chain.mjs:649`. **Fix:** grant after a saved payment. |
| W2-06 | Portal tile unlocks | **FAIL** | `/client-portal.html` is 404. Staff portal is `/app/client-portal.html`. Did not open the client’s magic-link session (would hit the forbidden inbox if untagged). | Use `/app/client-portal.html` with a plus-tagged magic link. Unlock still needs a successful payment. |
| W2-07 | Receipt sends | **FAIL** | No receipt template rows for this file tonight | Needs a saved payment. |
| W3-a pull inquiries | Inquiries from the pull | **FAIL** | `inquiry_log` empty for Gauntlet | `src/workflows/c-02-inquiry-created.mjs:21` waits on `analysis.completed` + `newInquiries`. **Fix:** complete a real (or simulated) pull that emits that event. |
| W3-a manual | Manual inquiry entry | **FAIL** | Specialist desk has no Add Inquiry. `api/inquiries.mjs` is attempt/confirm/status only. `shots/w3-specialist-1440-MARKED.png` | **Fix:** a dashboard control that inserts `inquiry_log`. |
| W3-b | Removal case on specialist desk | **FAIL** | `GET /api/read/repair-cases?client_id=` → 200, **0** cases | `src/inquiry-removal/cases.mjs`. **Fix:** round-done must open a case. |
| W3-c check | AG-04 dry-run `action=check` | **QUESTION** *(adversary)* | HTTP 200: “Setter Josh is ready to call Gauntlet Thirteen. Nothing has been dialled.” That is a **setter**, not a bureau agent. `api/agent-call.mjs:42-51` refuses bureau dials on purpose. | |
| W3-c trigger | Call fires from the desk | **FAIL** | Comment in `api/agent-call.mjs:42-46`: no screen calls this. | **Fix:** a specialist control, or drop bureau-call from the journey. |
| W3-c webhook | Signed Bland webhook accepted | **PASS** (store) / **QUESTION** (on the case) | POST `/api/webhooks/bland` 200, emitted `call.completed` `4337b249-…`, `webhook_captures` bland `53fd5097-…`. No inquiry case to attach to. | |
| W3-d | Mock packet upload | **QUESTION** *(adversary recode from PASS)* | Upload 200. Document `18037542-…` kind `client_upload` / subtype `other` / title “Uploaded Document”. **No case_id.** Not a dispute packet on a case. `shots/w3-upload-1440-MARKED.png` | `public/app/client-control-panel.html:1922` → `/api/documents-upload`. **Fix:** store as dispute/FTC and attach to the open case. |
| W3-e mail | `POST /api/repair/send` dry-run | **QUESTION** | `mail:false` → 400 `no_channel` “mail required — human must press send.” Did **not** send `mail:true` (that is real PostGrid). | `src/repair/send.mjs:48-50`. **Fix:** a preview that builds the payload and returns `mailed:false`. |
| W3-e address | What would mail, to where | **QUESTION** | `furnisher_mail_addresses` has **5** collector PO boxes (Midland, PRA, LVNV, …). Tonight’s send never built a bureau letter. Not proof of EX/EQ/TU destinations. | `src/metro2/rounds/store.mjs:52` `findFurnisherAddress`. |
| W3-f return | Inject `docs.received` / mail.response | **FAIL** / **QUESTION** | Staff POST `/api/events` → **404**. Upload **did** emit `docs.received` `ee4d6f7c-…` (that is the packet, not a bureau reply). No `inquiry.removed`. | **Fix:** a signed mail.response / bureau-reply webhook that updates the case. |
| W3-g | The turn (hold clears, new round) | **FAIL** | Wheel never started. | **Jam hop:** ClickFunnels thank-you → Fundhub `booking.created` never fired (W1-01c). Next jam: no pull, no `inquiry_log`, no case, no removal, next_action went **null** after consent. |
| W3 split | EX portal vs EQ/TU call+mail | **FAIL** | Not exercised. AG-04 is not bureau. Mail has no dry-run. | `api/agent-call.mjs:42-51` + `src/repair/send.mjs:48` |
| W4-a | Invoice from dashboard | **FAIL** | Ops Admin has “Email unsent invoices,” not Create invoice. `shots/w4-ops-1440-MARKED.png` | `api/read/invoices.mjs` is GET. Writes are `src/workflows/f-07-funding-locked.mjs:75`. **Fix:** an owner/finance “Invoice this client” that calls `createInvoice` and emails `INVOICE-SENT-EMAIL`. |
| W4-a row | Invoice row + email lands | **FAIL** | 0 invoices for Gauntlet | Same. |
| W4-b | Don’t-pay AR sequence | **FAIL** | No `src/workflows/ar-*.mjs`. Table says AR-01..04 BLOCKED. Templates `AR-PP1`–`AR-PP6` exist and `compliance_passed=true` — **wiring gap, not a compliance flag.** `ai:stop-contact` is only in a seed prompt (`db/migrations/114_ghl_agent_seed.sql:101`). | **Fix:** build AR-01..04 on `v_invoice_balance`, honor `ai:stop-contact`, stop on paid. |
| W4-c | Do-pay stops AR | **BLOCKED** | Nothing to stop. No invoice, no card, no AR runner. | |
| W5-00 | Two orgs in DB | **QUESTION** | **1** org: slug `fundhub` | |
| W5-01 | Create org from dashboard | **FAIL** | Staff-teams `+ ADD PERSON` only. `shots/w5-01-staff-teams-1440-MARKED.png` | `public/app/staff-teams.html:239`. White-label apply uses `api/public/partner-apply.mjs:141` `resolveDefaultOrg` — **same org**, not a new company. **Fix:** inserting a second agency must insert `orgs` and scope staff/clients to it. |
| W5-02 | Add person (same org) | **PASS** | Invite UI opened. Not a second tenant. `shots/w5-02-add-person-1440-MARKED.png` | |
| W5-03 | Two orgs with clients | **FAIL** | 1 org with clients | |
| W5-05..09 | URL / queue / invoice isolation | **BLOCKED** | Cannot steal org B’s client by URL if org B does not exist | |
| W5-10/11 | SQL org mismatches | **QUESTION** *(adversary)* | 0 mismatched entitlement/invoice org_ids. Vacuous with one org. Not a wall. | |
| W6-imap | IMAP landing | **BLOCKED** | No `IMAP_HOST` / `IMAP_USER` / `IMAP_PASS` / `GMAIL_APP_PASSWORD`. Cannot open Gmail. | |
| W6-templates | Why templates stay silent | **QUESTION** / **FAIL** | All **237** templates have `compliance_passed=true` (`dumps/w6-templates.json`). Silence is **wiring**, not the compliance flag. Tonight’s ghost booking queued **nothing**. `SMS-S04-01-CONFIRM` and `CONTRACT-SEND-EMAIL` were silent in the 3-hour window this walk cared about. `SMS-BS01-01-BOOKED` appears on **other** files, not the missing new client. | Ghost booking (W1-01c). Money-spine also blocked by W2-03. AR templates cannot fire because AR workflows do not exist. |
| W6 money-spine | Booking confirm, contract, receipt, invoice, AR | **FAIL** | Confirm email/SMS did not queue for the new booking. Receipt/invoice/AR never ran. Contract send not clicked to completion (`Send contract` lives on S-23; pay-link click did not POST). | |

---

## Money-spine templates (can they send?)

`compliance_passed` is **true** for the ones that matter. They are not blocked by that flag.

| Template | Flag | Tonight |
|---|---|---|
| `SMS-S04-01-CONFIRM` | passed | Silent — no `booking.created` |
| `SMS-BS01-01-BOOKED` | passed | Fires for files that actually book into Fundhub; **not** for tonight’s ghost booking |
| `EMAIL-PORTAL-MAGIC-LINK` | passed | Not requested for the missing new client |
| `CONTRACT-SEND-EMAIL` | passed | Present S-23 click did not reach the API |
| `INVOICE-SENT-EMAIL` | passed | No dashboard invoice |
| `AR-PP1` … `AR-PP6` | passed | No AR workflow to send them |
| Receipt templates | — | No saved payment |

---

## Adversary notes (attacks on this report)

- W1-02 was first marked FAIL because the SQL asked for column `method`. The row exists. Recoded **PASS**.
- W3-d was first marked PASS because a file stored. It is a generic upload, not attached to a case. Recoded **QUESTION**.
- W3-c check is Setter Josh, not a bureau. Recoded **QUESTION**.
- W5-10/11 empty mismatch with one org is not isolation. Recoded **QUESTION**.
- W2-02 first SQL used `url`; real column is `checkout_url`. Still 0 rows. FAIL stands.
- W1-03 network array empty: either the click missed or the page swallowed it. FAIL stands (no `crs_results`).
- Did not charge a card. BLK-008 proof is the **01:08Z failed_events**, not a new charge. That is the last live money attempt.

---

## What was not done (left undone)

- No real bureau pull, mail, or dial.
- No real card.
- No IMAP inbox proof.
- No second org, so no URL-theft test.
- Gauntlet keep-walking is not a new customer A→Z.

**Next:** pick which of the five ranked items to name for Fixer. Do not audit-and-fix in this file.
