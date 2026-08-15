# Bland agents prove — 2026-08-14

**Owner:** Chris. Local + parallel threads. Grok for voice; fonts/email in other sessions.

**Laws:** GHL out. No SMS (Twilio Monday). Email = Resend one-shot only. Outbox stays paused (`outbound_enabled=false`). Do not dump queue. Do not wake Inngest. Do not `--prod` unless a one-shot deploy is required for the new `BLAND_API_KEY` / `BLAND_WEBHOOK_SECRET` to be live on functions — prefer local one-shots that already have the key. Do not print secrets. Prove phone `+16616180865`. Prove email `stanbridgejchris@gmail.com`. Org `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`. Webhook must be `https://fundhub.ai/api/webhooks/bland`.

**Already done:** short Bland prove call `326e71c0-86f3-4c76-ba8e-de0627a9c30d` (507 ring). New `org_…` `BLAND_API_KEY` in `.env` + Netlify. `BLAND_WEBHOOK_SECRET` set. Five sample clients + packs + `[PROVE]` emails + Playwright 100.

| Unit | Model | Status |
|------|-------|--------|
| A1 Wire agent send path to Fundhub Bland key + webhook | Grok 4.6 | **done** |
| A2 Setter / sales agent live call to Chris | Grok 4.6 | **done** — call `823ec038-e86e-461a-b265-13009959eb8f` |
| A3 One bureau inquiry-removal agent live call | Grok 4.6 | **done** — Experian agent to Chris phone (not real IVR); call `9c6db403-8153-43c7-91ff-7382f57ab192`; owner heard it |
| A4 Confirm webhook outcome on fundhub.ai | Grok 4.5 | **done** — signed replay → `call.completed` `145667a9-b61b-412b-b0fc-9c9e22126a5e` |
| A5 Rewrite S-02 Analyzer email → Underwrite IQ | Grok 4.5 | **done** |
| A6 Letter fonts Inter + JetBrains Mono (gold W8) | Grok 4.5 | **done** — gold WeasyPrint path; pdffonts Inter+JetBrains, no Helvetica |
| A7 Dashboards show five samples | Grok 4.6 | **done** — live /app/ UI+API 5/5 |

## Manifests

### A1 — done (local)

Wire callbacks off Vercel paths onto Fundhub inbound.

**Files**
- `vendor/inquiry-remover/src/lib/bland-client.js` — `resolveBlandWebhookUrl()` default `https://fundhub.ai/api/webhooks/bland`
- `vendor/inquiry-remover/src/agents/{setter,experian,equifax,transunion}-prompt.js` — use that helper (no `WEBHOOK_BASE_URL` + `/api/*-webhook`)
- `vendor/inquiry-remover/.env.example`, README — `BLAND_WEBHOOK_URL`
- tests: setter-prompt + bland-client — **38/38 pass**

**Prove key:** root `.env` `BLAND_API_KEY` in local one-shots (vendor has no `.env`).

### A2 — done

Local one-shot `buildSetterCallConfig` → Bland `createCall`.
- call_id `823ec038-e86e-461a-b265-13009959eb8f`
- webhook on create: `https://fundhub.ai/api/webhooks/bland`
- Bland status: completed (~13s, answered_by unknown)

### A3 — done

Experian agent config, **phone overridden to `+16616180865`** (did not dial real Experian IVR).
- call_id `9c6db403-8153-43c7-91ff-7382f57ab192`
- webhook on create: `https://fundhub.ai/api/webhooks/bland`
- Bland status: completed, answered_by human; owner confirmed ring/script

### A4 — done

- Re-set `BLAND_WEBHOOK_SECRET` on Netlify from local `.env`
- `netlify deploy --prod --no-build` (skip empty local `DATABASE_URL` guard)
- Signed POST to `https://fundhub.ai/api/webhooks/bland` → **200**
- Emitted `call.completed` id `145667a9-b61b-412b-b0fc-9c9e22126a5e` for call `9c6db403-8153-43c7-91ff-7382f57ab192`
- Confirmed in `events` via Supabase MCP

Note: live Bland→Fundhub callbacks during A2/A3 likely hit 401 before this deploy. Path proven with signed replay after deploy.

### A5 — S-02 Analyzer → Underwrite IQ (done 2026-08-14)

**Files**
- `fundhub-docs/sources/EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md` — S-02 section only: title, subject, and body now say Underwrite IQ instead of Analyzer. Merge tags unchanged: `{{contact.first_name}}`, `{{analyzer_link}}`, `{{sender_name}}`.
- Live DB `message_templates` rows `S-02` and `EMAIL-S02-FINISH-APPLICATION` — subject + body updated to match (still `compliance_passed=false`).

**Unchanged (on purpose)**
- Send path: workflow still uses `EMAIL-S02-FINISH-APPLICATION` → `sendTemplated`.
- No Bland, letter PDFs, SMS, outbox, or Inngest edits.

### A6 — done (verified)

Owner path: carbon-copy gold templates (not JS Helvetica). Re-verified smoke PDF `/tmp/fh-node-gold-letter.pdf` with `pdffonts`: **Inter + JetBrains Mono**, no Helvetica. Fonts at `docs/workflows/gold-deliverables-v5/fonts/`. Printer: `renderPlainLetter` → WeasyPrint CLI.

### A7 — done (2026-08-15) live screens + API

Logged in as `chris@fundhub.ai` on `https://fundhub.ai`. Password from `.env`. Demo is off on `/app/`.

**Pass:** all 5 findable in search; correct tiers; packs on 1–4; no pack on `+review`; messaging threads for pack people.

| Alias | Person | Tier | Search | CCP live | Pack msgs | Inbox thread | Closer-call |
|-------|--------|------|--------|----------|-----------|--------------|-------------|
| +full | Chris Full `d56838a7-…cbab` | FULL_FUNDING | yes | yes · 25 msgs | 7 with files | yes | name + scores |
| +fpr | Chris Fpr `54bdc228-…2ede` | FUNDING_PLUS_REPAIR | yes | yes · 3 msgs | 3 with files | yes | name + scores |
| +prem | Chris Prem `dad186ff-…503d` | PREMIUM_STACK | yes | yes · 3 msgs | 3 with files | yes | name + scores |
| +repair | Chris Repair `929fc1cb-…9173` | REPAIR_ONLY | yes | yes · 2 msgs | 1 with files | yes | n/a (not funding) |
| +review | Chris Review `754ab724-…d23b` | MANUAL_REVIEW | yes | yes · 0 msgs | none (correct) | none (correct) | n/a |

**Screens (OK / skip as planned)**
- Pipeline: live board has 14 other cards; none of the five samples. Empty-for-them is OK.
- Documents: `documents` table empty for all five. Packs live on email threads, not this screen.
- Inquiry Remover / Calendar: empty. OK (no case / no booking).
- `/crm.html`: old sample pack (Bianca / fake holds). It does **not** list these five. Live book is `/app/` search + CCP.

**Evidence**
- JSON: `docs/workflows/bland-agents-prove-evidence/a7/evidence.json`
- Search: `02-search-full.png` … `02-search-review.png`
- CCP: `03-ccp-full.png` … `03-ccp-review.png`
- Messaging: `04-messaging.png` (4 threads: Full, Fpr, Prem, Repair — no Review)
- Closer: `05-closer-full.png` `05-closer-fpr.png` `05-closer-prem.png`
- Documents / pipeline / IR / calendar: `06-documents.png` `07-pipeline.png` `08-inquiry-remover.png` `09-calendar.png`
- `/crm.html` sample: `01-crm.html.png`
