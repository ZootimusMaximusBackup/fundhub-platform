# Inquiry Removal AI

AI-powered outbound calling system for FundHub. Three distinct systems in one Vercel deployment:

1. **AI Setter "Josh"** — outbound Bland AI voice agent that calls leads after they book a Strategy Session
2. **Bureau Dispute Agents** — Bland AI agents that call Experian, TransUnion, and Equifax to dispute inquiries and fraudulent accounts
3. **Mailgun Bank Inbox** — inbound email pipeline that classifies bank funding emails and routes events to Airtable + GHL

**Deployed:** `inquiry-removal-ai-sigma.vercel.app`

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Hosting | Vercel (serverless functions) |
| Voice AI | Bland AI (outbound calls) |
| CRM | GoHighLevel (contacts, workflows, notes) |
| Database | Airtable (FUNDHUB MATRIX base) |
| Inbound Email | Mailgun (catch-all → `/api/mailgun-inbound`) |
| Scheduling | Vercel Cron (M-F, every 15 min, 9am-6pm ET) |

---

## API Endpoints

### Bureau Dispute Calls

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/launch-call` | Bearer | Launch a bureau dispute call directly (with full clientData payload) |
| `POST` | `/api/schedule-call` | Bearer | Receive AX23 webhook, fetch PII from Airtable, schedule or launch immediately |
| `GET/POST` | `/api/dispatch-scheduled` | Bearer (`CRON_SECRET`) | Cron job — dispatches all Scheduled cases whose time has passed |
| `POST` | `/api/call-webhook` | Bland signature | Bland AI callback on call completion — updates Airtable + GHL |
| `GET` | `/api/call-status?call_id=xxx` | Bearer | Check Bland AI call status by ID |
| `POST` | `/api/test-call` | `x-api-secret` | Launch a test call using the hardcoded Airtable test client |

### AI Setter (Josh)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/trigger-setter-call` | Bearer | GHL workflow fires this after appointment booking + analyzer gate; grades the lead and launches Bland call |
| `POST` | `/api/setter-launch` | Bearer | Manual setter call launch (no grading) |
| `POST` | `/api/setter-webhook` | Bland signature | Bland AI callback — classifies outcome, updates GHL, triggers cadence or handoff |
| `POST` | `/api/setter-slots` | Bearer | Bland custom tool — fetches GHL calendar availability mid-call |
| `POST` | `/api/setter-book` | Bearer | Bland custom tool — books GHL appointment mid-call |

### Mailgun

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/mailgun-inbound` | Query `?secret=` | Receives forwarded bank emails, classifies them, writes to Airtable BANK_INBOX, fires GHL F-11 |

---

## System 1: Bureau Dispute Calls

### Flow

```
Airtable AX23 automation
  → POST /api/schedule-call
    → fetch CLIENTS → PII_IDENTITY from Airtable
    → isBusinessHours()?
        YES → launch Bland call immediately (case_status = "Calling")
        NO  → mark case_status = "Scheduled", set ai_call_scheduled_for
              → Vercel Cron picks it up via /api/dispatch-scheduled
  → Bland AI places call to bureau
  → Call completes
  → POST /api/call-webhook (Bland fires this)
    → determine outcome
    → update INQUIRY_REMOVAL_CASES (case_status, ai_call_status, remover_notes)
    → update GHL contact (custom fields + activity note)
    → async: post-call analysis via Bland analyze API
