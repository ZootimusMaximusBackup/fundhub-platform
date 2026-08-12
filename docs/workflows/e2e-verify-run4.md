# E2E Verify Run 4 — shared board

**Status:** W0–W5 done · Commas Track D **PASS-synthetic** · **W2 Demo flip done (PASS)** · **W3 RUN4 resume done (PASS)**
**Branch / SHA:** `main` @ `ae7a537` (flip `a7f427f`, restore guard)
**Mode:** observe-only except shipped Track D + demo flip / setDemoMode RETURNING fix. Never weaken verification.
**Docs posture:** `AUDIT-FINDINGS.md` / `HANDOFF.md` = failure *shapes* only. Current truth = code on this SHA + live probes below.

### Owner answers (2026-08-12) — FINAL

1. Canonical URL: **https://fundhub.ai**
2. `CLICKFUNNELS_WEBHOOK_SECRET` on Netlify: **YES**
3. Matches CF 2.0 settings: **UNKNOWN** — W1 verifies; mismatch → update CF to match Netlify, never weaken verify
4. CF POSTing to `/api/webhooks/clickfunnels`: **YES** — CF endpoint “Fundhub platform” confirmed (screenshot on file). Secret match still UNKNOWN — W1 verifies signature acceptance with a real payload first
5. `COMMAS_WEBHOOK_SECRET`: **YES**
6. `COMMAS_CHECKOUT_BASE_URL`: **NO** — Chris will set; W3 flags tests blocked on it
7. W3 may create test Commas payment / signed replay: **YES**
8. `INNGEST_EVENT_KEY`: **YES — LIVE**. Load-bearing: **no thread emits real Inngest events** outside dry-run paths
9. `MESSAGING_DRY_RUN=1` for all of Run 4: **YES**
10. Logins: use existing seeded staff/demo accounts in DB
11. `app.fundhub.ai`: **ignore**
12. Pending migrations: **LEAVE UNTOUCHED**; list both by name in report as ranked blocker

---

## Task list

| Unit | Owner | Status |
|------|-------|--------|
| W0 Ground (inventory + owner pack + evidence schema) | W0 session | **done** |
| W1 Funnel seam (ClickFunnels → thank-you) | parallel agent | **done** |
| W2 Client journey / routing law | parallel agent | **done** |
| W3 Money + UnderwriteIQ | parallel agent | **done** |
| W4 Screens / auth / LIVE rest + transmit size | parallel agent | **done** |
| W5 Report merge → `E2E-REPORT.md` | W5 session | **done** |
| W2 Demo flip (orgs.demo_mode_enabled off + verify) | parallel agent | **done** |
| W3 RUN4 resume (after demo off) | parallel agent | **done** |
| W4 Apply migrations 160/161 (scratch → prod) | — | **W4a PASS** · prod apply **queued — wait owner go** |

### W4 migrations 160/161 — queued (2026-08-12)

**Do not apply yet.** RUN4 resume is **done**; still waiting on owner **go**.

**Why they were blockers:** never-applied pending files (health `pending:2`). Owner left them untouched during Run 4.

**160 `metro2_dispute_engine`:** additive `CREATE TABLE IF NOT EXISTS` (furnisher_mail_addresses, dispute_cases/items/letters/responses, repair_decision_log) + idempotent seed `INSERT` of furnisher addresses. FK `ON DELETE CASCADE` / `SET NULL` define future delete behavior only — no `DROP`/`DELETE`/`UPDATE` of existing rows.

**161 `optimization_repair_pipeline`:** inserts new optimization stages (idempotent), then **data-modifying `UPDATE`s**:
1. Remap cards from old stage keys (`round_sent`→`in_transit`, `bureau_processing`→`awaiting_response`, `portal_updated`→`response_received`, `upgrade_invite`→`program_complete`)
2. Bump old stage `sort_order` to 900+ (hide from boards; keep rows)

**Owner decisions (2026-08-12) — recorded:**
- **161 UPDATEs: APPROVED**
- **W4a smoke condition:** card-count-per-stage **before and after** remap; **flag** any card whose stage is not one of the intended new keys
- **Neon:** create branch via Neon if agent has access; else owner hands connection string
- **Still gated** on owner **go** (do not start apply without it)

**Neon access:** no Neon MCP, no `neon`/`neonctl` CLI, no local Neon credentials. Agent **cannot** create a Neon branch. Owner: create branch + paste connection string (never commit it).

Protocol: claim before work; write manifest when done; coordinate only through this file.

### Track D money (2026-08-12) — already shipped
- Webhook `24702` → fundhub.ai; `COMMAS_API_KEY` + secret set; migration 162; synthetic envelope **PASS-synthetic** (`ORD-SYNTH-C18117792FFE`). Live $1 skipped. Pay-links create still 503 (ticketed).

---

## Owner pack (built from repo + live probe; Netlify CLI unavailable)

| Item | Value / source | Confidence |
|------|----------------|------------|
| Netlify team | `zootimusmaximusbackup` (`CLAUDE.md` §11) | doc |
| Netlify site slug | `transcendent-wisp-888771` (`CLAUDE.md` §11) | doc |
| Deployed API/base URL (proven) | `https://transcendent-wisp-888771.netlify.app` — `GET /api/health` → **200**, body `db:"up"` | **live probe 2026-08-12** |
| Custom domain (proven) | `https://fundhub.ai` — same `/api/health` shape, **200** | **live probe** |
| Funnel domain | `https://apply.fundhub.ai/watch` → **200** (ClickFunnels host, not this repo) | **live probe** |
| `app.fundhub.ai` | connect failed from this environment (`000`) | unknown / OWNER Q |
| Supabase project ref | `oqpnlusrotpxfenysfxz` (Postgres, session pooler, us-west-2) — `CLAUDE.md` §11 | doc |
| `DATABASE_URL` source | **Netlify env** contexts production / deploy-preview / branch-deploy. Local: copy `.env.example` → `.env`. Migrations use `MIGRATION_DATABASE_URL`. | doc + live health proves a DB is wired |
| Live DB health note | `state:"behind"`, `migrations":142`, `pending":2` — DB answers but migration guard says 2 pending. Do not “fix” in W0. | **live probe** |
| `CLICKFUNNELS_WEBHOOK_SECRET` on Netlify | **NOT CONFIRMED** — `netlify` CLI not on PATH; `npx netlify-cli` hung / no auth in this env. Router expects header `x-clickfunnels-signature` + env `CLICKFUNNELS_WEBHOOK_SECRET` (`src/http/router.mjs`). | OWNER Q |
| Commas keys (location) | **Netlify env (intended):** `COMMAS_WEBHOOK_SECRET`, `COMMAS_CHECKOUT_BASE_URL` (required for payment-link URL build). Optional recon: `COMMAS_API_KEY` (docs). Spec: `docs/PAYMENT-LINKS-SPEC.md`, `docs/STILL-MISSING.md`. **Not** listed in root `.env.example` (webhook secrets called out in `DEPLOY.md` as “add later”). Adapter: `src/adapters/commas.mjs` (`buildCommasCheckoutUrl`). | docs — values unseen |
| Inngest | `/api/inngest` routed. `INNGEST_EVENT_KEY` = owner gate (`CLAUDE.md` §11). Status board `docs/workflows/status-mailgun-sms-ct-closer.md` (2026-08-10) claimed key **SET** and `MESSAGING_DRY_RUN=1`. Re-confirm; **do not flip dry-run** without owner. | mixed |
| Mailgun signing | Status board claimed `MAILGUN_SIGNING_KEY` SET (len 32). Confirm by name only. | prior status |
| Demo mode | `api/demo/*` + login demo roster — **counts as not-real** for pass/fail. | rule |

### Owner questions (Chris — answer yes/no where possible)

1. Is the staff/CRM URL you want tested `https://fundhub.ai` (custom) or only `https://transcendent-wisp-888771.netlify.app`?
2. Is `CLICKFUNNELS_WEBHOOK_SECRET` set on Netlify production? (yes/no)
3. Does that secret match the value in the ClickFunnels 2.0 webhook settings? (yes/no / unknown)
4. Is CF already POSTing to `https://fundhub.ai/api/webhooks/clickfunnels` (or the netlify.app twin)? (yes/no)
5. Is `COMMAS_WEBHOOK_SECRET` set on Netlify production? (yes/no)
6. Is `COMMAS_CHECKOUT_BASE_URL` set to a real Commas checkout base? (yes/no)
7. May W3 create a **test** Commas payment / signed webhook replay? (yes/no)
8. Is `INNGEST_EVENT_KEY` currently set on production? (yes/no)
9. Keep `MESSAGING_DRY_RUN=1` for this whole Run 4? (yes/no — recommend yes)
10. Can W1–W4 use demo staff passwords / magic links already in the DB, or will you paste five role credentials?
11. Is `app.fundhub.ai` supposed to resolve? (yes/no / ignore)
12. OK to leave the two pending migrations untouched during Run 4? (yes/no)

