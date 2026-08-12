# E2E Verify Run 4 — Report

**Branch / SHA:** `main` @ `09c526b`  
**Canonical URL:** `https://fundhub.ai`  
**Mode:** observe-only (allowlisted ClickFunnels adapter fix **not** applied)  
**Board:** `docs/workflows/e2e-verify-run4.md`  
**Evidence:** `docs/workflows/e2e-verify-run4-evidence/` (W1 present)  
**Date:** 2026-08-12

---

## 1. Owner summary (plain language)

**Can we launch ads right now?** **No.**

Ads send people to ClickFunnels. The thank-you / calendar piece works. But the platform has **never** recorded a real ClickFunnels lead on production (zero ClickFunnels bus events). We also could not prove the webhook secret on Netlify matches ClickFunnels. Until that is fixed and re-checked, paid traffic may never show up in the CRM.

**Biggest holes (in order):**

1. **Funnel → CRM is not proven.** Secret match blocked; zero live ClickFunnels landings.
2. **Pay links and payment landing broken.** Checkout base URL missing; Commas inbox cannot write (RLS on, zero policies).
3. **Staff CRM not verified.** Most staff screens need a session; W4 could not log in as staff (W3 could with `owner@fundhub.ai` for money probes only).
4. **Platform does not remind people about calls.** Booking confirm may ride ClickFunnels/Google; platform reminders do not exist; all sends are dry-run blocked.
5. **Two database upgrades still pending** (letters store + repair pipeline). Leave them alone until you say otherwise.
6. **Lender list is all demo.** Matches look real but every lender is marked demo.

---

## 2. Per-feature verdicts (from W1–W4)

Evidence pointers are on the board tables unless a file path is named.

### W1 — Funnel seam (ClickFunnels → thank-you)

| id | verdict | Evidence pointer |
|----|---------|------------------|
| `wh:clickfunnels` fail-closed | **PASS** | `docs/workflows/e2e-verify-run4-evidence/w1/nosig.body`, `badsig.body` → 401 |
| `wh:clickfunnels` sig accept | **BLOCKED** | Secret masked; cannot sign |
| `wh:clickfunnels` prod land | **FAIL** | 0 CF events; 0 captures on prod |
| `wh:clickfunnels` real payload shapes | **BLOCKED** | No live CF body; `CF_CAPTURE_MODE` unset |
| `wh:clickfunnels` idempotency replay | **BLOCKED** | Blocked on signature accept |
| `screen:thank-you` calendar | **PASS** | `thank-you-probe.json`, screenshots, `.ics` in w1 evidence |
| `screen:thank-you` no booking | **PASS** | `thank-you-no-booking.json` |

**W1 roll-up:** ingress **FAIL/BLOCKED** · thank-you **PASS** · allowlisted adapter fix **not** applied.

### W2 — Client journey / routing law

| id | verdict | Evidence pointer |
|----|---------|------------------|
| `land:clients_row_first_last` | **PASS** (local schema) | Board W2 · client `71865637-…` |
| `land:cf_svy_jsonb` | **PASS** (local) | Board W2 · `custom_fields` keys |
| `land:cf_svy_carbon_copy_typed` | **FAIL** | `client_custom_fields` rows=0; no writer in repo |
| `wh:clickfunnels→client` live | **BLOCKED** | No signed CF + prod DB masked |
| `route:clean_funding_zero_letters` | **PASS** (local law) | Board W2 · ds-02 blocked for FULL_FUNDING |
| `route:dirty_downsell_ds02` | **PASS** (local) | Board W2 · diy delivered, invoice pointer |
| `route:dirty_letter_artifact` | **FAIL** | No durable `documents` / `dispute_letters`; PDF only ephemeral |
| `appt:same_client_no_dup` | **PASS** (local) | Board W2 · task on same client |
| `pg:client-lifecycle` | **PASS** | 48/48 local pg/unit slice |

**W2 roll-up:** local routing law mostly green; **live** CF→client and durable letters **not** launch-ready.

### W3 — Money + UnderwriteIQ

| id | verdict | Evidence pointer |
|----|---------|------------------|
| `api:read/products` | **PASS** | Board W3 · 5 products |
| `api:products` | **PASS** | Board W3 · write path reaches DB |
| `api:read/entitlements` | **PASS** | Board W3 · 9 rows |
| `api:payment-links` create | **BLOCKED** | 503 `commas_not_configured` |
| `api:payment-links` list | **PASS** | Empty list honest |
| `wh:commas` signature | **PASS** | Unsigned/bad 401; good sig past verify |
| `wh:commas` inbox+invoices | **FAIL** | 500 `inbox_write_failed`; RLS bare table |
| `api:read/commissions` | **PASS** | Empty ledger honest |
| `api:read/underwrite` ×2 +test | **PASS** | Clients `08f322eb-…`, `92096b69-…` |
| `api:read/underwrite` download | **FAIL** | No PDF/download affordance |
| `api:read/underwrite` six-tier | **FAIL** | Not on this read path |
| `api:read/lender-matches` | **FAIL** | Engine yes; 7/7 lenders demo |
| `api:read/funding-rounds` | **PASS** | Honest empty |

