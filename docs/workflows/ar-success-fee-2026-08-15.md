# AR success-fee collections — 2026-08-15

**COMPLIANCE REVIEW REQUIRED** — collections / fees / pay links / LEGAL handoff talk.

Owner go from prove thread: ship the Bland AR call brain + board from the per-approval success-fee playbook.

## Stack remap (owner-set)

| Spec said | Fundhub stack |
| --- | --- |
| GHL (CRM, pipelines, SMS, tasks) | **Fundhub CRM** + pipelines + Twilio SMS |
| Mailgun email | **Resend** |
| Commas invoices / pay links | **Commas** (unchanged) |
| Call layer | **Bland** (this prompt) + human closer when needed |
| CRS monitoring | **CRS** (unchanged) |
| Airtable / GHL custom objects | Fundhub invoice / approval objects (follow-on) |

Do **not** wire new GHL or Mailgun for this system.

## Core model (owner-set)

1. One approval = one invoice (never batch).
2. Fee = **10%** of approved amount (card limit or loan).
3. Invoice same day as confirmation; unique Commas pay link; due **net 5**.
4. Escalation clocks are **per invoice** (independent).
5. **Email first**, call within **30 minutes**, walk the email on screen.
6. Never bluff deadlines. Never invent Context Fetcher fields. Never discount the fee.
7. Authority matrix only: (1) pay in full on call (2) 50/50 with card on file (3) one 7-day extension restated on recorded line (4) nothing else.
8. Day 8–9 verification soft pull = later path; Day 10 transfer → **LEGAL** only when data says so.
9. Marcus Hale = **FORMAT DEMO ONLY** — never quote on real calls.

## Task list

| Unit | Owns | Status |
| --- | --- | --- |
| A | This board + Fundhub stack remap | **done** |
| B | Context Fetcher payload in spec §4 order (skip blanks; Marcus = demo) | pending |
| C | Approval + invoice objects, 10% fee, Commas pay link, independent clocks | pending |
| D | Email (Resend) then call in 30 min sequencing | pending |
| E | Bland collections prompt D0–D7 + stall-kills + authority matrix | **done** (`vendor/inquiry-remover/src/agents/collections-prompt.js`) |
| F | Day 8–9 verification soft-pull path + Day 10 LEGAL handoff | pending (prompt mentions only; no dial/outbox) |
| G | Tests for collections prompt | **done** (`vendor/inquiry-remover/__tests__/collections-prompt.test.js`) |

## Manifest — Unit E (prompt)

- Rewrote `vendor/inquiry-remover/src/agents/collections-prompt.js` to owner AR playbook.
- Rewrote `vendor/inquiry-remover/__tests__/collections-prompt.test.js`.
- `requestData` fields: `escalation_day`, `approval_type`, `lender`, `fee_amount`, `approved_amount`, `firm_name` (+ transfer/extension dossier).
- No live dials. No outbox dump. No commit unless owner asks.

## Open / follow-on

- Invoice + approval schema + Commas create on CONFIRMED.
- Resend templates D0/D1/D3/D7/D10.
- Per-invoice timers + promise pause / broken-promise skip-forward.
- Context Fetcher field order locked to spec §4.
