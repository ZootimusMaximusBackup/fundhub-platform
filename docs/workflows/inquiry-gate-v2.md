# Inquiry Gate v2 — shared board

**Spec:** Inquiry Gate BUILD SPEC v2 (2026-08-06)  
**Owner decisions:** Grok 4.5 fast (override); serial build; commit after each W; additional-docs = upload target only (no FTC generation).

## Task list

| Unit | Owner | Status | Notes |
|---|---|---|---|
| W0 Migration + brief | this session | claimed | |
| W1 Trigger + letter draft | this session | pending | |
| W2 Doc gate + send gate | this session | pending | |
| W3 Lender gate | this session | pending | |
| W4 Delivery + call scheduler | this session | pending | |
| W5 Remover screen | this session | pending | |

## Shared context brief

### Column contract (`inquiry_removal_cases`)

| Column | Type | Meaning |
|---|---|---|
| `first_delivery_at` | timestamptz | First delivery land (portal upload ts OR Lob delivered webhook) |
| `call_due_at` | timestamptz | `first_delivery_at` + 1 business day, hour-preserved |
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

_(append per unit)_