**W3 +test clients (cleanup):**  
`w3run4+test.1786540950236.a@fundhub.ai` (`08f322eb-…`),  
`w3run4+test.1786540950236.b@fundhub.ai` (`92096b69-…`).

### W4 — Screens / auth / LIVE rest + transmit

| id | verdict | Evidence pointer |
|----|---------|------------------|
| `api:dashboard/*` anonymous refuse | **PASS** | Board W4 · 401 all |
| `api:dashboard/*` bad key / query-string / secret-only | **PASS** | Board W4 |
| `api:auth/session` anon | **PASS** | 401 |
| `api:auth/login` demo off | **PASS** | demo disabled |
| `api:auth/login` bad password | **PASS** | 401 |
| `api:auth/magic-link` | **PASS** (shape) | Generic 200 |
| `api:auth/magic-link-verify` | **PASS** | token_required |
| `api:auth/reset` | **PASS** (honest) | No email; ask admin |
| `screen:portal-login` isolation | **PASS** (page) | Board W4 |
| `auth:staff_session` live | **BLOCKED** | No staff password / DB unmask for W4 |
| CRM shells static 200 | **PASS** (static) | Board W4 |
| CRM rows+filters / RBAC / portal session | **BLOCKED** | No staff session |
| documents / inquiry / journeys / agent-context / pipeline writes / proxy | **BLOCKED** | Auth or missing Oxylabs |
| Playwright e2e vs deploy | **BETA-EXCLUDED** / harness-only | 22/22 not against live |

### Cross-cutting / inventory (W0)

| id | verdict | Notes |
|----|---------|-------|
| `wf:inquiry-call-sweeper` | **DEAD** | Defined, not in Inngest `functions` array |
| CT-series workflows | **BETA-EXCLUDED** | Deferred — no `ct-*.mjs` |
| `src/mail/` drop | **BETA-EXCLUDED** | Deliberate no-send (FCRA) |
| Outbound transmit to real clients | **BETA-EXCLUDED** this run | `MESSAGING_DRY_RUN=1` — sized in §5, do not enable |
| Demo APIs / sample-data screens | **BETA-EXCLUDED** | Not real pass |

---

## 3. Adapter / schema diffs

**None expected. None applied.**

| Item | Status |
|------|--------|
| Allowlisted `normalizeClickFunnelsEvent` path mapping | **NOT applied** (W1: no real CF payload shapes captured) |
| “Guessed paths” banner in `src/adapters/clickfunnels.mjs` | **Kept** |
| Schema / migrations 160 & 161 | **Untouched** (owner order) |
| Any other code from Run 4 threads | **None** (observe-only) |

---

## 4. Blockers ranked for ad launch

1. **ClickFunnels → platform ingress unproven** — zero CF bus events on prod; signature accept blocked (secret masked). Paste secret **or** rotate Netlify + update CF + one deploy, then re-probe. Without this, ads may never land in CRM.
2. **`COMMAS_CHECKOUT_BASE_URL` unset** — pay-link create returns 503. Set on Netlify (all contexts) → one deploy.
3. **`commas_inbox` RLS on + zero policies** — signed payment webhook cannot write; invoices stay empty. Needs policy (or app-role) fix — code/migration work.
4. **Pending migrations (leave untouched until owner allows):**
   - `migrations/160_metro2_dispute_engine.sql` — dispute letter store
   - `migrations/161_optimization_repair_pipeline.sql` — repair/optimization pipeline
5. **Transmit gap** — no platform booking confirm / appointment reminders; dry-run blocks all queues (see §5). Show-rate depends on CF/Google only.
6. **Staff session / CRM survival unverified at scale** — W4 blocked on credentials; W3 proved `owner@fundhub.ai` for money only. Paste passwords, set `STAFF_INITIAL_PASSWORD`, or unmask `DATABASE_URL` for session mint.
7. **Lender catalog 100% demo** — matches must not be sold as real until non-demo lenders exist.
8. **`inquiry-call-sweeper` DEAD** — scheduled inquiry calls will not fire via Inngest.
9. **`client_custom_fields` carbon-copy never written** — typed survey columns empty (jsonb on `clients` works locally).
10. **Letter PDFs not persisted** — durable row/file store missing until 160 (+ deliver path) exist.
11. **Underwrite download + six-tier not on production read surface** — engine path live; file/ladder not.

---

## 5. Transmit gap (sized by W4)

**Fence:** production `MESSAGING_DRY_RUN=1` → dispatcher holds every outbound (`dry_run_blocked`). Mailgun and Twilio send keys are set by name; do **not** flip dry-run without owner.

