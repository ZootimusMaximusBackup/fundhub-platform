# Prove all channels — 2026-08-14 1:47pm

**Owner:** Chris is bored. Prove email + Bland now. Grok only. Design/typeface stays Claude.

**Laws:** GHL out. No SMS (Twilio Monday). Email = Resend, one-shot `dispatchMessage` only. Outbox stays paused. Do not `--prod`. Do not drain queue. Do not wake Inngest. Do not flip `EMAIL-U02-ANALYZER-REPAIR-DELIVERY`. Do not print secrets. All prove mail → `stanbridgejchris@gmail.com`. Phone `+16616180865`. Org `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`.

**Do not flip `compliance_passed` on prod templates.** Copy body into a one-shot row instead. Skip `[DRAFT]` bodies. Skip GHL leftover keys (`FR*`, `BS-FUND*`, `LT-*`).

| Unit | Model | Files | Status |
|------|-------|-------|--------|
| P1 Email one-shots (workflow EMAIL-* + 4 remaining passed) | Grok 4.6 extra-high | `scripts/tmp-email-channel-prove.mjs` only | done |
| P2 Bland one live call | this chat (Grok 4.6) | `scripts/tmp-bland-prove.mjs` + local `.env` name `BLAND_API_KEY` | **done** — call_id `326e71c0-86f3-4c76-ba8e-de0627a9c30d` |
| P3 Gold letter layout (not typeface) | Grok 4.6 extra-high | `vendor/underwriteiq-full/api/lite/letter-generator.js` + its tests | done |
| P4 Live Playwright reconfirm | Grok 4.5 high | `e2e/live-*.spec.mjs` + `docs/workflows/live-playwright-100.md` | done |
| P5 CRM messaging rows for 5 sample clients | Grok 4.5 high | read-only CRM / SQL evidence | done |
| P6 Link sendTemplated to Messaging inbox | Grok 4.5 high | messaging.mjs + tests | **done** |
| P7 Funding pack missing bureau letters | this chat | letter-pack.mjs + tests + one-shot resend | **done + sent** — 2:08pm packs include `ex_round1.pdf` + `eq_round1.pdf` |

**Passed templates (may send):** `CONTRACT-REMIND-EMAIL`, `CONTRACT-SEND-EMAIL`, `EMAIL-DS02-DIY-LETTERS-READY`, `EMAIL-PORTAL-MAGIC-LINK`, `EMAIL-U02-ANALYZER-FUNDING-DELIVERY`, `INVOICE-SENT-EMAIL`.

**Blocked by flag (prove via one-shot copy, do not flip flag):** `EMAIL-F02*` `EMAIL-F03` `EMAIL-F04` `EMAIL-F06` `EMAIL-F07` `EMAIL-F10` `EMAIL-N01`–`N06` `EMAIL-S02` `EMAIL-DPC05` `EMAIL-AX07` `EMAIL-C06` `EMAIL-DS01`. Skip `EMAIL-U02-ANALYZER-REPAIR-DELIVERY`.

**W8 typeface (Inter + JetBrains Mono):** parked Claude. Do not run on Grok.

## Manifests

## P3 manifest

- **Status:** done (layout only — typeface stays W8 Claude)
- **Model:** Grok 4.6 extra-high
- **Files:** `vendor/underwriteiq-full/api/lite/letter-generator.js`, `vendor/underwriteiq-full/api/lite/__tests__/letter-generator.test.js`, `src/underwrite/letter-generator.test.mjs`
- **Tests:** `node --test src/underwrite/letter-generator.test.mjs vendor/underwriteiq-full/api/lite/__tests__/letter-generator.test.js` → **37 pass / 0 fail / 0 skip** (18 src + 19 vendor)
- **Compare:** Jordan Sample Experian bureau vs `docs/workflows/gold-deliverables-v5/compare/gold-dispute_experian_bureau.txt`. Live 4582 chars, gold 4611. Same sender / date / Experian / Re / 3 dispute items / REQUESTED ACTIONS / Sincerely / tracked ENCLOSURES. No Fundhub. No empty letter when items exist. Empty item list still emits nothing.
- **Not matching gold (honest):** Helvetica not Inter, Courier not JetBrains Mono (W8). Cite lines are Courier gray 7.3pt but without 0.4pt letter-spacing. Stale-day count is **1,786** vs gold **1,785**. Line wraps will not match Inter. Gold inquiry/personal PDFs are header-only; live ones keep FCRA bodies on purpose.
- **Not done:** no commit, no `--prod`, no email, no Inter/JetBrains/fontkit.