---

## Evidence schema (mandatory for W1–W5)

Every feature row in manifests / `E2E-REPORT.md`:

| Field | Meaning |
|-------|---------|
| `id` | Stable id: `api:<route>` / `screen:<path>` / `wh:<provider>` / `wf:<id>` |
| `claim` | What “real” means in one sentence |
| `class` | LIVE / BETA-STUB / DEAD (from this inventory; reclassify only with evidence) |
| `probe` | Exact method (curl URL, Playwright path, SQL, file open) |
| `auth` | Session/role used — never demo-as-pass |
| `evidence` | Path to screenshot / response snippet / row UUID / artifact |
| `verdict` | PASS / FAIL / BETA-EXCLUDED / DEAD / BLOCKED |
| `blast` | What breaks for ad launch if FAIL |

**Pass bar (from Run 4 charter):** deployed Netlify + real auth; writes visible in Supabase reads; DOM shows data and survives filters/sorts/tabs; files open; events idempotent on replay. Demo = not-real.

---

## Explicit exclusions (not in pass/fail)

| Item | Why | Blast radius |
|------|-----|--------------|
| `api/demo/*`, demo login switcher | Demo mode = not-real | Can hide broken staff auth if mistaken for pass |
| Outbound transmit to real clients | `MESSAGING_DRY_RUN` + provider gates; size in W4, do not enable | Booking mail may ride CF/Google today; platform reminders may be missing |
| CT-series workflows | Deferred — no `src/workflows/ct-*.mjs` | Repair checkout automation absent |
| `src/mail/` drop | Deliberately no send path (FCRA / counsel) | Prescreen mail never drops |
| Enabling `INNGEST_EVENT_KEY` / flipping dry-run | Owner-only (`CLAUDE.md` §11) | Wakes 50 registered functions / real sends |

---

## Failure shapes to hunt (from AUDIT/HANDOFF — not current defect list)

1. Green unit tests over dead seams (fakes that do not move with Postgres).
2. Structural presence ≠ live (adapter tested, never registered — lendflow was the lesson; it **is** registered now — still verify live).
3. Absent config must never mean open gate (`api/dashboard/*` unset-secret hole — prove stays fixed).
4. Banner “live” + sample after filter (seven-screens lesson).
5. Webhook body/stream / signature header name mismatches (Commas multi-header; CF header must match reality).

---

## Live probe log (W0)

| Probe | Result |
|-------|--------|
| `GET https://transcendent-wisp-888771.netlify.app/api/health` | 200 `db:up` `state:behind` `pending:2` |
| `GET https://fundhub.ai/api/health` | 200 same shape |
| `GET https://apply.fundhub.ai/watch` | 200 |
| `GET https://app.fundhub.ai/` | failed from this host |
| Netlify CLI `env:list` | **unavailable** (`netlify` not installed; npx hung) |

---

## Webhook providers (`src/http/router.mjs`)

Entry: `/api/webhooks/:provider` → `api/webhooks/[provider].mjs` → `handleWebhook`.

| Provider id | Signature / secret env | Class | Notes |
|-------------|------------------------|-------|-------|
| `commas` | `COMMAS_SIG_HEADERS` (incl. `x-webhook-signature`) / `COMMAS_WEBHOOK_SECRET` | LIVE | Payment path; sweeper `commas-inbox-sweeper` cron `* * * * *` |
| `clickfunnels` | `x-clickfunnels-signature` / `CLICKFUNNELS_WEBHOOK_SECRET` | LIVE | Funnel seam — W1 |
| `bland` | `x-bland-signature` / `BLAND_WEBHOOK_SECRET` | LIVE | Voice |
| `calcom` | `x-cal-signature-256` / `CALCOM_WEBHOOK_SECRET` | LIVE | Bookings (platform may also use CF scheduler) |
| `lendflow` | lendflow header / `LENDFLOW_WEBHOOK_SECRET` | LIVE | Was DEAD historically; **now in STD table** — verify live |
| `inquiry-removal` | inquiry header / `INQUIRY_REMOVAL_WEBHOOK_SECRET` | LIVE | IRA bridge |
| `twilio` | `x-twilio-signature` / `TWILIO_AUTH_TOKEN` | LIVE | Inbound SMS |
| `twilio-status` | same | LIVE | Delivery status |
| `mailgun` | body sig / `MAILGUN_SIGNING_KEY` | LIVE | Bank inbox |
| `mailgun-events` | same | LIVE | Delivery events |
| `postgrid` | `verifyMailWebhook` / mail-letter env | LIVE | Letter delivery → call clock |

Twilio/Mailgun “handled elsewhere” in charter: still listed here; W4 confirms ops status, W1 does not own them.

---

## Inngest workflows

**Registered** in `src/workflows/index.mjs` `functions` (**50**) → `api/inngest.mjs` → `/api/inngest`.

| Workflow id | Class | Registration | Runtime note |
|-------------|-------|--------------|--------------|
| `af-02-referral-ownership-capture` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `ai-set-03-no-answer-cadence` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `ai-set-04-3way-handoff` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `at-01-first-touch-capture` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `bc-01-customer-responsiveness` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `bc-02-customer-friction` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `bs-01-precall-launcher` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `contract-chaser` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `message-dispatch-sweeper` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `c-00-crs-soft-pull-request` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `c-02-inquiry-created` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `c-02b-inquiry-removal-requested` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `c-03-inquiry-removed-resume-or-hold` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `c-05-pre-funding-review` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `c-06-crs-results-router` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `dpc-01-analyzer-lock` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `dpc-02-call-outcome-enforcement` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `dpc-03-inbound-reply-router` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `dpc-05-no-progress-escalation` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `ds-01-repair-referral` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `ds-02-diy-letters` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-01-funding-intake` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-02-portal-id-missing` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-03-round-submitted` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-04-round-approvals` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-05-inquiry-cleanup-gate` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-06-funding-conditions-missing-docs` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-07-funding-locked` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-08-post-funding-monitoring` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-09-funding-declined-no-path` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-10-client-funding-inbox-provisioner` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `f-11-bank-email-event-router` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `n-01-cold-nurture` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `n-02-warm-nurture` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `n-03-hot-nurture` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `n-04-post-funding-nurture` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `n-06-renewal-second-wave` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `round-started-client-notify` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `s-01-new-lead-intake` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `s-02-incomplete-survey-nudge` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `s-04-call-booked` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `s-05a-no-show-recovery` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `s-06-post-call-funding-purchased` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `s-08-post-call-funding-declined` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `sys-01-client-value-calculator` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `sys-01-ltv-calculator` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `u-02-analyzer-complete-delivery` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `u-03-crs-snapshot-sync` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `u-04-promote-crs-primary` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |
| `u-05-data-health-monitor` | LIVE | in `src/workflows/index.mjs` `functions` → served by `/api/inngest` | Runtime gated by `INNGEST_EVENT_KEY` (owner flip). Status board 2026-08-10 claimed key SET + `MESSAGING_DRY_RUN=1`. Confirm, do not flip dry-run. |

### Defined Inngest function, **not** in `functions` array → DEAD

| Workflow id | Class | Evidence |
|-------------|-------|----------|
| `inquiry-call-sweeper` | DEAD | `src/workflows/inquiry-call-sweeper.mjs` exports `inquiryCallSweeper`; docs/`inquiry-gate-v2.md` + not imported in `index.mjs` |

### Helper modules under `src/workflows/` (not Inngest functions — not LIVE/DEAD units)

`cards.mjs`, `client.mjs`, `custom-fields.mjs`, `messaging.mjs`, `tags.mjs`, `templates-seed.mjs`, `test-support.mjs`, `index.mjs`

### Netlify cron (not Inngest; still production callers)

| Function | Schedule | Class |
|----------|----------|-------|
| `staff-message-sweeper` | `*/5` | LIVE (drain path; dry-run may no-op transmit) |
| `social-publish-sweeper` | `*/5` | LIVE |
| `creative-job-runner` | `*/2` | LIVE |
| `hubstaff-poll-sweeper` | `*/10` | LIVE |
| `commas-inbox-sweeper` | `* * * * *` | LIVE |

---

## API inventory (every `api/**/*.mjs` — 139 files, no sampling)

`ALLOWED_UNROUTED` in `src/http/routes.test.mjs` is **empty** — every handler file is reachable by ROUTES key or prefix (`webhooks/`, `documents/`, `inngest`). Structural reachability ≠ verified-real.

