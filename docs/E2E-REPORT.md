# E2E Verify Run 4 — Report

**Branch / SHA:** `main` @ `ae7a537` (demo flip + build guard restore; Track D earlier)  
**Canonical URL:** `https://fundhub.ai`  
**Mode:** observe-only (Track D + demo flip already shipped; no new code in W3 resume)  
**Board:** `docs/workflows/e2e-verify-run4.md`  
**Evidence:** `docs/workflows/e2e-verify-run4-evidence/` (W1 + W2 demo flip + W3 resume)  
**Date:** 2026-08-12 · **W3 resume:** demo off confirmed

---

## 1. Owner summary (plain language)

**Can we launch ads right now?** **No.**

Ads send people to ClickFunnels. The thank-you / calendar piece works. But the platform has **never** recorded a real ClickFunnels lead on production (zero ClickFunnels bus events). We also could not prove the webhook secret on Netlify matches ClickFunnels. Until that is fixed and re-checked, paid traffic may never show up in the CRM.

**What improved (W2 demo flip + W3 resume):** Demo mode is **off** on live. Staff CRM now shows filtered real rows (clients **5**, not 18). The “DEMO MODE ON” banner is gone. `chris@` / `owner@` / `admin@` can sign in. Payment webhook landing stays **PASS-synthetic**.

**Biggest holes (in order):**

1. **Funnel → CRM is not proven.** Secret match still unknown; zero live ClickFunnels landings. Do not invent signed CF traffic.
2. **Pay links still blocked.** Create stays **503** until checkout-session rewire (fail-closed). Webhook inbox path is fixed (Track D).
3. **Platform does not remind people about calls.** Booking confirm may ride ClickFunnels/Google; platform reminders do not exist; all sends are dry-run blocked.
4. **Two database upgrades still pending** (letters store + repair pipeline). Leave them alone until you say otherwise.
5. **Lender list is all demo.** Matches look real but every lender is marked demo.
6. **Closer/advisor logins still broken** until password reset on those accounts (owner/admin/chris work).

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
| `route:dirty_downsell_ds02` | **PASS-smoke** | Local law PASS + W4c prod `+test` REPAIR_ONLY wrote dispute rows + R1 letter |
| `route:dirty_letter_artifact` | **PASS-smoke** | W4c: `+test` REPAIR_ONLY `w4c+test.repair@fundhub.ai` → case `aa0f8b95-…` / letter `0b2b7c5b-…` via `buildLetterText`+`saveLetter`. PDF binary storage still open. |
| `appt:same_client_no_dup` | **PASS** (local) | Board W2 · task on same client |
| `pg:client-lifecycle` | **PASS** | 48/48 local pg/unit slice |

**W2 roll-up:** local routing law mostly green; **live** CF→client and durable letters **not** launch-ready.

### W3 — Money + UnderwriteIQ

| id | verdict | Evidence pointer |
|----|---------|------------------|
| `api:read/products` | **PASS** | Board W3 · 5 products |
| `api:products` | **PASS** | Board W3 · write path reaches DB |
| `api:read/entitlements` | **PASS** | Board W3 · 9 rows |
| `api:payment-links` create | **BLOCKED** | 503 — checkout-session rewire ticketed (keep fail-closed) |
| `api:payment-links` list | **PASS** | Empty list honest |
| `wh:commas` signature | **PASS** | Unsigned 401; live HMAC with `COMMAS_WEBHOOK_SECRET` accepted |
| `wh:commas` inbox + CRS normalize | **PASS-synthetic** | Documented envelope POST 200 · `inboxId` `e6bedafc-…` · payment `ORD-SYNTH-C18117792FFE` · local+adapter `email=test+crs@fundhub.ai` · `productOf=crs` · replay `deduped:true`. **Known gap:** live Commas payload shape unconfirmed until first real payment. |
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
| `auth:staff_session` live | **PASS** (chris/owner/admin) · closers **FAIL** | W4b + W3 resume: known staff password works for three; closers need reset |
| CRM shells static 200 | **PASS** (static) | Board W4 / W3 resume |
| CRM rows+filters / demo banner | **PASS** (after demo off) | W3 resume: clients **5**/20/22/6; banner gone; chris filter no Dana |
| documents / inquiry / journeys / agent-context / pipeline writes / proxy | **PARTIAL** | Auth reached for several; proxy/Oxylabs + write→read still deferred |
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
| Schema / migrations 160 & 161 | **Applied to prod** (owner go 2026-08-12) — W4b PASS |
| Any other code from Run 4 threads | **None** (observe-only) |

---

## 4. Blockers ranked for ad launch