### P2 — Bland one live call (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

Old key was 20 chars and returned **401 AUTH_FAILURE**. Owner made a new `org_…` key. Set `BLAND_API_KEY` in local `.env` + Netlify (all contexts, `--secret`). Webhook URL set to `https://fundhub.ai/api/webhooks/bland`; `BLAND_WEBHOOK_SECRET` set same places. Prove: `node scripts/tmp-bland-prove.mjs +16616180865` → **HTTP 200**, `call_id=326e71c0-86f3-4c76-ba8e-de0627a9c30d`, `bland_status=success`. Owner confirmed inbound ring from a **507** caller ID. No `--prod` deploy this turn (local one-shot used the new key). Live Netlify functions pick up the key on next build. No commit.

**At:** 2026-08-14T21:32Z

## P4 manifest

- **Score:** 100/100 (19/19 required ids)
- **Command:** `npm run test:e2e:live` → `https://fundhub.ai` + `https://apply.fundhub.ai`
- **Result:** all required ids PASS; no failures
- **Failed ids:** none
- **Evidence:** `docs/workflows/e2e-verify-run4-evidence/live-playwright-100/last-run.json`, `score.json`
- **Product source touched:** none
- **Fixes / re-runs:** none (first run green)
- **At:** 2026-08-14T20:51:04Z · commit `d85eadf`

## P5 manifest

- **Status:** done (5/5 PASS on sample roster bar)
- **Model:** Grok 4.5 high
- **Method:** Supabase MCP `execute_sql` read-only; no send; no `--prod`
- **Org:** `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`
- **Evidence:** `docs/workflows/e2e-verify-run4-evidence/p5-crm-messaging/p5-proof.json`
- **Product source touched:** none (board + evidence only)

| Person | Exists | Tier | Latest outbound | Attach | CCP msgs | Messaging inbox | Verdict |
|--------|--------|------|-----------------|--------|----------|-----------------|---------|
| +full | yes | FULL_FUNDING | sent · funding pack | 11 | yes | no | PASS |
| +fpr | yes | FUNDING_PLUS_REPAIR | sent · funding pack | 10 | yes | no | PASS |
| +prem | yes | PREMIUM_STACK | sent · funding pack | 10 | yes | no | PASS |
| +repair | yes | REPAIR_ONLY | sent · DIY letters | 12 | yes | no | PASS |
| +review | yes | MANUAL_REVIEW | none (no pack) | 0 | no | no | PASS |

- **Finding:** all sample outbound rows have `conversation_id` NULL and zero `conversations` rows, so Messaging inbox will not list a thread. Client Control Panel still includes them via `/api/dashboard/client` messages-by-client_id.
- **+review:** zero outbound rows (no pack email) — correct.

## P6 manifest

- **Status:** done
- **Model:** Grok 4.5 high
- **What broke:** `sendTemplated` inserted outbound `messages` with `conversation_id` NULL and never called `upsertConversation` / `linkMessage`, so Messaging inbox stayed empty while CCP still showed packs by client_id.
- **Fix:** after a real INSERT (`RETURNING id, created_at`), upsert the (client, channel) thread and link the message. Channel is the exact `messages.channel` value. Thread failure is try/catch + log + swallow (queue row kept). DO NOTHING replay does not thread again.
- **Files:** `src/workflows/messaging.mjs`, `src/workflows/messaging.test.mjs`, `scripts/tmp-backfill-sample-threads.mjs` (one-shot), board only.
- **Tests:** `node --test src/workflows/messaging.test.mjs` → **35 pass / 0 fail** (was 29; +6 threading).
- **Sample backfill:** yes — scoped org `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6` + `email ILIKE 'stanbridgejchris+%'`. Linked **9** outbound email rows into **4** threads (`+full` 3, `+fpr` 2, `+prem` 2, `+repair` 2). Local `DATABASE_URL` empty so backfill ran via Supabase MCP SQL equivalent to the script. Script left for re-run when URL is set.
- **Not done:** no commit, no `--prod`, no outbox drain, no live Resend/SMS.
- **At:** 2026-08-14

## P1