| File | Class | Routing / note |
|------|-------|----------------|
| `api/agents.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/ai-bureau-config.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/applications.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/auth/admin-reset.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/auth/login.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/auth/logout.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/auth/magic-link-verify.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/auth/magic-link.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/auth/reset.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/auth/session.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/banking/accounts.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/banking/revoke.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/banking/sync-accounts.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/call-outcomes.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/campaigns/action-log.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/campaigns/connections.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/campaigns/detail.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/campaigns/fatigue.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/campaigns/list.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/campaigns/spend.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/campaigns/sync.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/campaigns/write.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/chat/ask.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/chat/messages.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/chat/peers.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/chat/portal-message.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/company-brain/reviews.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/consent/capture.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/contracts.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/contracts/sign.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/creative/actions.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/creative/approvals.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/creative/brand-kits.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/creative/generate.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/creative/jobs.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/creative/library.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/creative/run.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/dashboard/client.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/dashboard/clients.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/dashboard/kpis.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/dashboard/pipeline.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/dashboard/seed.mjs` | BETA-STUB | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/demo/mode.mjs` | BETA-STUB | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/demo/simulate.mjs` | BETA-STUB | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/documents-upload.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/documents/[id].mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/alerts.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/bank-accounts.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/bills.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/cards.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/cashflow.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/entities.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/liabilities.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/model.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/soft-pull.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/finance/subscriptions.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/health.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/hiring/application.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/hiring/bench.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/hiring/candidates.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/hiring/decisions.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/hiring/funnel.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/hiring/postings.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/inngest.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/inquiries.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/inquiry-cases.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/inquiry.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/journeys.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/journeys/ask.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/journeys/run.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/lender-observations.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/lenders.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/marketing-flags.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/message-templates.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/messages-outbound.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/messages.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/org-brand.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/partner-brand.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/partner-brand/verify-domain.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/partner-pages.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/payment-links.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/pii.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/pipeline-cards.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/privacy/erasure.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/products.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/proxy/end.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/proxy/launch.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/public/partner-page.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/affiliates.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/agent-context.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/agent-shadow-log.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/agents.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/ai-bureau-config.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/banking-surface.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/call-outcomes.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/closer-call.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/commissions.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/company-activity.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/company-brain-affiliate.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/company-brain.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/contracts.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/conversations.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/documents.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/entitlements.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/failed-events.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/finance-ask.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/finance-command.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/finance-os.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/funding-rounds.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/inbox.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/inquiries.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/inquiry-cases.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/invoices.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/lender-matches.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/lender-observations.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/lenders.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/message-templates.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/messages.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/money-map.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/my-numbers.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/partners.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/products.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/proxy-sessions.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/sales-floor.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/search.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/staff.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/tradelines.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/transactions.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/underwrite.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/read/workflows.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/repair/exceptions.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/shifts.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/social/oauth.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/social/publish.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/social/schedule.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/staff/monitoring-consent.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/staff/telemetry.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/tasks.mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |
| `api/webhooks/[provider].mjs` | LIVE | routed via netlify/functions/api.mjs ROUTES or prefix (webhooks/, documents/, inngest) |

**BETA-STUB API callouts:** `api/demo/mode.mjs`, `api/demo/simulate.mjs`, `api/dashboard/seed.mjs` (seed/demo path). Ambiguous finance/creative/hiring/social kept **LIVE** so W3/W4 fail honestly if shells/501s remain.

---

## Screen inventory (every `public/**/*.html` — 52 files)

| File | Class | Note |
|------|-------|------|
| `public/404.html` | LIVE | error page |
| `public/affiliates/index.html` | LIVE | static marketing/legal |
| `public/app/affiliate.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/agent-editor.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/automations.html` | BETA-STUB | HANDOFF: no workflow-run history table |
| `public/app/brand-studio.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/calendar.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/campaign-manager.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/client-control-panel.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/client-portal.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/closer-call.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/closer-dashboard.html` | LIVE | HANDOFF listed sample; status board hybrid DONE — VERIFY as LIVE |
| `public/app/command-center.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/company-brain.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/consent-capture.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/content-admin.html` | BETA-STUB | HANDOFF: no write path / incomplete catalog |
| `public/app/contracts.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/creative-factory.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/documents.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/finance-os.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/galaxy.html` | BETA-STUB | HANDOFF: graph layout has no source |
| `public/app/hiring.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/index.html` | LIVE | router only (renders nothing; still in request path) |
| `public/app/inquiry-remover.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/journeys.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/lenders.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/messaging.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/my-numbers.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/ops-admin.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/partner-galaxy.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/pipeline.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/products-commissions.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/sales-floor.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/sample-data.html` | BETA-STUB | demo data manager by design |
| `public/app/sidebar.fragment.html` | LIVE | fragment include, not a route screen |
| `public/app/social-studio.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/staff-teams.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/subscriptions.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/app/template-editor.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/contract.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/crm.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/dashboard.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/education/index.html` | LIVE | static marketing/legal |
| `public/education/privacy/index.html` | LIVE | static marketing/legal |
| `public/education/refund/index.html` | LIVE | static marketing/legal |
| `public/education/terms/index.html` | LIVE | static marketing/legal |
| `public/index.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/login.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/portal-login.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/privacy/index.html` | LIVE | static marketing/legal |
| `public/reset-password.html` | LIVE | in publish tree; treat as LIVE until proven otherwise |
| `public/terms/index.html` | LIVE | static marketing/legal |

---

## Suggested ownership (for claim)

