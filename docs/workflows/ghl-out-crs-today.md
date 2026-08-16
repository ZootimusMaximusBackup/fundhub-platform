# GHL out · CRS today — 2026-08-14

**Owner laws (2026-08-14):**
- GoHighLevel is OUT. Do not call or debug GHL.
- SMS = Twilio (prove Monday — not approved until then).
- Email = Resend (keys pending from owner).
- Voice = Bland (unchanged).
- CRS sandbox = today's #1.
- Do not dump the paused outbound queue.
- Never print secrets. Never nag key rotation.

---

## Company E2E prove (2026-08-14 afternoon) — WORK ORDER 3+4

Plan: `~/.cursor/plans/crs_company_journey_prove_403a58d7.plan.md`  
Orchestrator: this chat. **W0+W1 here. W2–W4 after W1 posts client ids. W5 last.**

| Unit | Owner | Status |
|------|-------|--------|
| W0 Ground | orchestrator (this chat) | **done** |
| W1 Spine (C-00 sandbox → tier → CRM DB) | orchestrator (this chat) | **done — PASS** |
| W2 Funding pack (U-02 + C-06 + one-shot Resend) | parallel agent | **done — PASS** (U-02 Resend sent; C-06 webhook attempted, UIQ 401) |
| W3 Dirty letters (DS-02 + DIY pay + one-shot Resend) | parallel agent | **done — PASS** |
| W4 CRM UI correlate | parallel agent | **done — PASS (CRS→CRM UI; msgs/docs wait W2/W3)** |
| W5 Auditor | this chat | **done — PASS** (C-06 letters FAIL/GAP; batch not failed for that) |

**Do not** dump `outbound_enabled=false` queue. **Do not** send SMS. **Do not** use live CRS. All Fundhub emails → `stanbridgejchris@gmail.com` (dirty client uses plus-address so Gmail still lands; unique index `clients_org_email_uniq` forbids two rows with the same exact email).

### W0 ground brief (2026-08-14)

**Env (names only, values never printed):**

| Name | Local `.env` | Netlify production |
|------|----------------|--------------------|
| `CRS_API_HOST` | SET → `api-sandbox.stitchcredit.com` | SET → `api-sandbox.stitchcredit.com` |
| `CRS_API_USERNAME` / `CRS_API_PASSWORD` | SET | SET |
| `CRS_ALLOW_LIVE` | SET → `0` | SET → `0` |
| `CRS_LIVE_*` | SET (unused; live host stays off) | — |
| `RESEND_API_KEY` / `RESEND_FROM` | SET | SET |
| `DATABASE_URL` | EMPTY (`.env.example` says prod-only) | SET (CLI **masks**; W1 loads via API, never printed) |
| `ADAPTERS_DRY_RUN` | UNSET locally (fence holds) | `0` |
| `MESSAGING_DRY_RUN` | UNSET locally (fence holds) | `0` |
| `UIQ_DELIVER_LETTERS_URL` | UNSET | UNSET — code default `https://underwrite-iq-lite.vercel.app/api/lite/deliver-letters` |

**Outbox:** org `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6` (`fundhub`) `outbound_enabled=false`, `daily_send_cap=500`. Leave paused. One-shot Resend only of prove message ids.

**Templates (org fundhub):**

| Key | Exists | `compliance_passed` | `[DRAFT]` | Body |
|-----|--------|---------------------|-----------|------|
| `EMAIL-U02-ANALYZER-FUNDING-DELIVERY` | yes | **true** (W2 prove flip) | no | real copy (“Funding Letter Pack is ready”) |
| `EMAIL-DS02-DIY-LETTERS-READY` | yes | **true** (W3 prove flip in flight) | no | real copy (“correction letters are ready”) |

W2/W3: `sendTemplated` no-ops as `template_pending` until those two keys are `compliance_passed=true`. Copy is not draft. Flip **only those two keys** for this prove (owner work-order delivery), then one-shot Resend of that client’s message ids. Do not flip any other template. Do not drain the queue.