- **Status:** done
- **Model:** Grok 4.6 extra-high
- **Files:** `scripts/tmp-email-channel-prove.mjs`, `scripts/tmp-email-channel-prove.test.mjs`, `netlify/functions/tmp-email-channel-prove-background.mjs` (draft runtime wrapper — CLI masks `DATABASE_URL`)
- **Tests:** `node --test scripts/tmp-email-channel-prove.test.mjs` → **14 pass / 0 fail / 0 skip**
- **How:** copy template subject/body into a new `messages` row (`queued`, empty attachments), rewrite `messages.to_address` to `stanbridgejchris@gmail.com`, one-shot `dispatchMessage`. Subject prefixed `[PROVE]`. Did **not** flip `compliance_passed`. Did **not** drain outbox (`outbound_enabled=false` still). Did **not** `--prod`. Did **not** wake Inngest. No SMS.
- **Client:** `stanbridgejchris+full@gmail.com` (`d56838a7-3d62-4dfd-8ed0-ead5dd76cbab`) — plus-alias stayed on `clients.email`. Inbox rewrite only.
- **Sent (21, Resend HTTP 200, body-only):** `CONTRACT-REMIND-EMAIL`, `CONTRACT-SEND-EMAIL`, `EMAIL-PORTAL-MAGIC-LINK`, `INVOICE-SENT-EMAIL`, `EMAIL-F02-ID-PORTAL-NEEDED`, `EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP`, `EMAIL-F03-ROUND-SUBMITTED`, `EMAIL-F04-ROUND-APPROVALS`, `EMAIL-F06-MISSING-DOCS`, `EMAIL-F07-FUNDING-LOCKED`, `EMAIL-F10-INBOX-SETUP`, `EMAIL-N01-COLD-NURTURE`, `EMAIL-N02-WARM-NURTURE`, `EMAIL-N03-HOT-NURTURE`, `EMAIL-N04-POST-FUNDING`, `EMAIL-N06-RENEWAL`, `EMAIL-S02-FINISH-APPLICATION`, `EMAIL-DPC05-NO-PROGRESS-72H`, `EMAIL-AX07-FUNDING-PAUSED`, `EMAIL-C06-DECLINE`, `EMAIL-DS01-REPAIR-REFERRAL`
- **Skipped:** `EMAIL-U02-ANALYZER-REPAIR-DELIVERY` (must stay false — still `compliance_passed=false`). `EMAIL-U02-ANALYZER-FUNDING-DELIVERY` + `EMAIL-DS02-DIY-LETTERS-READY` (already-sent PDF packs). No `[DRAFT]` among requested keys. No GHL leftover keys. No errors.
- **Search Gmail:** `[PROVE]`
- **Evidence:** `clients.custom_fields.prove_p1_email` on the +full sample client
- **Draft alias (not prod):** `https://p1-email-prove--transcendent-wisp-888771.netlify.app`
- **COMPLIANCE REVIEW REQUIRED:** credit-repair / fee / decline / funding-locked copy was sent to the owner prove Gmail only.
- **Not done:** no commit, no `--prod`, no outbox drain
- **At:** 2026-08-14T21:02:53Z

## P7 send (2026-08-14 2:08pm)

- **Status:** sent (code was already done; Gmail now has the bureau letters)
- **Model:** Grok 4.6 extra-high
- **How:** one-shot `scripts/tmp-resend-bureau-packs.mjs` — reused last good analysis PDFs, generated Round 1 bureau letters locally, Resend to `stanbridgejchris@gmail.com`. Did not drain outbox. Did not `--prod`. Did not wake Inngest. Did not flip repair-delivery.
- **People:** +full, +fpr, +prem — 12 PDFs each including `ex_round1.pdf` + `eq_round1.pdf` plus the four analysis files
- **No TransUnion bureau letter:** this pull has 0 negative TransUnion accounts and 0 TransUnion inquiries, so empty-letter rule omitted `tu_round1.pdf` / `inquiry_tu.pdf`. Personal-info TU letter is attached.
- **Gmail:** unread thread **2:08 PM**, subject `Your Underwrite IQ analysis pack is ready`, stacked as Fundhub 7. Search `filename:ex_round1.pdf` and `filename:eq_round1.pdf` both hit that thread.
- **COMPLIANCE REVIEW REQUIRED:** dispute letters + funding analysis went to the owner prove Gmail only.
- **Not done:** no commit, no `--prod`, Bland still 401, typeface still W8 Claude
- **At:** 2026-08-14T21:08:54Z