| Thread | Owns from this inventory |
|--------|--------------------------|
| W1 | `wh:clickfunnels`, CF thank-you / calendar (apply.fundhub — external), adapter shapes |
| W2 | client land + DS-02 / funding route + appointment same-row (depends on W1 evidence or owner fixtures) |
| W3 | products, entitlements, payment-links, commas, invoices, commissions, underwrite, lender-matches, funding-rounds |
| W4 | auth/*, dashboard/* anonymous refuse, CRM/portal screens, documents, inquiry*, journeys, chat/agent-context, pipeline/tasks/shifts/call-outcomes, proxy once, e2e specs on deploy, transmit gap size, remaining LIVE |

---

## Change / ticket manifests

### W1 Funnel seam — change manifest (2026-08-12)

| Field | Value |
|-------|-------|
| Code changes | **none** — allowlisted `normalizeClickFunnelsEvent` path fix **not** applied (no real CF payload shapes captured) |
| Banner | “guessed paths” banner **kept** in `src/adapters/clickfunnels.mjs` |
| Files touched | board + evidence only under `docs/workflows/e2e-verify-run4-evidence/w1/` |
| Inngest | **no** real emits (did not POST a signed body with email) |
| Migrations | untouched |
| `MESSAGING_DRY_RUN` | not flipped (prod = `1`) |

### W3 Money + UnderwriteIQ — change manifest (2026-08-12)

| Field | Value |
|-------|-------|
| Code changes | **none** (observe-only) |
| Test data created | two +test clients via `POST /api/contracts` `create_client` (`w3run4+test…@fundhub.ai`) |
| Commas signed replay | attempted (signature accepted; inbox write failed) |
| Inngest | **no** real emits |
| Migrations | untouched (`160`/`161` still pending) |
| `MESSAGING_DRY_RUN` | not flipped (prod = `1`) |
| `COMMAS_CHECKOUT_BASE_URL` | **absent** on Netlify production (confirmed `env:list`) |

## Blockers for ad launch (seed — expand in W5)

1. **W1 — CF↔Netlify secret acceptance unproven; prod has zero ClickFunnels bus events** — ad traffic may never land. Owner must paste `CLICKFUNNELS_WEBHOOK_SECRET` **or** authorize rotate + update CF webhook secret to match Netlify + one deploy, then re-probe.
2. Live DB `pending:2` — **named:** `migrations/160_metro2_dispute_engine.sql`, `migrations/161_optimization_repair_pipeline.sql` (leave untouched).
3. Transmit gap — platform booking confirm + appointment reminders **missing**; `MESSAGING_DRY_RUN=1` blocks all client sends (W4 sized below).
4. `inquiry-call-sweeper` DEAD — scheduled inquiry calls will not fire via Inngest.
5. **Staff session credentials unavailable** — `DEMO_LOGINS_ENABLED` absent/off; `STAFF_INITIAL_PASSWORD` absent from Netlify; prod `DATABASE_URL` masked via Netlify CLI. Blocks CRM row survival / RBAC / write→read / proxy / documents / journeys live. *(W3 note: seeded `owner@fundhub.ai` + known role-test password worked for money/underwrite probes.)*
6. **W3 — `COMMAS_CHECKOUT_BASE_URL` unset** — `POST /api/payment-links` create returns **503** `commas_not_configured`. Chris must set a real Commas checkout base, then one deploy.
7. **W3 — Commas inbox cannot write** — `commas_inbox` has **RLS on + zero policies** (only such table). Signed webhook → **500** `inbox_write_failed`; inbox count **0**; invoices **0**. Payments cannot land until policies (or RLS off for app role) exist — observe-only, not fixed here.
8. **W3 — lender catalog is 100% demo** — `lenders` = 7 rows, all `is_demo=true`. `lender-matches` engine runs but only against DEMO fixtures.

---

## W1 Funnel seam (ClickFunnels → thank-you) — manifest (2026-08-12)

**Owner:** W1 session · **Mode:** observe-only (allowlisted adapter fix **not** used) · **Code changes:** none  
**Canonical API:** `https://fundhub.ai` · **Funnel:** `https://apply.fundhub.ai`  
**Inngest:** no real events emitted.  
**Test aliases:** thank-you probe used `w1.run4+test@gmail.com` in localStorage only (no webhook write).

### Signature path (code)

| Check | Result |
|-------|--------|
| Router | `src/http/router.mjs` STD `clickfunnels` → `sig: "x-clickfunnels-signature"`, `env: "CLICKFUNNELS_WEBHOOK_SECRET"` |
| Verify | `verifyClickFunnelsSignature` HMAC-SHA256 of raw body; fail-closed if secret/header missing; accepts optional `sha256=` prefix |
| Capture gate | `CF_CAPTURE_MODE` **UNSET** on Netlify → no `webhook_captures` inserts in prod |

### Real CF shapes (documented — still guessed)

No live CF delivery body captured. `webhook_captures` count on prod = **0**. Adapter still uses best-effort paths from unit fixtures:

| Kind | Fixture event type | Contact path | Answers / slot paths |
|------|--------------------|--------------|----------------------|
| Survey / form | `form_submission` / contact events | `data.contact` (email / first_name / last_name / phone) | `data.survey_answers` or `data.formData` / `answers` / `fields` / `custom_fields` |
| Appointment created | `appointments/scheduled_event.created` | `data.primary_contact` (`email_address`, names, `phone_number`) | `data.start_on` / `end_on` / `tzid` / `event_type.name` |

**Do not treat as live-confirmed.** Banner remains.

### Evidence table

| id | claim | class | probe | auth | evidence | verdict | blast |
|----|-------|-------|-------|------|----------|---------|-------|
| `wh:clickfunnels` fail-closed | Missing/bad signature refused | LIVE | `POST https://fundhub.ai/api/webhooks/clickfunnels` no header; then `x-clickfunnels-signature: deadbeef` | none | `docs/workflows/e2e-verify-run4-evidence/w1/nosig.body` + `badsig.body` → `401` `bad_signature` `emitted:[]` | **PASS** | Open webhook = fake leads |
| `wh:clickfunnels` sig accept | Valid HMAC accepted (secret match) | LIVE | Need Netlify secret to sign **no-email** body (safe: no emit) | secret | Netlify `env:get` / `dev:exec --context production` inject **masked** `********…4f97` (len 20). Cannot sign. | **BLOCKED** | Cannot prove CF↔Netlify match |
| `wh:clickfunnels` prod land | Successful CF deliveries write bus events | LIVE | SQL prod: `events` where `idempotency_key like 'clickfunnels:%'` or `payload->>'source'='clickfunnels'`; `webhook_captures` | DB | **0** CF events; **0** captures; events table total **5** (demo + one CRS). | **FAIL** | Ads never land in CRM / journeys |
| `wh:clickfunnels` real payload shapes | One real survey + one appointment payload vs `normalizeClickFunnelsEvent` | LIVE | CF delivery / capture | — | None available; `CF_CAPTURE_MODE` unset | **BLOCKED** | Wrong field paths → empty email / wrong booking |
| `wh:clickfunnels` idempotency replay | Re-POST same signed body dedupes | LIVE | Replay after first accept | secret | Not run — blocked on signature acceptance (would also risk Inngest if email present) | **BLOCKED** | Duplicate clients / double journeys |
| `screen:thank-you` calendar | Exact slot + Google `dates=` + valid `.ics` | LIVE | Playwright `https://apply.fundhub.ai/thank-you` + `fh_booking_v1` | none (page) | `thank-you-probe.json`: CTA `is-on`, `dates=20260820T160000Z/20260820T163000Z` matches slot, `.ics` `BEGIN:VCALENDAR`/`VEVENT` valid; screenshots + ics in evidence dir | **PASS** | Booked clients cannot add calendar |
| `screen:thank-you` no booking | Without handoff, calendar CTA stays off | LIVE | Same URL, empty storage | none | `thank-you-no-booking.json`: `calCtaOn:false` | **PASS** | — |

### Owner action (required to unblock ingress)

Netlify marks `CLICKFUNNELS_WEBHOOK_SECRET` as `is_secret` — CLI/API/`dev:exec` only return masked values. Pick **one**:

1. **Paste** the production secret (or CF webhook signing secret) to W1 — then W1 signs a **no-email** JSON body, expects `200` `no_email` (proves accept without Inngest), then enables capture / +test survey+appointment under dry-run rules.  
2. **Authorize rotate:** W1 `netlify env:set CLICKFUNNELS_WEBHOOK_SECRET <new> --secret` → **you** update ClickFunnels endpoint “Fundhub platform” signing secret to the **same** value → **one** deploy → W1 re-probes. Never weaken verify.

Until then: treat CF→platform as **not launch-ready**. Thank-you/calendar fragment is fine.

### Evidence paths

- `docs/workflows/e2e-verify-run4-evidence/w1/nosig.body` / `badsig.body` (+ headers)
- `docs/workflows/e2e-verify-run4-evidence/w1/thank-you-probe.json`
- `docs/workflows/e2e-verify-run4-evidence/w1/thank-you-live-with-booking.png`
- `docs/workflows/e2e-verify-run4-evidence/w1/thank-you-live-no-booking.png`
- `docs/workflows/e2e-verify-run4-evidence/w1/fundhub-funding-strategy-meeting.ics`

### W1 summary for W5

| Field | Value |
|-------|-------|
| Funnel seam verdict | **FAIL/BLOCKED** on ingress · **PASS** on thank-you |
| Allowlisted fix applied | **no** |
| Next | Owner unblocks secret (paste or rotate+CF update+deploy) → W1 re-run signature accept + capture +test payloads |

---

## W2 Client journey / routing law — manifest (2026-08-12)

**Owner:** W2 session · **Mode:** observe-only · **Code changes:** none  
**DB used for schema probes:** local Postgres `fundhub_verify` (`DATABASE_URL=postgresql://…@localhost/fundhub_verify`)  
**Prod Supabase reads:** **BLOCKED** — `netlify env:get DATABASE_URL` returns masked `************` (len 20); cannot query live `clients` / letters.  
**CF live land:** **BLOCKED** — W1 manifest not on board yet; no owner-captured CF payloads in `/tmp`; unsigned POST to `https://fundhub.ai/api/webhooks/clickfunnels` → `401 bad_signature` (endpoint alive). Do not invent “live”.  
**Inngest:** no real Inngest events emitted. Local probes used `emit()` bus + direct `ds-02` `handle()` with `DIY_IN_REPO=1`, `MESSAGING_DRY_RUN=1`, `ADAPTERS_DRY_RUN=1`.  
**Test rows flagged:** tags `e2e-run4-w2` + `test` on probe clients (emails `e2e_r4_w2_*@verify.local`).

### Pending migrations (prod, leave untouched — ranked blocker for letters)

From `GET https://fundhub.ai/api/health?strict=1`:

1. `migrations/160_metro2_dispute_engine.sql` — creates `dispute_letters` (letter-row store)
2. `migrations/161_optimization_repair_pipeline.sql` — optimization/letters pipeline stages

Local `fundhub_verify` also missing these two (same names). `documents` table exists; `dispute_letters` does not until 160 applies.

### Claim table

| id | claim | class | probe | auth | evidence | verdict | blast |
|----|-------|-------|-------|------|----------|---------|-------|
| `land:clients_row_first_last` | CF First/Last land as two columns on `clients` | LIVE | Local: CF-shaped `normalizeClickFunnelsEvent` + `emit entry.captured` / `survey.submitted` | n/a (bus) | client_id=`71865637-2668-478b-b167-b8b562200647` email=`e2e_r4_w2_1786540817794.clean@verify.local` first=`Clean` last=`File` | **PASS** (local schema) | Wrong name split breaks CRM + booking match |
| `land:cf_svy_jsonb` | Survey answers land as `cf_svy_*` on `clients.custom_fields` | LIVE | Same emit; SQL read `custom_fields` | n/a | keys include `cf_svy_self_reported_fico=750+`, `cf_svy_has_negatives=No`, `cf_svy_your_why=growth`, `cf_svy_funding_target_amount` | **PASS** (local) | Routing/qualify blind without answers |
| `land:cf_svy_carbon_copy_typed` | Typed carbon-copy table `client_custom_fields.cf_svy_*` populated | LIVE (schema) / **DEAD writer** | SQL `SELECT` after land; ripgrep for `INSERT INTO client_custom_fields` | n/a | rows=**0**; **no writer** anywhere in `src/` or `db/` SQL. Columns exist (incl. `cf_svy_self_reported_fico`); **`cf_svy_has_negatives` column does not exist** | **FAIL** | Agent/sales joins on `client_custom_fields` see empty survey carbon-copy |
| `wh:clickfunnels→client` live | Live CF webhook creates the clients row on prod | LIVE | Prefer W1 signed payload + prod DB read | CF secret | Endpoint 401 without sig; prod DB URL masked; W1 evidence absent | **BLOCKED** | Ad traffic never lands in CRM |
| `route:clean_funding_zero_letters` | Clean file → funding qualify; DS-02 never writes letters | LIVE | `classifySurvey` → PASS; set `outcome_tier=FULL_FUNDING`; call `ds-02` handle with DIY product + violations | n/a | classify=`PASS`; ds02=`blocked_not_repair_only:FULL_FUNDING`; `documents` letter rows=0 for client `71865637-…` | **PASS** (local law) | Clean leads get DIY letters / wrong path |
| `route:dirty_downsell_ds02` | Dirty file → downsell qualify; DS-02 runs on REPAIR_ONLY | LIVE | `classifySurvey` → DOWNSELL; `outcome_tier=REPAIR_ONLY`; `ds-02` + `deliverDiyPackageInRepo` | n/a | dirty client=`46434626-722f-4391-a740-3d6ffcec4e9c`; classify=`DOWNSELL`; ds02 `done=true`, `diy_status=Delivered`, `diy_letter_count=3`, invoice `b3e2a1a3-f19e-4fba-bf25-1e21ef8b4434` source=`diy_letters` | **PASS** (local law + pointers) | Dirty leads skip letters / wrong product path |
| `route:dirty_letter_artifact` | Letter rows/pointers exist **and** PDF opens as real file | LIVE | In-repo package render; SQL `documents` / `dispute_letters`; `file` on PDF | n/a | Pointers on `custom_fields` PASS. **`documents` rows=0**. **`dispute_letters` missing** (migration 160 pending). Code: `src/metro2/diy/deliver.mjs` — “PDF bytes are not persisted here”. In-memory PDFs open: `/tmp/e2e-run4-w2/dirty-letter.pdf` (`PDF document, version 1.7`, magic `%PDF`), also `03-round-1__ex-metro2.pdf` etc. | **FAIL** (no durable row/file store) | Staff cannot open a stored letter from CRM; only ephemeral generate |
| `appt:same_client_no_dup` | Appointment ties to same client by email; no duplicate contact | LIVE | `emit booking.created` same email after land | n/a | before/after client count=1; task_id=`5fbf9d1b-140c-42be-8cd9-aa57b5ff1c18` client_id=`71865637-…` title=Strategy session booked | **PASS** (local) | Duplicate contacts break pipeline |
| `pg:client-lifecycle` | Real Postgres handler chain + First/Last + cf_svy jsonb | LIVE | `DATABASE_URL=…/fundhub_verify node --test src/handlers/client-lifecycle.pg.test.mjs` (+ survey-qualification, ds-02, clickfunnels unit) | n/a | 48/48 pass (incl. pg journey) | **PASS** | — |

### Evidence paths

- `/tmp/e2e-run4-w2/e2e_r4_w2_1786540817794-evidence.json` — first probe JSON
- `/tmp/e2e-run4-w2/dirty-letter.pdf` — opens as PDF 1.7
- `/tmp/e2e-run4-w2/03-round-1__ex-metro2.pdf` (+ r2/r3) — `%PDF` magic
- Live: `GET https://fundhub.ai/api/health?strict=1` → pending migrations named above
- Live: `POST https://fundhub.ai/api/webhooks/clickfunnels` unsigned → `{"ok":false,"status":401,"reason":"bad_signature"}`

### Confirmed env (name only)

- `MESSAGING_DRY_RUN` production = `1` (netlify env:get)
- `CLICKFUNNELS_WEBHOOK_SECRET` production = **set but masked** (len 20 asterisks; value unseen)
- `INNGEST_EVENT_KEY` — not probed by W2; owner said LIVE — **no emit**

### Blockers handed to W5 / owner

1. **Prod DB URL masked** — cannot prove live client land / appointment same-row on Supabase until unmasked access or W1/W4 staff session + API read.
2. **W1 CF signed payload evidence missing** — live funnel→CRM chain BLOCKED for W2.
3. **`client_custom_fields` never written** — typed `cf_svy_*` carbon-copy FAIL.
4. **Letter PDF not persisted** to `documents` / `dispute_letters`; migration **160/161** pending on prod (leave untouched per owner).
5. Demo UI login is not a pass; demo password login refused on prod (`invalid_credentials`) when tried as negative check only.

### Unit / pg suite slice (local)

`node --test src/handlers/client-lifecycle.pg.test.mjs src/config/survey-qualification.test.mjs src/workflows/ds-02-diy-letters.test.mjs src/adapters/clickfunnels.test.mjs` → **48 pass / 0 fail** against `fundhub_verify`.

---

## W4 Screens / auth / LIVE rest + transmit size — manifest (2026-08-12)

**Owner:** W4 session · **Mode:** observe-only · **Code changes:** none · **Inngest emits:** none  
**Canonical base:** `https://fundhub.ai` (`app.fundhub.ai` ignored)  
**Env confirmed (name / non-secret only):** `MESSAGING_DRY_RUN=1`, `ADAPTERS_DRY_RUN=1`, `INNGEST_EVENT_KEY` SET (masked), `DEMO_LOGINS_ENABLED` **ABSENT**, `STAFF_INITIAL_PASSWORD` **ABSENT**, `DASHBOARD_SECRET` SET, `DATABASE_URL` / `MIGRATION_DATABASE_URL` SET but **masked** (`************`, len 20) via Netlify CLI + REST.

### Pending migrations (prod — leave untouched)

`GET https://fundhub.ai/api/health?strict=1` → `pending:2`, `missingMigrations`:

1. `migrations/160_metro2_dispute_engine.sql`
2. `migrations/161_optimization_repair_pipeline.sql`

Note: `migrations:142` / `expected:142` with `pending:2` means the applied **set** differs from expected (two expected keys missing; two extra applied keys not in expected). Local `fundhub_verify` also lacks 160/161 (has through 159).

### Auth / anonymous gate evidence

| id | claim | class | probe | auth | evidence | verdict | blast |
|----|-------|-------|-------|------|----------|---------|-------|
| `api:dashboard/*` anonymous refuse | Unset-secret hole stays closed — anonymous cannot read client book | LIVE | `GET /api/dashboard/clients`, `/kpis`, `/pipeline`, `/client` with no header | none | all **401** `{"ok":false,"error":"unauthorized"}` | **PASS** | Client PII open to the world |
| `api:dashboard/*` bad key | Wrong `x-dashboard-key` refused | LIVE | `GET /api/dashboard/clients` + `x-dashboard-key: wrong` | bad secret | **401** unauthorized | **PASS** | — |
| `api:dashboard/*` query-string key | Secret not accepted from `?key=` | LIVE | `GET /api/dashboard/clients?key=<DASHBOARD_SECRET>` | query | **401** unauthorized | **PASS** | Secret in history/Referer |
| `api:dashboard/*` secret-only | Shared secret alone cannot open org data (needs staff session + org) | LIVE | `GET` with valid `x-dashboard-key` | DASHBOARD_SECRET | clients/pipeline → **`no_org_on_session`**; kpis → **`forbidden`** | **PASS** (gate tighter than secret-only) | — |
| `api:auth/session` anon | Session endpoint refuses anonymous | LIVE | `GET /api/auth/session` | none | **401** unauthorized | **PASS** | — |
| `api:auth/login` demo off | Demo roster switched off on prod | LIVE | `GET /api/auth/login`; `POST` `owner@demo.fundhub.local` / `demo-portal-2026` | demo | GET `demo.enabled:false`; POST **403** `demo_logins_disabled` | **PASS** (demo ≠ verified-real) | — |
| `api:auth/login` bad password | Wrong password for founding owner email fails closed | LIVE | `POST` `chris@fundhub.ai` + garbage password | none | **401** `invalid_credentials` | **PASS** | — |
| `api:auth/magic-link` | Magic-link request answers uniformly (no account oracle) | LIVE | `POST /api/auth/magic-link` `{email:chris@fundhub.ai}` | none | **200** generic “If that email address has a Fundhub portal…” | **PASS** (shape) | Token not retrieved — outbound dry-run + no DB |
| `api:auth/magic-link-verify` | Verify requires token | LIVE | `POST {}` | none | **400** `token_required` | **PASS** | — |
| `api:auth/reset` | Staff reset does not email; points to Staff screen | LIVE | `POST {action:request,email:chris@fundhub.ai}` | none | **200** message: system does not send email — ask owner/admin | **PASS** (honest) | Staff cannot self-reset without human |
| `screen:portal-login` isolation | Portal login page is client path; staff pointed elsewhere | LIVE | `GET /portal-login.html` | none | title “Client portal sign-in”; note “Staff sign in at /login.html”; posts to magic-link APIs | **PASS** (page isolation) | Staff/client session mix |
| `auth:staff_session` live | Seeded staff can sign in and hit staff APIs | LIVE | Need password for `chris@` / founding roster | **BLOCKED** | No `STAFF_INITIAL_PASSWORD` in Netlify; demo off; DB URL masked — cannot mint session | **BLOCKED** | All CRM/RBAC/write→read below |

### Screens / CRM / RBAC / writes (LIVE rows)

HTML shells load on deploy; **data survival / RBAC / write→read not verified-real** without staff session.

| id | claim | class | probe | auth | evidence | verdict | blast |
|----|-------|-------|-------|------|----------|---------|-------|
| `screen:crm/dashboard/app shells` | Key screens served from deploy | LIVE | `GET` crm, dashboard, login, portal-login, reset-password, app/pipeline, documents, client-portal, journeys, inquiry-remover, closer-dashboard | none | all **200** | **PASS** (static) | — |
| `screen:crm rows+filters` | Real rows visible and survive filters/sorts/tabs | LIVE | Needs staff session + DOM | staff | blocked — no session | **BLOCKED** | Launch with empty/wrong CRM |
| `screen:RBAC sidebar` | Roles see correct sidebar slice | LIVE | Needs per-role staff session | staff | blocked | **BLOCKED** | Wrong role sees wrong tools |
| `screen:portal vs staff` | Portal login isolated from staff (beyond page copy) | LIVE | Need client account magic verify + staff session contrast | mixed | page copy PASS; session isolation **BLOCKED** | **BLOCKED** (session) | Cross-login leak |
| `api:documents upload→fetch` | Upload → storage → `api/documents/[id]` | LIVE | Needs auth | staff | anon upload **405**/auth required; no write | **BLOCKED** | Docs missing for funding |
| `api:inquiry*` | Inquiry ops against deployed | LIVE | `GET /api/inquiries` | none | **401** | **BLOCKED** (auth) | IRA ops blind |
| `api:journeys/run` | One real step against real DB without unsafe Inngest | LIVE | `GET`/`POST /api/journeys/run` anon; live emit unsafe | none | both **401**; **did not** call authenticated run / emit Inngest (key LIVE) | **BLOCKED** live; prefer local/dry | Journey runner unproven on prod |
| `api:read/agent-context` | Returns real context | LIVE | `GET /api/read/agent-context` | none | **401** | **BLOCKED** | Agents blind |
| `api:pipeline/tasks/shifts/call-outcomes` | Write→read each | LIVE | anon GET/POST | none | GET tasks/shifts **401**; POST pipeline/tasks/shifts/call-outcomes **401**; some routes **405** without body/method | **BLOCKED** | Ops writes dead |
| `api:proxy launch/end once` | Proxy launch/end once (Oxylabs) | LIVE | Would need auth + provider creds | staff | anon launch **405**; **no OXYLABS_*** in prod env name list — skipped (do not burn) | **BLOCKED** / skipped | Apply-assist proxy dead |