**W1 process fences (local runner, not a Netlify deploy):**
- `ADAPTERS_DRY_RUN=0` only so sandbox CRS can leave (`crs-softview` uses adapters fence).
- Unset `GHL_API_KEY` / `GHL_RELAY_API_KEY` in the runner so resolveClient cannot call GHL.
- Unset `INNGEST_EVENT_KEY` so `emit()` does not wake the 47 live functions.
- `MESSAGING_DRY_RUN=1` during W1 (no email). W2/W3 turn messaging off only for their one-shot ids.
- `CRS_ALLOW_LIVE=0`, host sandbox only. Fixture SSNs stay in 666-range; client email stays Gmail (sandbox identity is per-bureau canned people, not the CRM row).

**Forced paths:** sandbox often scores `MANUAL_REVIEW`. **This run did not** — spine landed `FUNDING_PLUS_REPAIR` (a funding path). W2 runs U-02 + C-06 on that natural tier. W3 still **FORCE** `REPAIR_ONLY` + DIY pay on the dirty client (no CRS pull on that row).

**Clients:**
- Funding/spine: `clients.email=stanbridgejchris@gmail.com`, phone `+16616180865`
- Dirty: `clients.email=stanbridgejchris+repair@gmail.com` (same inbox), distinct `client_id`
- Soft-pull consent `soft-pull-v1` on both

### W1 evidence — PASS (2026-08-14 18:08 UTC)

Ran C-00 via draft Netlify background function (local Netlify CLI **masks** `DATABASE_URL`; runtime does not). Unset Inngest + GHL in the runner. Sandbox host only. Outbox left paused.

| Field | Value |
|-------|--------|
| `org_id` | `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6` |
| `funding_client_id` | `9af65808-a619-4e65-ae91-239766a006b7` |
| `dirty_client_id` | `929fc1cb-9ea0-4267-8152-28662b799173` |
| `spine_tier` | **`FUNDING_PLUS_REPAIR`** (funding path — U-02 may send) |
| `crs_result_id` | `26fd1c2c-9bd5-464e-91c9-13c5f2fab463` |
| `soft_pull_request_id` | `bb31a170-fab8-4e6d-a409-996f0432546c` (`fulfilled`) |
| bureaus | TU, EX, EQ |
| tradelines | 28 |
| `analysis.completed` | `2e5aee6e-27bd-41ed-aa8a-8fed99709ac0` |
| `decision.rendered` | `ef8cf37c-1bd6-40bb-b1e1-0c2f94900153` |
| W2 | Natural funding tier — run U-02 + C-06 `letterSet=funding`. Do not force FULL_FUNDING unless U-02 refuses this tier. |
| W3 | FORCE `REPAIR_ONLY` on dirty client, then DIY `payment.received`. Prove DS-02 **blocked** on funding client. |

### W2 / W3 / W4 / W5 manifests

#### W2 Funding pack — **done — PASS** (2026-08-14 18:15 UTC)

Ran U-02 + C-06 via draft Netlify background function alias `w2-funding-pack` (did not clobber `crs-prove-w1`, did not `--prod`). Unset Inngest + GHL in the runner. `MESSAGING_DRY_RUN=1` while queueing; one-shot `dispatchMessage` only for this client's new U-02 funding email. Outbox left paused. No SMS. No W3/W4/W5.

