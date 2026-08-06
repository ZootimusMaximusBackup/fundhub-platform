# Inquiry Gate v2 — shared board

**Spec:** Inquiry Gate BUILD SPEC v2 (2026-08-06)  
**Owner decisions:** Grok 4.5 fast (override); serial build; commit after each W; additional-docs = upload target only (no FTC generation); delivery→call wait is configurable per bureau/channel on `ai_bureau_config` (portal default 1, mail default 3) — not hardcoded.

## Task list

| Unit | Owner | Status | Notes |
|---|---|---|---|
| W0 Migration + brief | this session | done | + configurable wait columns |
| W1 Trigger + letter draft | this session | done | |
| W2 Doc gate + send gate | this session | done | |
| W3 Lender gate | this session | done | |
| W4 Delivery + call scheduler | this session | done | + configurable mail_service_level |
| W5 Remover screen | this session | done | extend inquiry-remover.html only |

## Shared context brief

### Column contract (`inquiry_removal_cases`)

| Column | Type | Meaning |
|---|---|---|
| `first_delivery_at` | timestamptz | First delivery land (portal upload ts OR Lob delivered webhook) |
| `first_delivery_channel` | text | `portal` \| `mail` — which channel won; picks wait days |
| `call_due_at` | timestamptz | delivery + `ai_bureau_config` wait for that bureau/channel, business days, hour-preserved |
| `call_fired_at` | timestamptz | When AI bureau call was enqueued |
| `letter_provider_id` | text | Lob (or swap) tracking id |
| `portal_confirmation` | text | Experian portal reference — required to complete portal send |
| `gate_override_by` | uuid → staff | Owner-only override for lender matching |
| `gate_override_at` | timestamptz | When override was set |
| `letter_draft_html` | text | Draft dispute letter body (never auto-sent) |
| `draft_letter_document_id` | uuid → documents | Optional PDF/doc row for the draft |

### Case status (DB enum — unchanged)

`Queued` · `Scheduled` · `In Progress` · `Completed` · `Escalated` · `Blocked` · `Canceled`

UI labels map from **pipeline stage** + status:

| UI label | case_status | stage |
|---|---|---|
| Blocked (docs) | `Blocked` | `awaiting_documents` |
| Ready for Review | `Queued` | `specialist_assigned` |
| Sent | `In Progress` | `letters_sent` |
| Awaiting Call | `In Progress` | `calls_in_progress` (call scheduled, not yet done) |
| Complete | `Completed` | `removed` / `resume_funding` |

### Pipeline stage map (`inquiry_removal`)

Order after migration: `requested` → `specialist_assigned` → `awaiting_documents` → `letters_sent` → `calls_in_progress` → `removed` → `resume_funding` → `hold`

| Case event | Stage |
|---|---|
| Case created | `requested` |
| Remover assigned | `specialist_assigned` |
| Doc gate blocked | `awaiting_documents` |
| Last doc lands → ready | `specialist_assigned` |
| Remover presses send | `letters_sent` |
| Delivery confirmed / call due | `calls_in_progress` |
| Items confirmed removed | `removed` |
| Bureau gate reopens | `resume_funding` |
| External block | `hold` |

Keep `optimization` (Repair) separate. Never move cards across.

### `ai_bureau_config` wait columns (W4)

| Column | Default | Meaning |
|---|---|---|
| `portal_wait_business_days` | 1 | Business days after portal upload before AI call |
| `mail_wait_business_days` | 3 | Business days after Lob delivered before AI call (placeholder) |
| `mail_service_level` | `priority_express` | Lob service: `priority` \| `priority_express` |

`call_due_at = first_delivery_at + wait(bureau, channel)`, business days, hour-preserved. Missing config row → use defaults above.

Mail service level is read from config on send; send body may pass `mail_service_level` to override per case (e.g. downgrade to `priority`).

### Doc packet subtypes (`client_upload` + `authorization`)

- `id_document` — government photo ID  
- `ssn_card` — SSN card (required when SSN is in the dispute)  
- `proof_of_address` — utility/bank; `bank_statement` also satisfies  
- `authorization` / `soft_pull_consent` — signed authorization  