### e2e specs vs DEPLOYED

Playwright `baseURL` is `http://127.0.0.1:<port>` (`playwright.config.mjs`). **All 22** `e2e/*.spec.mjs` use `harness.mjs` and/or `page.route("**/api/**")` — **harness-only**, not against `https://fundhub.ai`.

| Spec | Class |
|------|-------|
| agent-editor, calendar, client-portal-ux, command-center, controls-persist, crm-flows, demo-mode, integration-round, lenders, lenders-inquiry-ops, login, messaging-inbox, ops-admin, pipeline, pipeline-honest, proxy-apply, sales-dashboards, screens-smoke, sidebar-roles, staff-teams, verification-roles, verification-security | **harness-only** (not LIVE deploy proof) |

### Transmit gap sizing (do not build sender)

**Prod fence:** `MESSAGING_DRY_RUN=1` → dispatcher holds every outbound (`dry_run_blocked`). Mailgun send keys SET; Twilio send keys SET; SMS route historically GHL relay (status board 2026-08-10).

**Client-facing sends missing or non-transmitting today:**

| Send | Platform status | Who does it today (if anyone) | Show-rate impact (plain language) |
|------|-----------------|--------------------------------|-------------------------------------|
| Booking confirmation (you’re booked) | **Missing in platform** — `s-04-call-booked` only tags + moves pipeline card; **no** `sendTemplated` | Likely ClickFunnels / Google Calendar invite only (outside this repo) | If CF/Google stop, client gets **no** “you’re booked” from Fundhub → more no-shows |
| Appointment reminders (T-24h / T-1h) | **No dedicated reminder workflow** found | Not in platform | Clients forget calls → **show rate drops**; staff recover via no-show path only after the miss |
| Pre-call nurture drip (`bs-01`) | Queues email templates via `sendTemplated` on `booking.created` | Queued only; dry-run + dispatcher fence → **nothing leaves** | Less “watch this before the call” prep → weaker calls, not direct show-rate |
| No-show recovery (`s-05a`) | Would queue email+SMS templates | Dry-run blocks transmit | After a miss, platform cannot text/email to rebook |
| No-answer cadence / handoff (`ai-set-03/04`) | Would queue SMS | Dry-run blocks | Setters cannot automate chase texts |
| Magic link / password reset email | Magic link queues message; reset **explicitly does not email** | Dry-run + reset copy | Clients/staff stuck without human relay |
| Contract chase | Has caller (`run_reminders` / `contract-chaser`) | Still dry-run at transmit | Unsigned contracts stall |