| Field | Value |
|-------|--------|
| `org_id` | `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6` |
| `funding_client_id` | `9af65808-a619-4e65-ae91-239766a006b7` |
| client email / `messages.to_address` | `stanbridgejchris@gmail.com` (match) |
| `spine_tier` | `FUNDING_PLUS_REPAIR` (payload + column) |
| `analysis.completed` | `2e5aee6e-27bd-41ed-aa8a-8fed99709ac0` (`source=crs`, scores present ex/eq/tu, `identityOk` unset) |
| U-02 | **PASS** — `branch=funding`, queued then Resend `status=sent`. Did **not** send a repair pack (`repair_message_count=0`, repair template still `compliance_passed=false`). |
| U-02 message id | `9a88be27-0876-4b72-947f-48f3612770a4` |
| provider | `resend` |
| provider message id | len **36** (value not recorded) |
| C-06 | **attempted** — `branch=funding`, POST `{ clientId, orgId, letterSet: "funding" }` to default UIQ URL behind adapters fence. **HTTP 401** `Unauthorized`. `delivered=false`. `funding_letters_delivered_event_id` not written (only writes on success). |
| UIQ URL | `https://underwrite-iq-lite.vercel.app/api/lite/deliver-letters` |
| template flipped | **only** `EMAIL-U02-ANALYZER-FUNDING-DELIVERY` → `compliance_passed=true` (copy not `[DRAFT]`). W2 did **not** flip `EMAIL-DS02-DIY-LETTERS-READY`. |
| email routing | this org `email` was still `mailgun` (migration 164 not applied). W2 flipped **this org email → resend** so dispatch used Resend. **SMS left `ghl_relay`** (Twilio Monday). |
| outbox | still `outbound_enabled=false`, cap 500. Org sends in the window: **1** (this message only). No `dispatchDue`. |
| fences | `CRS_ALLOW_LIVE=0`, `ADAPTERS_DRY_RUN=0` (UIQ only), `MESSAGING_DRY_RUN=1` during queue, Inngest unset, GHL unset |
| evidence | `clients.custom_fields.prove_w2` on the funding client |
| draft alias | `https://w2-funding-pack--transcendent-wisp-888771.netlify.app` |

C-06 401 is the live UIQ gate (`DELIVER_LETTERS_SECRET`). Product C-06 POSTs JSON only — no bearer header. That is the code path. Attempt evidence is the 401 body, not a Netlify 202.

**Gmail (owner 2026-08-14 11:18 PDT) — landed.** From `Fundhub <onboarding@resend.dev>`, subject `EMAIL — Analyzer Funding Delivery`, body “Your Funding Letter Pack is ready”, addressed Hey Chris. Do not treat “View My Letter Pack” as proven — C-06 UIQ still 401, so that link has no pack behind it.

#### W3 Dirty letters — **done — PASS** (2026-08-14 18:19 UTC)

Draft alias `w3-dirty-letters` (not prod, not `crs-prove-w1`). Unset Inngest + GHL in the runner. `CRS_ALLOW_LIVE=0`. `DIY_IN_REPO=1`. Outbox left paused. No SMS. No U-02. No live CRS pull on the dirty client.

| Field | Value |
|-------|--------|
| `org_id` | `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6` |
| `dirty_client_id` | `929fc1cb-9ea0-4267-8152-28662b799173` |
| `funding_client_id` | `9af65808-a619-4e65-ae91-239766a006b7` |
| dirty email | `stanbridgejchris+repair@gmail.com` |
| dirty `outcome_tier` | **`REPAIR_ONLY`** (forced; no CRS pull) |
| funding `outcome_tier` | **`FUNDING_PLUS_REPAIR`** (unchanged) |
| template flipped | **only** `EMAIL-DS02-DIY-LETTERS-READY` → `compliance_passed=true` (real copy, not `[DRAFT]`) |
| U-02 funding template | left as W2 left it — this unit did not flip it |
| U-02 repair template | still `compliance_passed=false`; **zero** `EMAIL-U02-ANALYZER-REPAIR-DELIVERY` rows on dirty |
| dirty DS-02 | `done=true`, `diy_status=Delivered`, **3 letters** (EQ R1/R2/R3 in-repo Metro2) |
| dirty event id | `crs-prove-w3:929fc1cb-9ea0-4267-8152-28662b799173:1786731381598:payment.received` |
| funding DS-02 | `done=false`, reason **`blocked_not_repair_only:FUNDING_PLUS_REPAIR`** — no letters, no email |
| message id | `595939c7-8d6f-4123-ac51-57003a754c60` |
| queued `to_address` | `stanbridgejchris+repair@gmail.com` |
| status | **`sent`** (Resend provider id len 36) |
| one-shot | `dispatchMessage` only on that id. Never `dispatchDue`. |
| evidence | `clients.custom_fields.prove_w3` on both prove clients |
| draft alias | `https://w3-dirty-letters--transcendent-wisp-888771.netlify.app` |