### Additional documentation (§4.3)

Upload target **only**. Label: "Additional documentation — fraud / identity theft cases."  
Remover attaches FTC/police report they obtained. No generation, no pre-fill, no auto-attach, no filing flow.

### Events to add (canonical)

- `round.closeout` — emit when funding closeout is written  
- `inquiry.gate.raised` / `inquiry.gate.clear`  
- `inquiry.docs.needed`  

### Triggers

- `deposit.paid` → pre-funding gate (always)  
- `round.closeout` → between-round gate  
- NOT `round.funded`, NOT `diagnostic.paid`

### Idempotency key

`(org_id, client_id, funding_round_id, bureau)` — active case for that tuple → update, never duplicate.

## Change manifests

### W0
- `db/migrations/155_inquiry_gate.sql` — case delivery/call columns, pipeline stages, `ai_bureau_config` wait + `mail_service_level`
- `db/expected-migrations.mjs` — lists 155
- `docs/workflows/inquiry-gate-v2.md` — this board

### W1
- `src/handlers/inquiry-gate.mjs` — deposit.paid + round.closeout → per-bureau cases, draft letter, doc-gate status, pipeline move, emits
- `src/inquiry-ops/extract-disputables.mjs` (+ test) — CRS + inquiry_log → per-bureau items
- `src/inquiry-ops/letter-draft.mjs` — §1681i draft HTML with variance
- `src/inquiry-ops/doc-gate.mjs` — packet check (W2 extends flip-on-upload)
- `src/events/canonical.mjs` — round.closeout, inquiry.gate.*, inquiry.docs.needed
- `src/register-all.mjs` — registerInquiryGate
- `src/handlers/money-chain.mjs` — emit round.closeout after closeout write
- `src/documents/kinds.mjs` — ssn_card, proof_of_address, additional_fraud_docs subtypes
- Tests: `inquiry-gate.test.mjs`, `inquiry-gate.pg.test.mjs`

### W2
- `src/inquiry-ops/send.mjs` (+ tests) — human send gate; portal needs Experian ref; EX-only portal
- `src/handlers/inquiry-docs.mjs` (+ test) — `inquiry.docs.needed` chase via F-06 templates; `docs.received` flip
- `api/inquiry-cases.mjs` — `send` + `gate_override` actions
- `src/register-all.mjs` — registerInquiryDocs

### W3
- `src/lenders/match.mjs` (+ tests) — `sensitiveBureaus` takes case rows; override clears bureau
- `src/lenders/store.mjs` — `matchForClient` loads active cases
- `src/inquiry-ops/gate.mjs` — gate status, owner override, round attach + closer task
- `src/handlers/money-chain.mjs` — `attachGateToRound` on `round.started`

### W4
- `src/messaging/providers/lob-letter.mjs` (+ test) — Lob letter send + webhook verify; `service` from config
- `src/inquiry-ops/business-days.mjs` (+ test) — hour-preserving business days + holidays
- `src/inquiry-ops/call-scheduler.mjs` (+ test) — first delivery → `call_due_at` from config wait
- `src/workflows/inquiry-call-sweeper.mjs` — defined, not registered
- `src/http/router.mjs` — `/api/webhooks/lob` delivery → starts call clock

### W5
- `public/app/inquiry-remover.html` — expandable case rows (same route, no new page/nav)
- `src/http/inquiry-remover-view.mjs` (+ test) — `buildCaseSendRequest`, case UI labels
- `src/inquiry-ops/cases.mjs` — listCases joins client name
- Journeys: `role-inquiry-remover-actual` regenerated; CHANGELOG `890f1ba`

## Batch status

**Complete** (W0–W5). Not pushed. Migration 155 not applied to prod from this session (`DATABASE_URL` unset; Netlify API blocked here).

### Still for humans
1. Apply `155_inquiry_gate.sql` on prod
2. Set `LOB_API_KEY` / `LOB_WEBHOOK_SECRET` when wiring mail (not before)
3. Register `inquiry-call-sweeper` when ready to fire calls on a schedule
4. Smoke Inquiry Remover expand → send on a demo client