1. **ClickFunnels → platform ingress unproven** — zero CF bus events on prod; signature accept still blocked (secret masked / match UNKNOWN). Unsigned POST stays **401**. Do **not** invent signed CF. Paste secret **or** rotate Netlify + update CF + one deploy, then re-probe.
2. **Pay-links create still 503** — `commas_not_configured` / checkout-session rewire ticketed. Keep fail-closed until rewire ships.
3. **~~`commas_inbox` RLS~~ FIXED (migration 162)** — Track D **PASS-synthetic**. Remaining money gap: checkout rewire + first real payment shape confirm.
4. **~~Pending migrations 160/161~~ APPLIED (W4b 2026-08-12):** dispute letter store + optimization remap live. Health `pending:0`.
5. **Transmit gap** — no platform booking confirm / appointment reminders; dry-run blocks all queues (see §5). Show-rate depends on CF/Google only.
6. **Closer/advisor staff passwords** — `chris@` / `owner@` / `admin@` **PASS** with known password; founding closers/advisors still **401** until reset (W4b). CRM counts + Staff & Teams filter survival **PASS** after demo off (W3 resume).
7. **Lender catalog 100% demo** — matches must not be sold as real until non-demo lenders exist.
8. **`inquiry-call-sweeper` DEAD** — scheduled inquiry calls will not fire via Inngest.
9. **`client_custom_fields` carbon-copy never written** — typed survey columns empty (jsonb on `clients` works locally).
10. **Letter PDF binary storage** — `dispute_letters` table live (160); PDF file/key deliver path still to wire.
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
| 2 | Ship **checkout-session rewire** / set whatever pay-link config it needs → **one** deploy | Pay links stop returning 503 (keep fail-closed until then) |
| 3 | ~~Fix `commas_inbox` RLS~~ **done** (migration 162) | Confirm with first **real** Commas payment shape |
| 4 | Reset **closer/advisor** passwords (chris/owner/admin already work) | Full role coverage for CRM RBAC |
| 5 | Keep **`MESSAGING_DRY_RUN=1`** until you explicitly want real client sends; then build reminder send before relying on ads for show-rate | Avoid silent no-shows |
| 6 | ~~Apply 160/161~~ **done** (W4b PASS) | Letter store + repair pipeline live |
| 7 | Load **non-demo lenders** (or clear demo-only catalog) | Matches safe to show clients |
| 8 | Optional: register **`inquiry-call-sweeper`** or accept DEAD | Inquiry call schedule |
| 9 | Confirm CF↔Netlify secret match after unblock (owner Q3 was UNKNOWN) | Close the funnel seam |

---

## Run posture (reference)

| Flag / fact | Run 4 posture |
|-------------|----------------|
| `MESSAGING_DRY_RUN` | `1` (not flipped) |
| `INNGEST_EVENT_KEY` | LIVE — **no thread emitted real Inngest events** |
| Migrations 160 / 161 | **Applied** (W4b) |
| Adapter path fix | Not applied |
| Health | `db:up`, `state:up`, `pending:0` |
| Demo mode | **OFF** (`demo_mode_enabled:false`) — W2 flip + W3 resume verified |

---

*Merged by W5 from board manifests W0–W4 only. No live re-probe.*  
*Updated by W3 RUN4 resume (2026-08-12): demo-off CRM re-probe + blocker refresh.*

## W3 RUN4 resume note (2026-08-12)

Gate wait **~369s**; live demo **enabled:false**; CRM counts **5 / 20 / 22 / 6**; Staff & Teams banner **absent**; filter `chris` → Chris Stanbridge, no Dana. Evidence under `docs/workflows/e2e-verify-run4-evidence/w3-run4-resume/`. Ad-launch still **No** (CF + pay-links).

## Commas delivery model (Track D, 2026-08-12)

Commas webhooks are **at-most-once** (no retry). A dropped delivery is gone. A reconciliation poller that uses `COMMAS_API_KEY` is a **launch requirement**, not optional hardening.

### Synthetic money verify (2026-08-12, no card)

Documented `payment.succeeded` envelope (`buyer.email` / `item.title` / `api_metadata`) HMAC-signed with live `COMMAS_WEBHOOK_SECRET` → `POST https://fundhub.ai/api/webhooks/commas`:

- HTTP **200** · `queued:true` · `inboxId=e6bedafc-60e8-4557-81ac-b6b5f054325c` · `paymentId=ORD-SYNTH-C18117792FFE`
- Replay → `deduped:true` (same inbox id)
- Adapter normalize: email `test+crs@fundhub.ai`, product **crs** (title contains Business Financial Assessment), amount `32`

Verdict: **PASS-synthetic**. Known gap: live payload shape unconfirmed until first real payment.

---

## W4b addendum (2026-08-12)

Owner **go** → applied `160_metro2_dispute_engine` + `161_optimization_repair_pipeline` on prod via `MIGRATION_DATABASE_URL`.

- Remap: `upgrade_invite` 1 → `program_complete` 1; flags 0/0
- REPAIR_ONLY R1 smoke write **PASS** (dispute case/item/letter/decision)
- Evidence: `docs/workflows/e2e-verify-run4-evidence/w4b/prod-apply.json`
- Downsell durable letter store: **PASS-smoke** (table + R1 row); PDF binary deliver still open

## W4c addendum (2026-08-12)

**PASS.** Created `w4c+test.repair@fundhub.ai` (`REPAIR_ONLY`), generated Round 1 letter via Metro 2 letter builder, stored dispute case/item/letter + decision log on prod.

- Client `c0221fe4-…` · Case `aa0f8b95-…` · Letter `0b2b7c5b-…`
- Evidence: `docs/workflows/e2e-verify-run4-evidence/w4c/prod-smoke.json`
- W4b apply already done earlier same day (health `pending:0`); W4c did not re-apply migrations

## Live Playwright 100 (2026-08-12)

**Score: 100/100** — `npm run test:e2e:live` against `https://fundhub.ai` + `https://apply.fundhub.ai` (19/19).

Evidence: `docs/workflows/e2e-verify-run4-evidence/live-playwright-100/`  
Board: `docs/workflows/live-playwright-100.md`  
Gate: Chris may do **one** manual pass now (rule: no manual review before 100).

Also fixed live CRM search: `api/read/search.mjs` no longer references missing `clients.business_name`.