**Bottom line for ads:** confirmations may still ride CF/Google. **Platform reminders do not exist**, and **every platform queue is dry-run blocked**. Expect show-rate to depend entirely on calendar/CF behavior until dry-run flips **and** a reminder send is built.

### journeys/run note

Did **not** run an authenticated live step: would risk Inngest-side effects with `INNGEST_EVENT_KEY` LIVE. Prefer local/dry verification (W2 style) until owner grants a safe dry path. Anon already **401**.

### Deferred LIVE list (W4 → W5 / owner)

1. Paste staff passwords (or set `STAFF_INITIAL_PASSWORD` + reset) **or** unmask `DATABASE_URL` for session mint via magic-link row.
2. Re-run CRM filter/sort/tab survival + RBAC sidebar with real roles.
3. Documents upload→fetch; inquiry ops; pipeline/tasks/shifts/call-outcomes write→read.
4. `journeys/run` one step under explicit dry/safe rules.
5. `agent-context` with real client id.
6. Proxy launch/end **once** after Oxylabs creds confirmed.
7. Optional: Playwright against `https://fundhub.ai` (today’s suite is harness-only).
8. Apply migrations 160/161 when owner allows (letters store).

### W4 manifest summary

| Field | Value |
|-------|-------|
| Code changes | none |
| Auth anonymous dashboard gate | **PASS** (unset-secret hole stays fixed) |
| Screen data survival / RBAC | **BLOCKED** (no staff session) |
| Transmit gap | Sized — booking confirm not in platform; reminders missing; dry-run blocks all queues |
| Pending migrations | `160_metro2_dispute_engine.sql`, `161_optimization_repair_pipeline.sql` |
| e2e vs deploy | 22/22 harness-only |
| Next | Owner supplies staff login **or** W5 merges BLOCKED rows; do not flip dry-run |

## W3 Money + UnderwriteIQ — manifest (2026-08-12)

**Owner:** W3 session · **Mode:** observe-only · **Code changes:** none  
**Canonical API:** `https://fundhub.ai`  
**Auth:** seeded staff `owner@fundhub.ai` (role-test password; **not** demo roster)  
**Inngest:** no real emits · **MESSAGING_DRY_RUN:** left at `1` · **Migrations:** untouched  

### Evidence table

