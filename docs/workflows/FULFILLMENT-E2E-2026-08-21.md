# Fulfillment E2E — overnight live run (2026-08-21)

**Chris reads this in the morning.** Findings + evidence only. No fixes. No deploys.

**Fixer note (nav, 2026-08-21):** Nav is not a W-row. A PR is open that hides Agent Editor and Content from the menu, drops the Marketing header, moves Client Control Panel under Funding (after Lenders), and strips BETA tags. URLs still work. Proof: `docs/workflows/fulfillment-e2e-2026-08-21-evidence/fixer/`. No W-row flipped for this.

**Fixer note (B1 ghost booking, 2026-08-21):** Overnight looked like a ghost because the check stopped too soon, and one probe used a bad column name. A new plus-tag book on `apply.fundhub.ai` landed a client, a booking, and the booked text (`SMS-BS01-01-BOOKED`) inside two minutes. The calendar form webhook now also fires `booking.created` with the email, so Fundhub does not have to wait on the later appointment ping. Proof: `docs/workflows/fulfillment-e2e-2026-08-21-evidence/fixer/b1-ghost-booking.json` and `fixer/shots/b1-thankyou-1440-MARKED.png`. `SMS-S04-01-CONFIRM` still did not queue.

**Fixer note (B3 Present pay link, 2026-08-21):** Overnight the S-23 button never called the server. The page stopped the click when the sale pick was empty. The click now always asks the server to send the pay link. A plus-tag click on Present made a payment_links row with a checkout link. Proof: `docs/workflows/fulfillment-e2e-2026-08-21-evidence/fixer/b3-pay-link.json` and `fixer/shots/b3-s23-1440-MARKED.png`.

**Fixer note (B2 deposit save, 2026-08-21):** Live production was already on the money-chain fix (`f8ff02bc`). One plus-tag `deposit.paid` (no card) wrote `sale_payments` with a real product id, then granted `funding-snapshot`. No closer was on that probe, so the commission book stayed empty. Proof: `docs/workflows/fulfillment-e2e-2026-08-21-evidence/fixer/b2-deposit-save.json`. Never touched the forbidden file.

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

**No.** Staff still cannot create a file on Pipeline. There is only one company in the database. The dispute wheel never turns. Invoices and AR are not a staff click path. The funnel book-a-call path **does** write a client now if you wait two minutes. A plus-tag deposit **does** save with a product id.

---

## The 5 things that will waste Chris's time tomorrow