```

### Agents

| Agent | File | Bureau Number | Version |
|---|---|---|---|
| Experian | `src/agents/experian-prompt.js` | `+18554146048` | v6 |
| TransUnion | `src/agents/transunion-prompt.js` | `+18009168800` | v2 |
| Equifax | `src/agents/equifax-prompt.js` | `+18665495097` | — |

All three agents follow the same IVR navigation pattern: navigate automated system → verify identity (SSN + ZIP via keypad) → answer knowledge-based security questions → dispute specified accounts as fraudulent. Experian v6 completes the dispute in-call without transferring to a human.

### Call Outcomes

| Outcome | case_status | Notes |
|---|---|---|
| `transferred` / `reached_human` | `Awaiting Remover` | Human takes over from here |
| `no_answer` / `busy` / `left_voicemail` / `failed` / `completed_short` | `Call Failed` | Retryable |

### Scheduling

Business hours: **M-F 9am-5pm ET** (bureau lines open ~8am-8pm ET; conservative window used).

Cron schedule in `vercel.json`: `*/15 13-22 * * 1-5` (every 15 min, M-F, 1pm-10pm UTC = 9am-6pm ET).

### `POST /api/launch-call` Payload

```json
{
  "bureau": "EX",
  "clientData": {
    "firstName": "John",
    "middleName": "A",
    "lastName": "Doe",
    "ssn": "123-45-6789",
    "dob": "01/15/1985",
    "phone": "+15551234567",
    "address": { "line1": "123 Main St", "city": "Austin", "state": "TX", "zip": "78701" }
  },
  "inquiries": [{ "creditorName": "Chase Bank", "date": "2024-01-10" }],
  "transferNumber": "+15559876543",
  "clientId": "recXXX"
}
```

`bureau` defaults to `EX`. `transferNumber` falls back to `FUNDHUB_REP_NUMBER` env var.

### `POST /api/schedule-call` Payload (from AX23)

```json
{
  "case_id": "recXXX",
  "ghl_contact_id": "xxx",
  "round": "recXXX",
  "selected_bureaus_raw": "EX,TU",
  "inquiry_remover_user_id": "recXXX"
}
```

---

## System 2: AI Setter "Josh"

Josh is an outbound Bland AI agent that calls leads immediately after they complete the UnderwriteIQ assessment and book their Strategy Session. He has their credit data and pre-approval amount.

### Flow

```
GHL workflow fires after appointment booking + analyzer gate passes
  → POST /api/trigger-setter-call
    → classify lead grade (1-4)
    → Grade 1 (disqualified) → skip, return {skipped: true}
    → Grade 2-4 → launch Bland call (Josh persona)
  → Josh calls the lead (max 10 min, AMD enabled)
  → Call completes
  → POST /api/setter-webhook (Bland fires this)
    → determine outcome
    → update GHL contact (custom fields + tags)
    → confirmed → trigger 3-way text handoff (AI-SET-04)
    → no_answer/voicemail → double-dial + SMS cadence (AI-SET-03)
    → reschedule → trigger DPC-04 workflow
    → async: post-call analysis
```

### Lead Grading

| Grade | Criteria | Action |
|---|---|---|
| 1 | `analyzer_recommendation = "disqualified"` | Skip call entirely |
| 2 | `analyzer_recommendation = "repair"` | Repair-path variant |
| 3 | `analyzer_recommendation = "funding"`, prequal < $50K | Standard setter |
| 4 | `analyzer_recommendation = "funding"`, prequal >= $50K | VIP setter |

### Call Outcomes

| Outcome | GHL Action |
|---|---|
| `confirmed` | `cf_call_confirmed=true`, `cf_last_progress_action=ai_call_confirmed`, fires 3-way handoff |
| `reschedule` | `cf_decision_status=reschedule`, fires DPC-04 workflow |
| `no_answer` | Tag `setter:no-answer`, double-dial + SMS cadence |
| `voicemail` | Tag `setter:voicemail`, double-dial + SMS cadence |
| `failed` | Tag `setter:failed` |

### No-Answer Cadence

When outcome is `no_answer` or `voicemail`, two things fire in parallel:

1. **Double-dial** — immediate second Bland call with voicemail drop support
2. **SMS cadence** — fires GHL workflow `AI-SET-03` (`GHL_SETTER_CADENCE_WEBHOOK_URL`), which manages:
   - SMS #1 at 7 min (value-first)
   - SMS #2 at 4 hours (follow-up)
   - SMS #3 at day 2 (break-up)

### 3-Way Text Handoff

On `confirmed` outcome, fires GHL workflow `AI-SET-04` (`GHL_SETTER_HANDOFF_WEBHOOK_URL`). The workflow sends a Zoom link + advisor intro SMS 15 minutes before the appointment.

### `POST /api/trigger-setter-call` Payload (from GHL)

```json
{
  "contact_id": "xxx",
  "first_name": "John",
  "phone": "+15551234567",
  "appointment_time": "2026-04-10T14:00:00Z",
  "analyzer_recommendation": "funding",
  "prequal_amount": "125000",
  "primary_fico": "720",
  "closer_name": "Chris"
}
```

### Bland Custom Tools

Josh calls two mid-call tool endpoints during the conversation:

- `POST /api/setter-slots` — fetches available GHL calendar slots; returns natural-language string like `"Tuesday at 10:00 AM, Wednesday at 2:00 PM"`
- `POST /api/setter-book` — books the selected time in GHL; returns confirmation string

Both require Bearer auth, configured in the Bland AI tool headers.

---

## System 3: Mailgun Bank Inbox

Receives forwarded bank emails at `mg.fundhub.ai`, classifies them, and routes events.

### Flow

```
Mailgun catch-all route → POST /api/mailgun-inbound?secret=<MAILGUN_INBOUND_SECRET>
  → verify inbound secret
  → extract contact_id from recipient address (e.g. <contact_id>@mg.fundhub.ai)
  → classify email into event type (keyword rules)
  → extract amount, lender name, body preview
  → deduplicate via message_hash
  → write to Airtable BANK_INBOX
  → fire GHL F-11 webhook (event router) — skipped for NOISE
  → if first email for contact → fire GHL F-10R (inbox_verified event)