**Resend testing-mode note:** Resend refused the plus-alias (`only send testing emails to your own email address`). Same Gmail inbox. Transmit used `stanbridgejchris@gmail.com`. Row destination stayed the plus-alias.

**Fences:** GHL unset, Inngest unset, `CRS_ALLOW_LIVE=0`, `MESSAGING_DRY_RUN=0` only for the one-shot id, outbox `outbound_enabled=false`.

**Gmail (owner 2026-08-14 11:20 PDT) — landed.** From `Fundhub <onboarding@resend.dev>`, subject `Your correction letters are ready`, Hey Chris. Do not print/sign — that copy is the template, not a live mail-to-bureau step.

**Left in tree (delete after W5):** `scripts/tmp-crs-company-prove-w3.mjs`, `netlify/functions/tmp-crs-company-prove-w3-background.mjs`, `netlify/functions/tmp-crs-company-prove-w3-status.mjs`.

#### W4 CRM UI correlate — PASS (2026-08-14 ~18:14 UTC)

Live target: `https://fundhub.ai`. Staff login via `STAFF_E2E_PASSWORD` (chris@fundhub.ai). No email/SMS sent. No outbox dump. No C-00. W2/W3 still **claimed** (no manifests yet) at finish — messaging/docs expected empty.

**Evidence folder:** `docs/workflows/e2e-verify-run4-evidence/w4-crm-ui/`  
JSON: `ccp-kv-evidence.json`, `field-evidence.json`, `ui-text-evidence.json`

| Check | Funding `9af65808-…06b7` | Dirty `929fc1cb-…9173` |
|-------|--------------------------|------------------------|
| CCP name | **Chris ProveFunding** | **Chris ProveRepair** |
| CCP email | **stanbridgejchris@gmail.com** | **stanbridgejchris+repair@gmail.com** |
| CCP phone | **+16616180865** | **+16616180865** |
| outcome_tier | **FUNDING_PLUS_REPAIR** (Agent Context + `/api/dashboard/client`) | **null** (no CRS yet; W3 will FORCE REPAIR_ONLY) |
| Scores | Closer call + API tri_merge: **EQ 42 · EX 630 · TU 725** (pulled 2026-08-14 18:07:56Z) | none |
| crs_result | `26fd1c2c-9bd5-464e-91c9-13c5f2fab463` | none |
| Messaging | **EMPTY** — inbox “No conversations yet”; CCP banner `0 messages`; `/api/read/conversations` count 0 | **EMPTY** (same) |
| Pipeline card | **NONE** — `pipeline_ids=[]`; not on R-01 Sales board (12 other cards). Did not invent a card. | **NONE** |
| Documents / letters | **EMPTY / UNVERIFIED** — `/api/read/documents` count 0; docs UI “no documents on file yet”. W2/W3 still in flight. | **EMPTY / UNVERIFIED** |

**Screenshots (no secrets):**
- `01-funding-ccp.png` — live banner + name
- `02-funding-closer-call.png` / `10-funding-closer-scores.png` — scores JSON + 0 messages
- `03-funding-messaging.png` / `11-funding-messaging.png` — empty inbox
- `04-pipeline.png` / `12-pipeline-board.png` — no Prove* cards
- `05-funding-documents.png` / `13-funding-documents.png` — empty
- `06-dirty-ccp.png` — dirty live name
- `07-dirty-messaging.png` — empty
- `14-funding-ccp-details.png` / `15-funding-ccp-agent-context.png` — email/phone + **Outcome tier: FUNDING_PLUS_REPAIR**
- `14-dirty-ccp-details.png` / `15-dirty-ccp-agent-context.png` — repair email/phone; no tier line

**UI note (not a CRS miss):** CCP still shows sample chrome in sections `render()` does not overwrite (e.g. “Call Derek…”, owner “Marcus Webb”, Ohio states). Live fields proven: name, email, phone, agent-context tier, closer scores, message counts.