| id | claim | class | probe | auth | evidence | verdict | blast |
|----|-------|-------|-------|------|----------|---------|-------|
| `api:read/products` | Catalog of modeled offers from real DB | LIVE | `GET /api/read/products` | owner@fundhub.ai | 200 · 5 products: `diagnostic`, `card-stacking-dfy` (funding), `consulting-package`, `repair-bundle` (credit repair), `inquiry-removal`. **No DIY/education SKU modeled.** | **PASS** (DFY+repair modeled; DIY N/A) | Wrong catalog → wrong pricing / offers |
| `api:products` | Finance write path live (not stub) | LIVE | `POST /api/products` `{action:save,code:__no_such_w3__}` | owner | 404 `not_found` (auth+handler reached DB) | **PASS** | Staff cannot edit offers |
| `api:read/entitlements` | Entitlements for modeled offers readable from real rows | LIVE | `GET /api/read/entitlements` | owner | 200 · count **9** · codes `metro2-letter-pack` (×6 clients), `credit-analysis-report`, `credit-optimization-roadmap`, `funding-snapshot` — deliverable grants, not product SKU keys | **PASS** (rows real) / note: not 1:1 product-code entitlements for DFY/repair | Clients missing unlocks |
| `api:payment-links` create | Real Commas checkout URL built | LIVE | `POST /api/payment-links` `{action:create,…}` on +test client | owner | **503** `commas_not_configured` — `COMMAS_CHECKOUT_BASE_URL` **absent** (`netlify env:list` production) | **BLOCKED** | Cannot send pay links → no deposits |
| `api:payment-links` list | List path works without checkout base | LIVE | `GET /api/payment-links?client_id=` | owner | 200 · `items:[]` | **PASS** (empty honest) | — |
| `wh:commas` signature | Signed test event accepted; unsigned refused | LIVE | `POST /api/webhooks/commas` no/bad sig → 401; HMAC with local `.env` secret (=prod) → not 401 | none | unsigned/bad → `401 bad_signature`; good sig → past verify | **PASS** (verify intact; never weakened) | Open payments webhook |
| `wh:commas` inbox+invoices | Signed event writes inbox; invoices readable | LIVE | signed `payment.succeeded` + SQL `commas_inbox` / `GET /api/read/invoices` | secret + DB | **500** `inbox_write_failed`; `commas_inbox` count **0**; invoices **0**. Root cause: table **RLS ON + 0 policies** (sole bare-RLS table) | **FAIL** | Paid clients never register; revenue silent |
| `api:read/commissions` | Reads real `commission_ledger` (no hardcoded math) | LIVE | `GET /api/read/commissions` + code read | owner | 200 · count **0**; SQL selects ledger with `is_demo=false`; no hardcoded amounts in handler | **PASS** (empty ledger honest; hardcoded path stayed deleted) | Fake commissions on screen |
| `api:read/underwrite` ×2 +test | Production adapter+read on two +test clients | LIVE | create `w3run4+test.*.@fundhub.ai` → `GET /api/read/underwrite?client_id=` | owner | clients `08f322eb-…`, `92096b69-…`; both **200** `engine.name=underwrite_iq_lite` + `upstreamCommit`; fundable false / totals 0 (thin file) | **PASS** (engine path live) | Advisors see blank/wrong capacity |
| `api:read/underwrite` download | Report download opens | LIVE | response keys + `finance-os.html` / closer-call | owner | JSON report only; **no** download URL / PDF affordance in finance-os or closer-call | **FAIL** | Staff cannot download/share report file |
| `api:read/underwrite` six-tier | Six-tier ladder present | LIVE | underwrite JSON + `outcome_tier` on clients | owner | No tier/ladder fields in report; both +test clients `outcome_tier=null`. Six-tier lives in vendor CRS `route-outcome.js`, **not** wired through this read path | **FAIL** | Routing decisions invisible on underwrite screen |
| `api:read/lender-matches` | Matches from engine, not fixtures | LIVE | `GET /api/read/lender-matches?client_id=` on +test | owner | 200 · `match_count:7` via `matchForClient`; all matches `is_demo:true` / `DEMO · …`; lenders table **7/7 demo** | **FAIL** (engine yes, catalog demo-only — demo≠pass) | Fake lender plan sold to clients |
| `api:read/funding-rounds` | Rounds from engine/DB not fixtures | LIVE | `GET /api/read/funding-rounds?client_id=` on +test | owner | 200 · count **0** / `items:[]` (real empty query) | **PASS** (honest empty) | — |

### +test clients created (W3)

| id | email |
|----|-------|
| `08f322eb-1dda-42ca-becb-9d7a41a51b27` | `w3run4+test.1786540950236.a@fundhub.ai` |
| `92096b69-0548-450e-b573-7248d3283378` | `w3run4+test.1786540950236.b@fundhub.ai` |

### Owner actions to unblock money

1. Set `COMMAS_CHECKOUT_BASE_URL` on Netlify (production + preview contexts) → **one** deploy.  
2. Fix `commas_inbox` RLS (add policies for `fundhub_app`, or stop enabling RLS without policies) — **code/migration work; out of W3 observe-only**.  
3. Load non-demo lenders (or clear demo-only catalog) before treating matches as launch-ready.  
4. Six-tier / download: either wire CRS route-outcome + file download into the production underwrite surface, or drop from launch bar.

### W3 summary

| Field | Value |
|-------|-------|
| Code changes | none |
| Checkout base | **BLOCKED** — unset |
| Commas signature | **PASS** |
| Commas inbox → invoices | **FAIL** (bare RLS) |
| Products / entitlements / commissions read | **PASS** |
| Underwrite engine on +test | **PASS** |
| Underwrite download + six-tier | **FAIL** |
| Lender-matches | **FAIL** (demo catalog) |
| Funding-rounds | **PASS** (empty real) |
| Next | Chris sets checkout base; schedule commas_inbox RLS fix; W5 merges |

## W0 manifest

| Field | Value |
|-------|-------|
| Files written | `docs/workflows/e2e-verify-run4.md` |
| api files enumerated | 139 |
| screens enumerated | 52 |
| webhook providers | 11 |
| Inngest registered | 50 |
| Inngest defined-unregistered | 1 (`inquiry-call-sweeper`) |
| Code changes | none |
| Next | Chris answers owner questions → launch W1–W4 |

---

## W5 Report merge — change manifest (2026-08-12)

| Field | Value |
|-------|-------|
| Code changes | **none** (observe-only merge) |
| Report path | `docs/E2E-REPORT.md` |
| Sources | Board W0–W4 manifests + `docs/workflows/e2e-verify-run4-evidence/w1/` |
| Live re-probe | **none** |
| Inngest / dry-run / migrations | untouched |
| Adapter allowlisted fix | still **not** applied |
| Ad-launch verdict | **No** — CF ingress unproven; pay path blocked; transmit gap; CRM mostly BLOCKED |
| Next | Owner unblocks CF secret + `COMMAS_CHECKOUT_BASE_URL` + commas_inbox RLS; then re-probe funnel + money |


## W4b — Staff session re-probe (2026-08-12, after STAFF_INITIAL_PASSWORD deploy)

**Finding:** Setting `STAFF_INITIAL_PASSWORD` on Netlify does **not** change existing `staff.password_hash`. `Staff2026!` → **401** for all tested emails. Existing role-test password still works for `chris@` / `owner@` / `admin@` (documented example in `scripts/seed-role-accounts.mjs`). Closers/advisors (`jordan@`, `nina@`, `marcus@`, `alvin@`, `sarah@`) still **401** on that password.

| id | verdict | evidence |
|----|---------|----------|
| `auth:staff_session` chris/owner/admin | **PASS** | live login 200 + session 200 |
| `auth:staff_session` Staff2026! | **FAIL** | env set+deployed; hashes not reset |
| `auth:founding closers/advisors` | **FAIL**/401 | need `--reset-passwords` seed against prod DB |
| `api:dashboard/clients` authed | **PASS** | 18 clients |
| `api:read/staff` | **PASS** | 20 staff |
| `api:read/inquiries` | **PASS** | 22 |
| `api:read/documents` | **PASS** | 6 |
| `api:tasks` / `shifts` / `call-outcomes` GET | **PASS** | real counts |
| `shell:closer → /dashboard.html` | **PASS** | live `shell.js` contains `closer: "/dashboard.html"` |
| `screen:staff-teams` filter survival | **PASS** | filter `chris` → Chris Stanbridge only; **no** Dana Kowalczyk sample swap |
| `screen:demo mode banner` | **FAIL** (posture) | Staff & Teams shows **DEMO MODE ON — sample data is displayed** while owner session; demo logins API still off |

**Owner next (pick one password story):**
1. Unmask/`netlify env:get` **DATABASE_URL** (or paste) → run `STAFF_INITIAL_PASSWORD='…' node scripts/seed-staff.mjs` with `--reset` / role-accounts `--reset-passwords` so `Staff2026!` (or chosen) actually works for all founding roles.
2. Or keep role-test password and paste it for closer/advisor accounts after reset.

**Still blocked for ad launch (unchanged):** CF secret accept, `COMMAS_CHECKOUT_BASE_URL`, `commas_inbox` RLS, migrations 160/161, transmit dry-run.


## Demo mode OFF attempt (2026-08-12) — superseded by W2 Demo flip below

Prior API `POST /api/demo/mode` echoed `false` while `GET` stayed `true` (no RETURNING check). Fixed in `a7f427f`. Cloud one-shot via `MIGRATION_DATABASE_URL` persisted the row.

---