```

### Event Types

| Type | Signals |
|---|---|
| `APPROVED` | approved, congratulations, credit limit, funded |
| `COUNTEROFFER` | counteroffer, revised offer, reduced |
| `DENIED` | denied, declined, adverse action, unable to approve |
| `MISSING_DOCS` | missing document, please provide, identity verification |
| `ACTION_REQUIRED` | action required, please sign, accept your offer |
| `APP_RECEIVED` | application received, thank you for applying |
| `NOISE` | noreply senders, newsletters, no keyword match |

Classification rules are in `src/lib/email-classifier.js`. First match wins (priority order).

### Airtable BANK_INBOX Fields

| Field | Source |
|---|---|
| `Id` | GHL contact ID (from recipient address) |
| `from` | Sender address |
| `Body Preview` | `[subject]\n\nbody excerpt` |
| `Timestamp` | ISO timestamp from Mailgun or now |
| `Type` | Classified event type (singleSelect) |
| `Amount` | Extracted dollar amount |
| `lender_name_guess` | Parsed from sender/subject/body |
| `message_hash` | SHA256 for deduplication |
| `raw_payload_json` | Full classification details |

---

## Environment Variables

### Required

| Variable | Description |
|---|---|
| `BLAND_API_KEY` | Bland AI API key |
| `API_SECRET` | Bearer token for protected endpoints |
| `CRON_SECRET` | Bearer token for `/api/dispatch-scheduled` |
| `AIRTABLE_API_KEY` | Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | FUNDHUB MATRIX base ID |
| `GHL_PRIVATE_API_KEY` | GHL Private Integration Token (location-level) |
| `GHL_LOCATION_ID` | GHL location ID (`ORh91GeY4acceSASSnLR`) |
| `WEBHOOK_BASE_URL` | Full deployment URL, e.g. `https://inquiry-removal-ai-sigma.vercel.app` |
| `FUNDHUB_REP_NUMBER` | FundHub rep phone for warm transfers (E.164) |

### Optional / System Defaults

| Variable | Default | Description |
|---|---|---|
| `BLAND_VOICE` | `mason` | Bland AI voice ID |
| `BLAND_WEBHOOK_SECRET` | _(none)_ | Bland webhook HMAC secret; verification skipped if unset |
| `EXPERIAN_DISPUTE_NUMBER` | `+18554146048` | Experian dispute line |
| `TRANSUNION_DISPUTE_NUMBER` | `+18009168800` | TransUnion dispute line |
| `EQUIFAX_DISPUTE_NUMBER` | `+18665495097` | Equifax dispute line |
| `GHL_CALENDAR_ID` | _(none)_ | GHL calendar ID for setter appointment booking |
| `MAILGUN_INBOUND_SECRET` | _(none)_ | Query param secret for `/api/mailgun-inbound` |
| `MAILGUN_SIGNING_KEY` | _(none)_ | Mailgun webhook signing key (currently unused) |
| `GHL_F11_WEBHOOK_URL` | _(none)_ | GHL F-11 trigger URL (bank email event router) |
| `GHL_SETTER_CADENCE_WEBHOOK_URL` | _(none)_ | GHL AI-SET-03 trigger URL (no-answer SMS cadence) |
| `GHL_SETTER_HANDOFF_WEBHOOK_URL` | _(none)_ | GHL AI-SET-04 trigger URL (3-way text handoff) |
| `GHL_DPC04_WEBHOOK_URL` | _(none)_ | GHL DPC-04 trigger URL (reschedule cadence) |

