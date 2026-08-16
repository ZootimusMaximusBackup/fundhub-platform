# Customer insight surveys — shared board

Status: C + A done (beta). D (context fetcher) still pending.  
Model: Grok 4.6 high (owner-set)

## Three collections (owner-set 2026-08-15)

1. **Start** — already collected (apply survey). Do not rebuild.
2. **Mid** — phone or AI check-in, one week after they pay (`deposit.paid` / `sale.closed`). Not a Google Meet.
3. **End** — Google Meet interview after funded (`round.funded`).

Google Meet is only on the **sales call** (existing closer desk) and the **ending interview**.

## Rules

- Keep it simple. Beta: store + auto-create the task.
- SMS is a nudge only, not the interview.
- Do not add journey steps that are not in the intended journey. Ask Chris first.
- Claim before start. Write a manifest when done.

## Tasks

| ID | Owner | Status | Notes |
|---|---|---|---|
| C — Store + funded task | this session | done | Table + save/read API + auto task on `round.funded`. |
| A — Mid check-in | this session | done | Task due in 7 days on `deposit.paid` / `sale.closed`. Phone/AI, not Meet. |
| B — Meet / questions | this session | done | Folded into C. Questions in `src/insights/questions.mjs`. |
| D — Context fetcher | unclaimed | pending | Read stored rows into `src/agents/context.mjs`. |

## Frozen response shape (C)

One row per interview / check-in.

| Field | Meaning |
|---|---|
| `client_id` | Who |
| `product_id` | Which offer (optional) |
| `stage` | `mid` or `post` |
| `channel` | `call`, `ai_reachout`, or `google_meet` |
| `answers` | `{ "question_id": "answer", ... }` |
| `notes` | Transcript or summary |
| `meeting_url` | Google Meet link if there was one |
| `recording_url` | Recording link later (empty for now) |
| `recorded_by` | Staff who saved it |
| `occurred_at` | When the conversation happened |

Write: `POST /api/customer-insights` (staff)  
Read: `GET /api/read/customer-insights?client_id=` (staff) — also returns `questions`

## COMPLIANCE REVIEW REQUIRED

Answers may later be used in ads, VSL, and landing pages. This batch only **stores**. It does not publish quotes.

## Manifests

### C — Store + funded task (done)

**Files**
- `db/migrations/166_customer_insights.sql`
- `src/insights/questions.mjs` + tests
- `src/insights/store.mjs` + tests
- `src/handlers/customer-insights.mjs` + tests
- `api/customer-insights.mjs` (POST)
- `api/read/customer-insights.mjs` (GET)
- `src/http/customer-insights-endpoints.test.mjs`
- `src/register-all.mjs` — register after money-chain
- `netlify/functions/api.mjs` — ROUTES
- journeys regenerated + changelog

**Exports / routes**
- `POST /api/customer-insights`
- `GET /api/read/customer-insights`
- `round.funded` → `Post-funding Google Meet interview` (funding advisor)

### A — Mid check-in (done)

**Files**
- `src/handlers/customer-insights.mjs` — also listens to `deposit.paid` and `sale.closed`
- `src/handlers/customer-insights.test.mjs`

**Behavior**
- One mid task per client (`dedupeOn: title`)
- Due in 7 days
- Body says phone/AI, not Google Meet
- Save as `stage=mid`, `channel=call`