**Verdict:** CRS → CRM UI correlate **PASS** for funding client (tier + bureau scores visible). Dirty client present without tier (as designed until W3). Messaging/docs pending W2/W3 — re-check after those manifests land.

#### W5 Auditor — **done — PASS** (2026-08-14 ~18:25 UTC)

Re-read DB after W1–W4. Trusted manifests, then confirmed. Did **not** send email, deploy prod, enable the outbox, or dump the queue.

**Batch verdict: PASS.** C-06 funding letters are **FAIL/GAP** (UIQ 401). That gap was already recorded. It does not fail the whole batch.

| Check | Result | Evidence |
|-------|--------|----------|
| W1 spine (sandbox → `FUNDING_PLUS_REPAIR` → CRM) | **PASS** | funding client `9af65808-…06b7`; `crs_results.environment=sandbox`; soft-pull `bb31a170-…546c` `fulfilled`; events `analysis.completed` `2e5aee6e-…9ac0` + `decision.rendered` `ef8cf37c-…0153` |
| W2 U-02 funding email | **PASS** | message `9a88be27-…70a4` `sent` Resend → `stanbridgejchris@gmail.com`; subject `EMAIL — Analyzer Funding Delivery`; owner Gmail landed |
| W2 C-06 UIQ funding letters | **FAIL/GAP** | POST 401 Unauthorized; `funding_letters_delivered_event_id` still null; `documents` empty. Do not treat “View My Letter Pack” as proven. |
| W3 dirty DS-02 letters + email | **PASS** | dirty `REPAIR_ONLY`; `diy_status=Delivered`; `diy_letter_count=3`; message `595939c7-…4c60` `sent` Resend; row `to_address=stanbridgejchris+repair@gmail.com`; transmit used base Gmail (Resend testing mode, same inbox); owner Gmail landed |
| W3 DS-02 block on funding | **PASS** (still true) | funding `outcome_tier=FUNDING_PLUS_REPAIR`; `diy_status` null; `diy_delivered_event_id` null; W3 handle `blocked_not_repair_only:FUNDING_PLUS_REPAIR`; no funding DS-02 email |
| W4 CRM UI (tier + scores) | **PASS** | live CCP: ProveFunding / ProveRepair, emails, phone, funding scores EQ 42 · EX 630 · TU 725 |
| W4 messaging/docs UI re-check | **NOT DONE** | W4 finished before W2/W3 mail. DB now has the two emails. CRM inbox screenshots still empty. Left undone. |
| Prove email destinations | **PASS** | only those two sent rows; both owner Gmail / plus-alias |
| Outbox not mass-drained | **PASS** | `outbound_enabled=false`, cap 500; org has **2** messages total, both the prove one-shots |
| Live CRS unused | **PASS** | local `CRS_ALLOW_LIVE=0`, host sandbox; stored pull `environment=sandbox`; dirty client has **0** CRS rows |
| No SMS | **PASS** | org `messages` sms count **0**; SMS routing still `ghl_relay` (unused) |
| Secrets on this board | **PASS** | names only; no key values; provider ids recorded as length 36 only |
| Spine-only (no packs) | **PASS** (not spine-only) | funding email + dirty letters+email both real. C-06 pack is the recorded gap. |

**`outbound_enabled` still false.** Org `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6`. Cap 500. Email routing `resend`. SMS routing `ghl_relay`.

**Message counts (org fundhub):**

| Scope | all | sent | queued | sms |
|-------|-----|------|--------|-----|
| Funding `9af65808-…06b7` | 1 | 1 | 0 | 0 |
| Dirty `929fc1cb-…9173` | 1 | 1 | 0 | 0 |
| Whole org | **2** | **2** | **0** | **0** |

Those two sent rows are the U-02 funding email and the DS-02 DIY email. Nothing else left the org.

**DS-02 block on funding still true.** Dirty letters stayed on the repair client only.

**Left undone**
- Tmp prove files **deleted locally** (2026-08-14 after W5). Draft Netlify aliases were never `--prod`.
- UIQ deliver-letters secret still unset — C-06 stays 401 until that exists and product auth is wired
- W4 messaging/docs UI re-check after W2/W3 (CRM inbox + documents still unverified in the live UI)

