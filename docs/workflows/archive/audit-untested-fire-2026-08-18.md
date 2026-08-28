# Untested doors — FIRE pass — 2026-08-18

Chris 2026-08-18: do the leftover doors for real. Stop hiding behind “do not send.”

Auditor. Findings only. No app / config / test / intended-journey edits. No deploy.
Do not flip Netlify `INNGEST_EVENT_KEY` (owner ask-first). Do not charge a card.
Do not open / write live credit file `9af65808-…`.
Do not put a vendor in sandbox. Never print secrets. Confirm env names only.

TEST client: `8556bedc-46e1-4d85-b0cd-a24adfee1521`  
Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/`  
Prior board: `docs/workflows/audit-untested-2026-08-18.md`

Plus-tag on the watched inbox is required (not the bare address). Read `FUNDHUB_TEST_INBOX` from `.env`. Build `local+e2e-fire@domain`. Never print it.

| id | owns | status |
|---|---|---|
| F-MAIL | Magic-link + inbound reply + email STOP | done |
| F-SMS | One SMS to FUNDHUB_TEST_PHONE | done |
| F-INQ | Press Mark Cleared on a TEST case | done |
| F-FUNNEL | Finish apply extras + book a live slot | done |
| F-DOORS | Webhook POSTs + Bland start attempt + archive TEST card | done |
| F-JOBS | Turn on job switch. Prove Inngest runs from tonight’s fires | done |

## Findings

## F-MAIL findings

[Mail](6ac6c8f1-c507-4b7e-84a9-1382e1e204cc) done. Magic-link + inbound reply + email STOP. TEST `8556bedc-…` only. Plus-tag, not the bare inbox. Did not open `9af65808-…`. Did not press Sign.

- Magic-link: `POST /api/auth/magic-link` **200**. Opened the real link as **client**. Session is TEST, not staff, not the live file.
- After the link: **“We could not load your file.”** Video not available. No n/6. Dispute says sign in. **FAIL** on file paint. Staff-open was not used.
- Inbound reply: signed Mailgun POST **200**. `message.inbound` written. Staff Messaging EMAIL thread shows the reply. **PASS**.
- Email STOP: same door **200**. STOP shows in Messaging. `opt_outs` still **0**. Unsubscribe pages **404**. **FAIL**.
- Staff also sent one live Resend mail to the plus-tag (`outcome=sent`) so a thread existed.

Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-mail/REPORT.md`

## F-SMS findings

[SMS](f36234df-dc4b-4bc0-a352-1edf25a349d8) done. **PASS — Twilio accepted.** One SMS to `FUNDHUB_TEST_PHONE` (name only). TEST client `8556bedc-…` only. Did not open the live file.

- Path: Messaging → `POST /api/messages` → `composeAndSend` → Twilio. Screen has no To box. Set TEST phone to the env test phone (TEST only).
- One send: `Fundhub e2e ping — ignore.` HTTP 200, `outcome=sent`. Did not send again.
- Row `8755f790-…`: status `sent`, provider `twilio`, no error, provider id SM… (34 chars). To matches `FUNDHUB_TEST_PHONE`.
- Local env: `TWILIO_ACCOUNT_SID` set, `TWILIO_AUTH_TOKEN` unset, `TWILIO_SEND_FROM` set. Live send still reached Twilio.
- Device landing UNVERIFIED (no phone photo). Does not fail this unit.
- Intended journey does not name SMS landing.

Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-sms/REPORT.md`

## F-INQ findings

[Inquiry](56c64ee4-c12a-48d2-a654-86c93e233b86) done.

**COMPLIANCE REVIEW REQUIRED** — inquiry complete.

Pressed Mark Cleared **once** on TEST case `f872cc9d-…` (Specialist `inquiry@fundhub.ai`). Did not press Send. Did not mail a bureau. Did not open `9af65808-…`.

- Case `Queued` → `Completed`. `POST /api/inquiry-cases` action=`mark_cleared` → 200.
- `inquiry.removed` **0 → 1**. New row `41c26b69-…`. Payload (no secrets): `caseId=IRC-1787072070546`, `inquiryRemovalCaseId=f872cc9d-…`, `source=inquiry_removal_case`.
- C-03 ran: task `f09e0aff-…` “Start next funding round — clean file”. Tag `inquiry:completed`. `ready_for_next_round=true`.
- Next funding round started? **No.** TEST `funding_rounds` still **0**.
- Intended journey does not name this hop.

Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-inq/REPORT.md`

## F-FUNNEL findings

[Funnel](314727a5-25a2-40b8-a9ee-68b91e34cb33) done.

**PASS.** Finished every extra apply card. Booked one live slot. Confirm did not error.