1. **The thank-you page looked like a ghost overnight.** Re-run with a plus-tag and a two-minute wait: Fundhub did write the client, the booking, and the booked text. The calendar form webhook is also mapped so that write happens on the first booking ping. (Staff still cannot create a client on Pipeline — that is W1-01 / B5.)
2. **Staff cannot create a client on the dashboard.** Pipeline has Filter / MOVE / DEL. No New Client. Intake is the funnel. The funnel now lands if you wait.
3. **Deposit now saves.** One live plus-tag `deposit.paid` wrote a payment row with a product id and unlocked `funding-snapshot`. Commission still needs a closer on the sale (W2-04).
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
| W1-01b | Funnel booking fallback | **PASS** | `fixer/shots/b1-thankyou-1440-MARKED.png` · UI: “You’re All Set. Your Call Is Booked.” Plus-tag book. Not a dashboard create. | |
| W1-01c | CRM row for that plus-tagged email | **PASS** | `fixer/b1-ghost-booking.json` · client `0bf376a7-…`, `booking.created` with email + start time, bookings row, `SMS-BS01-01-BOOKED` queued. Overnight probe used a missing column and stopped before the webhook. | Calendar form `form_submission` with a start time now emits `booking.created` (`src/adapters/clickfunnels.mjs`). A later appointment ping for the same slot does not create a second booking. |
| KW-00 | Keep walking on Gauntlet `a7a383e0` | **QUESTION** | `client.json` · plus-tagged, not the forbidden file | |
| W1-02a | next_action before consent | **QUESTION** | API: `get_consent` / “Get Consent” on Gauntlet. Not a brand-new file. `shots/w1k-ccp-1440-MARKED.png` | |
| W1-02 | Authorization recorded | **PASS** *(adversary recode)* | Continue walk first said FAIL (bad SQL column `method`). DB row **is** there: `client_consents` `abdf617f-…` kind `soft_pull_consent` at 04:33:44Z. UI: “Consent recorded.” `dumps/adversary.json` · `shots/w1k-consent-1440-MARKED.png` | |
| W1-03 | Credit pulled | **FAIL** | Pull button was enabled. Click produced **no** `/api/finance/crs-pull` network hit. `crs_results` still 0. `shots/w1k-pull-1440-MARKED.png` | `public/app/client-control-panel.html:585` + `api/finance/crs-pull.mjs`. Identity gate still applies. **Fix:** capture legal name / DOB / address / SSN on CCP, then make Pull actually POST and write `crs_results`. |
| W1-04 | Underwrite paints real numbers | **FAIL** | Present: “YOUR NUMBERS ARE NOT ON THIS FILE YET.” No score-like digits on CCP. | Needs a `crs_results` row first. Then CCP/`api/dashboard/client.mjs` must paint those scores. |
| W1-05 | next_action after consent/pull | **QUESTION** | Before: `get_consent`. After consent row: follow-up GET returned `next_action: null`. Could be a paint bug or a missing fulfillment flag. Not guessing PASS. `dumps/followup-na.json` | |
| W2-01 | Pay link from Present | **PASS** | `fixer/shots/b3-s23-1440-MARKED.png` · plus-tag Present S-23. Click **Send agreement + pay link** POSTed `/api/closer-deck` `send_pay_link` (200). `fixer/b3-pay-link.json`. |
| W2-02 | payment_links row | **PASS** | `fixer/b3-pay-link.json` · plus-tag client `4b659a62-…`, payment_links `3e13a7f4-…` status sent, checkout link present. |
| W2-03 | Payment row saves (BLK-008) | **PASS** | `fixer/b2-deposit-save.json` · plus-tag client `4b659a62-…`, sale_payments `3078b6e5-…` kind deposit amount 3000 with product_id matching the sale (`c087bdd2-…` card-stacking-dfy). No new product_id NOT NULL. Production was already on `f8ff02bc`. | |
| W2-04 | Commission row | **FAIL** | Payment saved. Ledger still 0 for this probe — no closer was named on the event, so nobody was owed a cut. 9 commission rules are active. | Name a closer on `deposit.paid` if a ledger row is required. |
| W2-05 | Entitlement granted | **PASS** | `fixer/b2-deposit-save.json` · entitlements row `5fd327f3-…` code `funding-snapshot` for the same plus-tag client. | |
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
| W6-templates | Why templates stay silent | **QUESTION** | All **237** templates have `compliance_passed=true`. B1 plus-tag book queued `SMS-BS01-01-BOOKED`. `SMS-S04-01-CONFIRM` still silent. Contract/receipt/AR still not this booking. `fixer/b1-ghost-booking.json` | AR templates cannot fire because AR workflows do not exist. |
| W6 money-spine | Booking confirm, contract, receipt, invoice, AR | **FAIL** | Booked SMS (`SMS-BS01-01-BOOKED`) queued for the B1 plus-tag. `SMS-S04-01-CONFIRM` still silent. Receipt/invoice/AR never ran. Contract send still needs S-23. | |

---

## Money-spine templates (can they send?)

`compliance_passed` is **true** for the ones that matter. They are not blocked by that flag.

| Template | Flag | Tonight |
|---|---|---|
| `SMS-S04-01-CONFIRM` | passed | Still silent after B1 `booking.created` |
| `SMS-BS01-01-BOOKED` | passed | Queued for B1 plus-tag (`fixer/b1-ghost-booking.json`) |
| `EMAIL-PORTAL-MAGIC-LINK` | passed | Not requested for the missing new client |
| `CONTRACT-SEND-EMAIL` | passed | Pay link from S-23 now reaches the API. Contract send is a different button and was not this prove. |
| `INVOICE-SENT-EMAIL` | passed | No dashboard invoice |
| `AR-PP1` … `AR-PP6` | passed | No AR workflow to send them |
| Receipt templates | — | No saved payment |

---

## Adversary notes (attacks on this report)

- W1-02 was first marked FAIL because the SQL asked for column `method`. The row exists. Recoded **PASS**.
- W3-d was first marked PASS because a file stored. It is a generic upload, not attached to a case. Recoded **QUESTION**.
- W3-c check is Setter Josh, not a bureau. Recoded **QUESTION**.
- W5-10/11 empty mismatch with one org is not isolation. Recoded **QUESTION**.
- W2-02 first SQL used `url`; real column is `checkout_url`. Overnight had 0 rows. B3 plus-tag click wrote a row with a checkout link. Now PASS.
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