Copy `.env.example` to `.env` to get started locally.

---

## File Structure

```
inquiry-removal-ai/
├── api/                          # Vercel serverless handlers
│   ├── launch-call.js            # Direct bureau call launch
│   ├── schedule-call.js          # AX23 webhook → schedule or launch
│   ├── dispatch-scheduled.js     # Cron job — dispatches queued cases
│   ├── call-webhook.js           # Bland AI callback (bureau calls)
│   ├── call-status.js            # Call status lookup
│   ├── test-call.js              # Test launch using Airtable test client
│   ├── trigger-setter-call.js    # GHL → grade lead → launch Josh
│   ├── setter-launch.js          # Manual setter call launch
│   ├── setter-webhook.js         # Bland AI callback (setter calls)
│   ├── setter-slots.js           # Bland tool: fetch GHL calendar slots
│   ├── setter-book.js            # Bland tool: book GHL appointment
│   └── mailgun-inbound.js        # Inbound bank email handler
├── src/
│   ├── agents/
│   │   ├── experian-prompt.js    # Experian IVR agent (v6)
│   │   ├── transunion-prompt.js  # TransUnion agent (v2)
│   │   ├── equifax-prompt.js     # Equifax agent
│   │   └── setter-prompt.js      # Josh setter agent
│   └── lib/
│       ├── bland-client.js       # Bland AI REST client
│       ├── airtable-client.js    # Airtable REST client
│       ├── ghl-client.js         # GHL REST client
│       ├── ghl-webhook-sender.js # GHL workflow trigger helpers
│       ├── auth.js               # Bearer token auth middleware
│       ├── packet-builder.js     # Build Bland request_data from PII
│       ├── schedule-utils.js     # Business hour checks (ET timezone)
│       ├── setter-outbound-cadence.js  # Double-dial + SMS cadence + 3-way handoff
│       ├── email-classifier.js   # Keyword-based email classifier
│       ├── email-parser.js       # Extract amount, lender, hash from email
│       └── mailgun-verify.js     # Mailgun signature verification
├── __tests__/
│   ├── api/                      # Handler tests (11 files)
│   └── *.test.js                 # Library tests (6 files)
├── public/
│   ├── test.html                 # Bureau call test UI
│   └── test-agent.html           # Agent test UI
├── .env.example
├── vercel.json                   # Routes + cron config
└── package.json
```

---

## Testing

272 tests across 17 suites (Jest).

```bash
npm test              # run all tests
npm test -- --watch   # watch mode
```

Tests mock all external dependencies (Bland AI, Airtable, GHL). No real calls are placed during tests.

---

## Local Development

```bash
npm install
cp .env.example .env   # fill in values
npm run dev            # starts Vercel dev server on :3000
```

The test UI is available at `http://localhost:3000/test.html` — select a bureau, enter a phone number, hit fire. Your phone rings when the AI reaches a rep.

---

## Deployment

```bash
vercel --prod
```

Set all env vars in Vercel dashboard (Settings → Environment Variables). The cron job (`/api/dispatch-scheduled`) is configured in `vercel.json` and runs automatically on the Vercel Pro plan.

Bland AI webhook URL must be configured in the Bland dashboard to point at:
- Bureau calls: `https://inquiry-removal-ai-sigma.vercel.app/api/call-webhook`
- Setter calls: `https://inquiry-removal-ai-sigma.vercel.app/api/setter-webhook`

---

## Airtable Tables (FUNDHUB MATRIX)

| Table | ID | Used By |
|---|---|---|
| `INQUIRY_REMOVAL_CASES` | `tblYOliwtT0RETm2S` | schedule-call, dispatch-scheduled, call-webhook |
| `CLIENTS` | `tblmSXx3cL7g43Eyi` | schedule-call, dispatch-scheduled |
| `PII_IDENTITY` | `tblRwLZR7uHDRb0LW` | schedule-call, dispatch-scheduled |
| `BANK_INBOX` | name-based | mailgun-inbound |

Client PII lookup path: `INQUIRY_REMOVAL_CASES.client` → `CLIENTS.identity` → `PII_IDENTITY` (SSN, DOB, address).