| Send | Platform status | Who does it today | Show-rate impact |
|------|-----------------|-------------------|------------------|
| Booking confirmation | **Missing** — `s-04-call-booked` tags + moves card only; no `sendTemplated` | Likely ClickFunnels / Google Calendar only | If CF/Google stop → no “you’re booked” from Fundhub |
| Appointment reminders (T-24h / T-1h) | **No reminder workflow** | Not in platform | Clients forget → show rate drops |
| Pre-call nurture (`bs-01`) | Queues templates; dry-run blocks | Nothing leaves | Weaker call prep, not direct show-rate |
| No-show recovery (`s-05a`) | Would queue email+SMS | Dry-run blocks | Cannot rebook after miss |
| No-answer / handoff (`ai-set-03/04`) | Would queue SMS | Dry-run blocks | Setter chase texts dead |
| Magic link / password reset | Magic link queues; reset **does not email** | Dry-run + reset copy | Humans must relay |
| Contract chase | Has callers | Dry-run at transmit | Unsigned contracts stall |

**Bottom line for ads:** confirmations may still ride CF/Google. **Platform reminders do not exist.** Every platform queue is dry-run blocked. Expect show-rate to depend entirely on calendar/CF until dry-run flips **and** a reminder send is built.

---

## 6. Cleanup checklist for +test rows

**Do not delete without owner approval.** Propose only.

### Known Run 4 test artifacts

| Source | Marker | Examples |
|--------|--------|----------|
| W3 | emails `w3run4+test…@fundhub.ai` | clients `08f322eb-1dda-42ca-becb-9d7a41a51b27`, `92096b69-0548-450e-b573-7248d3283378` |
| W2 | tags `e2e-run4-w2` + `test`; emails `e2e_r4_w2_*@verify.local` | Local `fundhub_verify` only (not prod) |
| W1 | `w1.run4+test@gmail.com` | localStorage on thank-you only — **no webhook write** |

### Proposed script steps (owner-gated)

1. Confirm `DATABASE_URL` points at the intended DB (prod vs local verify).
2. `SELECT id, email, created_at FROM clients WHERE email LIKE 'w3run4+test%' OR email LIKE 'e2e_r4_w2%';` — review list.
3. Soft-flag or hard-delete dependents first (tasks, invoices, entitlements, underwrite cache) for those `client_id`s — order matters; ask owner for hard delete.
4. Delete or archive the client rows only after dependents are clear.
5. Re-check: `SELECT count(*) FROM clients WHERE email LIKE 'w3run4+test%';` → 0.
6. Do **not** touch real client emails or demo seed roster in the same script.

---

## 7. Owner unblocks remaining

| # | Action | Why |
|---|--------|-----|
| 1 | **Paste** `CLICKFUNNELS_WEBHOOK_SECRET` (or CF signing secret) **or authorize rotate** + update CF “Fundhub platform” endpoint to the same value + **one** deploy | Prove signature accept; then capture +test survey/appointment under dry-run |
| 2 | Set **`COMMAS_CHECKOUT_BASE_URL`** on Netlify (production + preview + branch) → **one** deploy | Pay links stop returning 503 |
| 3 | Fix **`commas_inbox` RLS** (policies for `fundhub_app`, or stop bare RLS) | Payments can land → invoices |
| 4 | Paste **staff passwords** / set `STAFF_INITIAL_PASSWORD` + reset **or** unmask `DATABASE_URL` for magic-link session mint | Unblock CRM filters, RBAC, documents, journeys, write→read |
| 5 | Keep **`MESSAGING_DRY_RUN=1`** until you explicitly want real client sends; then build reminder send before relying on ads for show-rate | Avoid silent no-shows |
| 6 | Decide when to apply **`160_metro2_dispute_engine.sql`** and **`161_optimization_repair_pipeline.sql`** | Letter store + repair pipeline |
| 7 | Load **non-demo lenders** (or clear demo-only catalog) | Matches safe to show clients |
| 8 | Optional: register **`inquiry-call-sweeper`** or accept DEAD | Inquiry call schedule |
| 9 | Confirm CF↔Netlify secret match after unblock (owner Q3 was UNKNOWN) | Close the funnel seam |

---

## Run posture (reference)

| Flag / fact | Run 4 posture |
|-------------|----------------|
| `MESSAGING_DRY_RUN` | `1` (not flipped) |
| `INNGEST_EVENT_KEY` | LIVE — **no thread emitted real Inngest events** |
| Migrations 160 / 161 | Untouched |
| Adapter path fix | Not applied |
| Health | `db:up`, `state:behind`, `pending:2` |

---

*Merged by W5 from board manifests W0–W4 only. No live re-probe.*

## Commas delivery model (Track D, 2026-08-12)

Commas webhooks are **at-most-once** (no retry). A dropped delivery is gone. A reconciliation poller that uses `COMMAS_API_KEY` is a **launch requirement**, not optional hardening.