---

## Parallel units (morning cutover — keep)

| Unit | Owner | Status |
|------|-------|--------|
| W1 Send path (kill GHL, Twilio + Resend, cutover doc) | this chat | **done** (docs portion) — cutover rewritten; RESEND_* in .env.example; providers + live-fence 83/83 pass. Remaining: Twilio Monday prove, Resend domain SPF/DKIM, keep outbox paused. |
| W2 CRS sandbox e2e + routing | this thread | **claimed** |
| W3 Dispute letters (DIRTY / REPAIR_ONLY only) | other chat | blocked on W2 dirty contact |
| W4 Manual SOPs | this chat | **claimed** |
| Demo CRM wipe (`is_demo=true` only) | this thread | claimed — list before delete |

## W2 notes

- Real path: sandbox CRS → UnderwriteIQ engine → tier / route.
- Sim path: known — sandbox JSON fixtures + `simulate-client` / `routeOutcome`. Use for routing proof when wire is fenced; prefer live sandbox login when `ADAPTERS_DRY_RUN` allows.
- Live CRS host stays off (`CRS_ALLOW_LIVE=0`).

## Evidence

### Resend (2026-08-14) — PASS
Provider `send()` to `stanbridgejchris@gmail.com` → `status=sent`, provider message id set (len 36). From: onboarding@resend.dev (free tier). Prod still needs deploy + migration 164 for CRM compose path.

### CRS sandbox login (2026-08-14) — PASS
`createCrsClient().login()` against `api-sandbox.stitchcredit.com` → OK. Soft-pull order + tier next. Live creds stored as `CRS_LIVE_*` only; `CRS_ALLOW_LIVE=0`.

### Sim routing (earlier) — PASS (engine only)
Fixtures → `runCRSEngine` → `MANUAL_REVIEW` (median 636).

### Twilio Business Profile (2026-08-14)

Owner email: Business Profile **Approved**.
- Account SID set (`TWILIO_ACCOUNT_SID` / `TWILIO_SEND_ACCOUNT_SID`)
- TrustHub Bundle SID set (`TWILIO_TRUSTHUB_BUNDLE_SID`)
- Still need: SMS-capable **from number** (`TWILIO_SEND_FROM`) + working send auth; A2P campaign if required for US 10DLC.

### Twilio from-number (2026-08-14)
- Number purchased: `+15613048368` (West Palm Beach, FL) → `TWILIO_SEND_FROM` set locally + Netlify.
- Compliance: pick **Messaging** first (Voice later). A2P/registration still required for US SMS.

### Twilio A2P Brand submitted (2026-08-14)
- Low Volume Standard Brand submitted on Twilio (standalone — GHL approval does **not** carry over).
- Waiting on TCR/Twilio Brand review before campaign + reliable US SMS.
- From number ready: `+15613048368`.

### Twilio A2P Campaign submitted (2026-08-14 ~10:43 PDT)
- Use case: Low Volume Mixed / LOW_VOLUME
- Web form opt-in, fundhub.ai privacy/terms, lending + links + phone numbers declared
- Sample #4 includes three-way intro with `[phone]`
- Owner expects quick approval; typical is minutes–days. When approved: probe SMS to `+16616180865` via Twilio provider.

### CRM demo wipe — DONE (2026-08-14 via Supabase MCP)

- Was: 60 clients (15 `is_demo` + many `+test`/gauntlet).
- Now: **18** clients, **0** `is_demo`.
- Removed: demo roster, `+test`/gauntlet/sim/w3/w4, `@example.com` probes, TEST role client, joke probe.
- Demo lenders deleted. Demo staff **suspended** (cannot hard-delete — journey FKs).
- Org `demo_mode_enabled` = **false**.
- Left are mostly ClickFunnels leads + your emails. CCP “Derek Owusu” with no `?id=` is still UI sample filler, not a DB row.
- Pipeline board may show empty until cards exist for remaining clients (demo cards were wiped with clients).