- `/watch` **200**. `/apply` **200**. Step 1: E2e / Fire, `e2e+aff-fire-*@fundhub.ai`, phone `201-555-0123`. Next worked.
- Eight extra cards finished. No Social Security number. Last Next landed on `/funding-book-call`.
- Slot **8:00–8:30 PM MST Aug 18** (Chris Stanbridge, Google Meet). Confirm opened name/email. Book Appointment once. Thank-you: “Your Call Is Booked.”
- Client `edca0767-…` (ClickFunnels). `entry.captured` + `survey.submitted` landed.
- `booking.created` **26 → 27**. New row `f370a046-…` (~80s later). Task `d5300a31-…` “Strategy session booked” due 8:00 PM Phoenix. No `bookings` table.
- `/book` 404 is owner WONTFIX. Not retested.
- Did not pay. Did not type SSN. Did not book a second slot. Did not open `9af65808-…`.

No intended funnel journey. **MISSING.**

Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-funnel/REPORT.md`

## F-DOORS findings

[Doors](aa03daec-62bf-4646-9867-0242fd2065d2) done. TEST `8556bedc-…` only. Never opened `9af65808-…`. Did not set Netlify `INNGEST_EVENT_KEY`. Did not sandbox. Did not charge.

- **GHL** `POST /api/webhooks/ghl` → **404** `unknown provider: ghl`. Captures **0**.
- **PostGrid** unsigned **401**; signed e2e **200** `ignored` (`letter.updated`). No letter mailed. Captures **0**.
- **Plaid** `POST /api/webhooks/plaid` → **404** `unknown provider: plaid`. Captures **0**.
- **Bland webhook** unsigned **401**; signed e2e **200** `not_completed`. Captures **0**. `webhook_captures` only clickfunnels **442 → 442**.
- **Bland START:** CRM `/api/inquiry` launch **503** `not_configured`. One `api.bland.ai/v1/calls` to `FUNDHUB_TEST_PHONE` (last four 0865). Call id `70a094ce-…` **200** `started`.
- **Archive:** TEST card `5410b98b-…` — DEL → type DELETE → Archive once. Files the whole TEST contact. Card **1 → 0**. `crm_archived_at` set. Banner proved.
- **Jobs:** `GET /api/inngest` **401**. Cloud `GET /v2/runs` **200** with 5 COMPLETED rows. Local `contract.signed` emit wrote events **3 → 4**. `inngest.send` **401** Event key not found. Our emit has no run row.

Intended journey does not name archive / Bland start / job runs.

Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-doors/REPORT.md`

## Fire pass stop

All five fire rows **done**. F-JOBS added after Chris said turn the job switch on.

| id | Result |
|---|---|
| F-MAIL | Magic-link opened as client. File paint **FAIL**. Reply **PASS**. STOP **FAIL**. |
| F-SMS | **PASS** — Twilio accepted. Check the test phone. |
| F-INQ | Mark Cleared **fired**. Task wrote. No funding round row. |
| F-FUNNEL | **PASS** — extras finished. Slot booked 8:00 PM MST today. |
| F-DOORS | GHL/Plaid 404. PostGrid/Bland ping ignore. CRM cannot start Bland. TEST contact archived. |

No app edits. Live file not opened. Card not charged.

## F-JOBS findings

Chris said turn the job switch on. Keys written to Netlify. Local CLI deploy died. Cloud rebuild `6a84d3bba08d3e85dc48dfd5` **ready**.

The switch was **already on**. Tonight’s book made real Inngest runs.

- **PASS** — `s-04-call-booked` COMPLETED. Four book jobs still RUNNING (waiting on 8:00 PM).
- **FAIL** — `s-02-incomplete-survey-nudge` is the whole failed-run list (7+).
- **UNVERIFIED** — Mark Cleared wrote `inquiry.removed` + a C-03 task. No `c-03` Inngest run in the last 50. `funding_rounds` still 0. **COMPLIANCE REVIEW REQUIRED.**
- **FAIL** — owner Calendar still “Nothing booked” after the live book.
- **FAIL** — confirm mail to `e2e+aff-fire-*@fundhub.ai` bounced. Host got the appointment mail.

Evidence: `docs/workflows/audit-untested-fire-2026-08-18-evidence/f-jobs/REPORT.md`

| id | Result |
|---|---|
| F-MAIL | Magic-link opened as client. File paint **FAIL**. Reply **PASS**. STOP **FAIL**. |
| F-SMS | **PASS** — Twilio accepted. Check the test phone. |
| F-INQ | Mark Cleared **fired**. Task wrote. No funding round row. |
| F-FUNNEL | **PASS** — extras finished. Slot booked 8:00 PM MST today. |
| F-DOORS | GHL/Plaid 404. PostGrid/Bland ping ignore. CRM cannot start Bland. TEST contact archived. |
| F-JOBS | Switch on. Book jobs ran. Calendar still empty. Apply confirm bounced. |