## W2 Demo flip — manifest (2026-08-12) **PASS**

**Owner:** W2 Demo flip session · **Code:** `setDemoMode` RETURNING check + unit test · **Wipe:** none · **Migrations 160/161:** untouched · **MESSAGING_DRY_RUN / Inngest:** untouched  
**Org:** id `fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6` (chris@ session) · slug preferred `fundhub` (seed default / staff org)  
**Commits pushed:** `a7f427f` (flip + fix) → `ae7a537` (restore `npm run guard:db`, delete tmp script)  
**Build command after:** `command = "npm run guard:db"` confirmed on `HEAD` and restore deploy `ae7a537` **ready**

### Before → after (chris@ staff session, view filter off)

| Metric | Before (W4b) | After (W2) |
|--------|--------------|------------|
| `GET /api/demo/mode` `demo_mode_enabled` | **true** | **false** |
| clients (`/api/dashboard/clients`) | **18** | **5** (all `is_demo:false`) |
| staff (`/api/read/staff`) | **20** | **20** |
| inquiries (`/api/read/inquiries`) | **22** | **22** |
| documents (`/api/read/documents`) | **6** | **6** |
| Staff & Teams banner “DEMO MODE ON — sample data…” | **ON** | **GONE** (`#fh-demo-banner` absent) |
| Filter `chris` on Staff & Teams | Chris Stanbridge; no Dana swap | **Chris Stanbridge**; **no Dana Kowalczyk** |

Demo-tagged rows remain in DB (`is_demo=true`, ~15 clients counted by mode status). Not wiped (owner rule).

### Banner evidence

- Playwright probe: `docs/workflows/e2e-verify-run4-evidence/w2-demo-flip/banner-probe.json` → `bannerPresent:false`, `hasPhrase:false`, `hasChris:true`, `hasDana:false`
- Screenshot: `docs/workflows/e2e-verify-run4-evidence/w2-demo-flip/staff-teams-after.png`

### Change manifest

| Field | Value |
|-------|-------|
| Files | `src/demo/platform-seed.mjs` (`setDemoMode` RETURNING + throw `demo_mode_update_failed`); `src/demo/set-demo-mode.test.mjs` (unit); temp `scripts/tmp-flip-demo-mode.mjs` + `netlify.toml` one-shot then **removed/restored** |
| Journeys | none |
| Routes | none new |
| `setDemoMode` | **fixed** (not ticketed) — no longer echoes intent without RETURNING |
| Inngest / dry-run / wipe | none |
| Next | W3 RUN4 resume may proceed with demo filter off |

### Verdict for parent

**PASS** — demo off on prod; clients 18→5; banner gone; setDemoMode fixed; build guard restored.

---

## W3 RUN4 resume — manifest (2026-08-12) **PASS**

**Owner:** W3 RUN4 resume · **Mode:** observe-only (no Track D re-break) · **Code changes:** none  
**Canonical:** `https://fundhub.ai` · **Inngest / MESSAGING_DRY_RUN / migrations 160–161:** untouched  
**Gate:** polled board + authed `GET /api/demo/mode` every ~60s · **wait ~369s (~6.2 min)** · final `demo_mode_enabled:false` · W2 flip **done** before probes

### Auth sessions (known staff password — value not printed)

| Account | Login | Notes |
|---------|-------|-------|
| `chris@fundhub.ai` | **PASS** 200 owner | Used for CRM counts + Staff & Teams DOM |
| `owner@fundhub.ai` | **PASS** 200 owner | Re-check |
| `admin@fundhub.ai` | **PASS** 200 admin | Re-check |

### Four CRM counts (chris@, demo filter off)

| Metric | W4b (demo on) | W2 after flip | **W3 resume** |
|--------|---------------|---------------|---------------|
| `GET /api/demo/mode` enabled | true | false | **false** |
| clients `/api/dashboard/clients` | 18 | 5 | **5** (all `is_demo:false`) |
| staff `/api/read/staff` | 20 | 20 | **20** |
| inquiries `/api/read/inquiries` | 22 | 22 | **22** |
| documents `/api/read/documents` | 6 | 6 | **6** |

Client emails now visible (non-demo): `test+crs@fundhub.ai`, `test@example.com`, two `w3run4+test…`, `client@fundhub.ai`. Demo-tagged rows remain in DB (not wiped).

### Staff & Teams banner + chris filter

| id | claim | verdict | evidence |
|----|-------|---------|----------|
| `screen:demo mode banner` | Banner absent when demo off | **PASS** | `#fh-demo-banner` absent; no “DEMO MODE ON” phrase |
| `screen:staff-teams` filter survival | Filter `chris` → Chris only; no Dana sample swap | **PASS** | `hasChris:true` `hasDana:false` |

Evidence: `docs/workflows/e2e-verify-run4-evidence/w3-run4-resume/banner-filter-probe.json`, `staff-teams-after-demo-off.png`

### W4 shells / ops previously blocked on demo contamination

| id | verdict | evidence |
|----|---------|----------|
| CRM/app shells static | **PASS** | crm, dashboard, pipeline, staff-teams, closer-dashboard, documents, journeys → **200** |
| `api:tasks` GET | **PASS** | 200 · count **5** |
| `api:shifts` GET | **PASS** | 200 |
| `api:call-outcomes` GET | **PASS** (method gate) | **405** method_not_allowed without proper method — not demo-blocked |
| `api:read/agent-context` | **PASS** (validation) | **400** client_id uuid required — auth reached |
| `api:payment-links` create | **BLOCKED** / fail-closed | **503** `commas_not_configured` (checkout-session rewire ticketed) |
| `wh:clickfunnels` unsigned | **PASS** fail-closed | **401** `bad_signature` — **no invented CF signed traffic** |
| Health pending | unchanged | `pending:2` → `160_metro2_dispute_engine.sql`, `161_optimization_repair_pipeline.sql` |

### Ranked ad-launch blockers (refreshed)

1. **CF → platform ingress unproven** — secret match still UNKNOWN; zero CF bus events; unsigned stays 401. Do not invent signed CF.
2. **Pay-links create still 503** — checkout-session rewire ticketed; keep fail-closed.
3. **~~commas_inbox RLS~~ FIXED** (migration 162) — Track D **PASS-synthetic**; live payload shape until real payment.
4. **Pending migrations (leave untouched):** `160_metro2_dispute_engine.sql`, `161_optimization_repair_pipeline.sql`
5. **Transmit gap** — `MESSAGING_DRY_RUN=1`; no platform booking confirm / reminders.
6. **Closer/advisor passwords** — chris/owner/admin work; founding closers/advisors still need reset (W4b).
7. **Lender catalog 100% demo** — matches must not be sold as real.
8. **`inquiry-call-sweeper` DEAD** · **`client_custom_fields` carbon-copy empty** · letter PDFs not persisted · underwrite download/six-tier missing.

### Change manifest

| Field | Value |
|-------|-------|
| Code | **none** |
| Docs | board + `docs/E2E-REPORT.md` + w3-run4-resume evidence |
| Inngest / dry-run / wipe / 160–161 | none |
| Build command | must remain `npm run guard:db` (not touched) |
| Next | Owner unblocks CF secret + pay-link checkout rewire; optional closer password reset |

### Verdict for parent

**PASS** — gate wait ~369s; demo `enabled:false`; counts **5 / 20 / 22 / 6**; banner gone; chris filter survives; pay-links still fail-closed; CF still BLOCKED (no invent).

## W4a scratch smoke — manifest (2026-08-12) **PASS**

**Provider:** Supabase (`aws-1-us-west-2.pooler.supabase.com`, project `oqpnlusrotpxfenysfxz`) — not Neon.  
**Scratch:** schema `w4a_scratch` (cloned optimization tables from prod, applied 160+161, dropped). Prod public tables **untouched** (`PROD_PUBLIC_STILL_HAS_RETIRED_CARDS=1`).

### Card counts (optimization pipeline)

| Stage | Before 161 | After 161 |
|-------|------------|-----------|
| `upgrade_invite` (retired) | **1** | **0** |
| `program_complete` (target) | 0 | **1** |
| other retired keys | 0 | 0 |

**Remap check:** `upgrade_invite` → `program_complete` moved **1** card.  
**Flags:** `FLAG_STILL_ON_RETIRED=0` · `FLAG_UNEXPECTED_STAGE=0`

### 160 / repair write

- Tables: `dispute_cases`, `dispute_items`, `dispute_letters`, `dispute_responses`, `furnisher_mail_addresses`, `repair_decision_log`
- Smoke write: dispute case + item + R1 letter + `repair_decision_log` → **OK**

**Evidence:** `docs/workflows/e2e-verify-run4-evidence/w4a/scratch-smoke.json`  
**Next:** owner **go** for prod apply via `MIGRATION_DATABASE_URL` (161 UPDATEs already approved).

