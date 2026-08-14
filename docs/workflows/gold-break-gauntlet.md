# Gold break gauntlet — 2026-08-14

**Owner:** smash edge cases, then fix. Grok only. Design (typeface) stays Claude — do not run it here.

**Bar:** empty letter → do not ship. JSON dump in a report → do not ship. `[ QR CODE ]` → do not ship. No PDF → no email. Funding mail without the four analysis PDFs → no email. Charts must not lie (DIAGRAM_SPEC §6).

| Unit | Model | Files | Status |
|------|-------|-------|--------|
| B1 Smash letters | Grok 4.6 extra-high | letter-generator + its tests | **done** |
| B2 Smash JSON/report parse | Grok 4.6 extra-high | contentToNodes tests + render-pdf parse | **done** |
| B3 Smash pack + no-mail gates | Grok 4.6 extra-high | letter-pack, u-02, ds-02 tests | done |
| B4 Smash charts (NaN / suppress) | Grok 4.5 high | fh-charts*.mjs + fh-charts.test.mjs | done |
| B5 Smash attachments / empty send | Grok 4.5 high | messaging + resend tests | done |
| B6 Smash C-06 (no Vercel POST) | Grok 4.6 extra-high | c-06 + tests | done |
| B7 Smash generate-deliverables | Grok 4.6 extra-high | generate-deliverables.js + tests | **done** |
| B8 Smash summary docs | Grok 4.5 high | summary-doc-generator | done |
| B9 Smash doc-prompts (no JSON) | Grok 4.5 high | doc-prompts.js + tests | done |
| B10 Smash product-path / review silence | Grok 4.5 high | product-path + tests | done |
| W4 QR prove | Grok 4.6 extra-high | apply-qr only | **done** — decodes to apply.fundhub.ai |
| B14 Smash gauntlet Gmail rewrite | Grok 4.6 extra-high | tmp-letter-gauntlet.mjs | **done** — rewrite before send; MANUAL_REVIEW quiet |
| B15 Smash underwrite report.mjs | Grok 4.5 high | report.mjs + tests | done |
| B11 Smash CRS tier stamp | Grok 4.6 extra-high | crs-tier + tests | done |
| B12 Smash underwrite engine | Grok 4.5 high | engine.mjs + tests | done |
| B13 Smash CRS adapter | Grok 4.5 high | adapter.mjs + tests | done |
| B18 Smash CRS live fence | Grok 4.6 extra-high | crs-pull.mjs + tests | **done** |
| B16 Smash build-documents | Grok 4.5 high | build-documents + tests | done |
| B17 Smash deliver-letters leftover | Grok 4.5 high | deliver-letters.js + tests | done |
| B19 Smash underwriter unknown→0 | Grok 4.6 extra-high | vendor/underwriter.cjs + underwriter.test.mjs | done |
| B22 Kill DS-02 Vercel last-resort | Grok 4.6 extra-high | ds-02-diy-letters + tests | **done** |
| B23 Smash C-00 CRS soft pull request | Grok 4.5 high | c-00-crs-soft-pull-request + tests | done |
| B20 Wire shouldDrawChart into gold shell | Grok 4.5 high | gold-report-shell + tests | done |
| B21 Smash U-03 CRS snapshot sync | Grok 4.5 high | u-03-crs-snapshot-sync + tests | done |
| B24 Smash U-04 promote CRS primary | Grok 4.5 high | u-04-promote-crs-primary + tests | done |
| B25 Smash lender-match missing scores | Grok 4.6 extra-high | generate-deliverables.js + tests | **done** |
| B27 Smash U-05 data health monitor | Grok 4.5 high | u-05-data-health-monitor + tests | done |
| B26 Update U-02 actual journey | Grok 4.5 high | docs/journeys U-02 actual + CHANGELOG | **done** — U-02 gates traced; new actual + CHANGELOG |
| B28 Smash C-02 inquiry created | Grok 4.5 high | c-02-inquiry-created + tests | **done** |
| B30 Smash C-02b inquiry removal requested | Grok 4.5 high | c-02b-inquiry-removal-requested + tests | **done** |
| B31 Smash C-03 inquiry removed resume/hold | Grok 4.5 high | c-03-inquiry-removed-resume-or-hold + tests | **done** |
| B34 Smash DPC-02 call outcome enforcement | Grok 4.5 high | dpc-02-call-outcome-enforcement + tests | **done** |
| B35 Smash DPC-03 inbound reply router | Grok 4.5 high | dpc-03-inbound-reply-router + tests | **done** |
| B36 Smash F-05 inquiry cleanup gate | Grok 4.5 high | f-05-inquiry-cleanup-gate + tests | **done** |
| B33 Smash DPC-01 analyzer lock | Grok 4.5 high | dpc-01-analyzer-lock + tests | **done** |
| B29 Smash DS-01 repair referral | Grok 4.5 high | ds-01-repair-referral + tests | **done** |

| B32 Smash C-05 pre-funding review | Grok 4.5 high | c-05-pre-funding-review + tests | **done** |
| S-S01 Smash S-01 new lead intake | Grok 4.5 high | s-01-new-lead-intake + tests | **done** |

Do not `--prod`. Do not drain outbox. Do not commit unless Chris asks. Do not cross file fences.

## Manifests

### S-S01 — Smash S-01 new lead intake (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null).
- Missing client already returned `{ done: false, reason: "no_client" }` — held, no smash test.
- Duplicate replay already kept one tag + one card — held, no fetch trap.
- No source grep against live CRS / outbox drain.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Smash tests lock missing client, null event, duplicate (one tag + one card), fetch trap, and source grep (no `fetch`, CRS pull, `CRS_ALLOW_LIVE`, outbox `drain` / `dispatchDue`, Vercel / Bland / GHL hosts).

**Files touched:**
- `src/workflows/s-01-new-lead-intake.mjs`
- `src/workflows/s-01-new-lead-intake.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** other sales workflows, messaging, GHL. No `--prod`. `CRS_ALLOW_LIVE` stays 0. No outbox drain.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/s-01-new-lead-intake.test.mjs` → **6 pass** (2 prior + 4 smash). 0 fail, 0 skip.

**Leftover:** none in fence. Card placement still skips when `orgId` is missing (by design).

### B25 — Smash lender-match missing scores (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-fix):**
- B7 leftover: `matchLenders` reads `consumerSignals.scores.median`. Missing / null scores threw and crashed the whole pack (funding included) before Claude.
- A throw from `detectViolations` or `validatePreSend` inside a furnisher letter still crashed a non-funding pack, so analysis docs already built never returned.

**Fixes:**
- Missing or null scores → skip the lender-match doc (no Claude call). Other analysis docs still generate. Empty match list in the payload.
- `matchLenders` throw → same skip, pack continues.
- Violation-check throw → skip that furnisher letter. Personal-info / inquiry letters and analysis docs still return.
- Pre-send validator throw → skip that letter, pack continues.

**Files touched:**
- `vendor/underwriteiq-full/api/lite/crs/generate-deliverables.js`
- `src/underwrite/generate-deliverables.test.mjs`

**Not touched:** render-pdf, letter-generator, letter-pack, lender-matrix.js. No commit, no `--prod`. Fetch stubbed. No live Claude.

**Verify:** `node --test src/underwrite/generate-deliverables.test.mjs` → **11 pass** (7 prior + 4 smash). 0 fail, 0 skip. Vendor `__tests__/generate-deliverables-dispute.test.js` → **13 pass**.

**Leftover:** stale copy at `vendor/underwriteiq-crs/generate-deliverables.js` is outside the fence.


### B19 — Smash underwriter unknown→0 (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-lock):**
- Vendored `numOrZero()` turned null / blank / `"null"` negatives, inquiries, and late-payments into **0**.
- `fundable` requires `neg === 0`, so a client with only a score (unknown negatives) read as **fundable** and got "You're approved".
- Blank utilization (`""`, `"   "`) became **0%** via `Number("   ") === 0` — looks paid-down.
- Boolean `false` and `[]` also coerced to 0 for counts.

**Fixes (coerce/count helpers only; tradeline limit/balance still `numOrZero`):**
- `toNumberOrNull` — blank / `"null"` / boolean / non-number → null (never `Number("   ")` → 0).
- `measuredCount` / `measuredPct` — unknown and negative stay **null**.
- `inquirySlot` — pulled bureau with unknown inquiries stays null; unpulled bureau slot stays 0 so a real pull is not swallowed. Total is null if any slot is null.
- `fundable` still requires `neg === 0` — null no longer matches, so unknown is not a clean file.
- Unknown lates no longer unlock loan stacking (`lates === 0`).

**0 vs null: locked.**
- Unknown negatives → `metrics.negative_accounts === null`, `fundable === false`.
- Measured `0` / `"0"` negatives still fundable (when score/util pass).
- Unknown utilization → `metrics.utilization_pct === null`, never 0. Measured 0% stays 0.
- Honesty fixture (score only) is not fundable and does not emit "You're approved".

**Files touched:**
- `src/underwrite/vendor/underwriter.cjs` (live engine; it does not require another file)
- `src/underwrite/underwriter.test.mjs` (new)
- `src/underwrite/fixtures.test.mjs` (FIXTURE 2 retargeted from the old trap pin; provenance skip for the new test import)

**Not touched:** engine.mjs (B12 wrap), adapter.mjs (B13), suggestions.cjs. No commit, no `--prod`.

**Verify:** `node --test src/underwrite/underwriter.test.mjs src/underwrite/fixtures.test.mjs src/underwrite/engine.test.mjs src/underwrite/adapter.test.mjs` → **100 pass**. Smash file alone: **36 pass**.

**Leftover:**
- `engine.mjs` header still says the vendor collapses unknown to 0 (comment is stale; wrap not edited).
- Catch-path `SAFE_EMPTY_UNDERWRITE` still uses `negative_accounts: 0` (throw path, not an available bureau).
- Unknown utilization still does **not** block fundable (`util == null || util <= 30`) — value stays null; that branch is unchanged.
- `score ?? 0` on bureau summaries / `getNumberField` whitespace → 0 still exist.
- `adapter.mjs` missing-field `effect` text still says the engine counts 0 negatives.
- Unused copy `vendor/underwriteiq-full/api/lite/underwriter.js` still has the old `numOrZero` trap (not imported).

### B22 — Kill DS-02 Vercel last-resort (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**COMPLIANCE REVIEW REQUIRED** — dispute / DIY repair letters (send path only; no copy change).

**What broke (pre-fix):**
- `DELIVER_LETTERS_URL` defaulted to `https://underwrite-iq-lite.vercel.app/api/lite/deliver-letters`.
- When in-repo repair pack had 0 PDFs, `deliverLettersUiq()` POSTed that URL (`postJsonTo`). Live bug (GHL out; no Vercel).
- Tests stubbed `deliverPack`, so the last-resort POST was never trapped.

**Fixes:**
- Removed `DELIVER_LETTERS_URL`, `deliverLettersUiq`, `postJsonTo` / `outbound-fetch`, and the Metro 2 last-resort. Repair letters come from in-repo `letter-pack` / `generateLetters` only (`deliverPack` stays as the test inject).
- Empty pack → no email, status retry (existing bar). Funding-path / null / unknown tiers still refused.
- **Fetch: gone.** No `fetch`, `fetchImpl`, `globalThis.fetch`, or Vercel URL in production source.
- Tests fail if `fetch` / `fetchImpl` is called, including when `UIQ_DELIVER_LETTERS_URL` is the Vercel URL. Source grep fails on `fetch(`, `fetchImpl`, `postJsonTo`, `DELIVER_LETTERS`, `UIQ_DELIVER`, `vercel.app`, `underwrite-iq-lite`, `deliverLettersUiq`.

**Files touched:**
- `src/workflows/ds-02-diy-letters.mjs`
- `src/workflows/ds-02-diy-letters.test.mjs`

**Not touched:** c-06 (B6), deliver-letters.js (B17), letter-pack, u-02. No commit, no `--prod`, no email.

**Verify:** `node --test src/workflows/ds-02-diy-letters.test.mjs` → **14 pass** (9 prior + 5 smash). 0 fail, 0 skip.

**Leftover:** `invoice-workflows.pg.test.mjs` (outside fence) still passes `fetchImpl: okFetch` and expects `delivery.delivered === true` with no `deliverPack` stub — against a CRS-less fixture that now correctly returns 0 PDFs. CLAUDE.md still lists DS-02 as a letter-delivery POST exception. `src/metro2/diy/deliver.mjs` is unused by this workflow now.

### B35 — Smash DPC-03 inbound reply router (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / undefined event threw (`Cannot read properties of null (reading 'payload')`).
- No smash locks for empty body, missing client (fetch / no-message fence), null event, or source grep against live CRS / outbox drain.
- Duplicate YES already kept one task; RESCHEDULE duplicate already kept one queued SMS — but neither had a fetch trap.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Missing client → `{ done: false, reason: "no_client" }` (already); locked with fetch trap + no messages / no tasks / no mint.
- Empty body (`""` / whitespace / `null` / `undefined`) → `{ done: false, reason: "no_decision_keyword" }`; no tasks, no SMS queue, no cards.
- Duplicate YES: one task, zero messages, no fetch.
- Duplicate RESCHEDULE: one task, one queued SMS (`sendTemplated` idempotent), single `setter:reschedule` tag, no fetch.
- Source grep: no `fetch`, no CRS pull, no `CRS_ALLOW_LIVE`, no outbox `drain` / `dispatchDue`.

**Files touched:**
- `src/workflows/dpc-03-inbound-reply-router.mjs`
- `src/workflows/dpc-03-inbound-reply-router.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** dpc-01, messaging providers, GHL. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0. No outbox drain.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/dpc-03-inbound-reply-router.test.mjs` → **16 pass** (11 prior + 5 smash). 0 fail, 0 skip.

**Leftover:** none in fence. Reschedule still queues via `sendTemplated` (by design; does not drain).

### B36 — Smash F-05 inquiry cleanup gate (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null).
- Missing client already returned `{ done: false, reason: "no_client" }` — held, no smash test.
- Duplicate replay already no-op'd second UPDATE — held, no fetch / SMS fences.
- Empty inquiry payload / empty `inquiry_log` already returned `{ done: true, updated: 0 }` — held, no smash test.
- No source grep against live CRS / SMS / mail.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Smash tests lock missing client, duplicate (`updated: 0` second pass), empty inquiry payload (`updated: 0`), null event, fetch trap, and source grep (no `fetch`, `sendTemplated`, `crs-pull`, `CRS_ALLOW_LIVE`, provider SMS/mail).

**Files touched:**
- `src/workflows/f-05-inquiry-cleanup-gate.mjs`
- `src/workflows/f-05-inquiry-cleanup-gate.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** c-02, c-02b, c-03. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/f-05-inquiry-cleanup-gate.test.mjs` → **7 pass** (3 prior + 4 smash). 0 fail, 0 skip.

**Leftover:** none in fence.

### S-F01 — Smash F-01 funding intake (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null).
- Missing client already returned `{ done: false, reason: "no_client" }` — held, no smash test.
- Duplicate replay already kept one pod task — held, no fetch / drain fences.
- No source grep against live CRS / outbox drain / `dispatchDue`.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Smash tests lock missing client, duplicate (`podTask.created: false` second pass), null event, fetch trap, and source grep (no `fetch`, `CRS_ALLOW_LIVE`, `dispatchDue`).

**Files touched:**
- `src/workflows/f-01-funding-intake.mjs`
- `src/workflows/f-01-funding-intake.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** f-02–f-11. No `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/f-01-funding-intake.test.mjs` → **8 pass** (4 prior + 4 smash). 0 fail, 0 skip.

**Leftover:** none in fence.

### B32 — Smash C-05 pre-funding review (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null).
- CRS Complete always raised "Review Funding File" + pre-funding task — no Rule 4 gate. `MANUAL_REVIEW` (and other non-funding tiers) entered the funding review path.
- No smash tests for missing client, MANUAL_REVIEW vs funding, null event, duplicate `task.created`, or a source grep against letter-pack / live CRS / fetch.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Missing client → `{ done: false, reason: "no_client" }` (already); locked with fetch trap + no tasks / no messages.
- Product-path gate (`clientOutcomeTier` + `isFundingPath`) before CRS branch — `MANUAL_REVIEW` / non-funding → `{ done: false, branch: "not_funding" }`, no review task, no "Pull CRS" hold, no pack.
- Funding tiers still review when CRS Complete; incomplete CRS still awaits pull.
- Duplicate replay: second run `task.created: false`; one task; no fetch / no messages.
- Source grep + runtime `fetch` trap: no letter-pack, no `sendTemplated`, no live CRS / `CRS_ALLOW_LIVE`.

**Files touched:**
- `src/workflows/c-05-pre-funding-review.mjs`
- `src/workflows/c-05-pre-funding-review.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** c-06, u-02, letter-pack. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/c-05-pre-funding-review.test.mjs` → **9 pass** (3 prior + 6 smash). 0 fail, 0 skip.

**Leftover:** none in fence.

### B34 — Smash DPC-02 call outcome enforcement (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null).
- No smash tests for missing client, empty outcome (null / `{}` / empty times), null event, or a source grep against live CRS / letter pack / fetch.
- Duplicate replay already kept a single card, but had no fetch / message fences.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Missing client → `{ done: false, reason: "no_client" }` (already); locked with fetch trap + no messages / no cards.
- Empty outcome (`null` / `{}` / null times / empty-string times) → `{ done: false, reason: "no_appointment_time" }`; no card move, no `call_outcome`, no tags, no fetch, no messages.
- Duplicate replay: single card; single `call:no_show` tag; `call_outcome: "no_show"` once; no fetch, no messages.
- Source grep + runtime `fetch` trap: no pull, no `sendTemplated`, no letter pack, no `CRS_ALLOW_LIVE`.

**Files touched:**
- `src/workflows/dpc-02-call-outcome-enforcement.mjs`
- `src/workflows/dpc-02-call-outcome-enforcement.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** dpc-01, u-02, s-06. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/dpc-02-call-outcome-enforcement.test.mjs` → **10 pass** (6 prior + 4 smash). 0 fail, 0 skip.

**Leftover:** none in fence.

### B29 — Smash DS-01 repair referral (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event threw on `event.payload` (`Cannot read properties of null`).
- `declineReason: "Funding Didn't Buy"` with a stale `repairReferral: true` still counted as a repair referral (`isRepairReferral` → true) — funding-lane outcome wrongly treated as partner referral.
- Missing client / funding-tier block / duplicate already soft-skipped, but had no smash tests or fetch / Vercel / outbox fences.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Funding-lane decline reasons (`funding didn't buy` / variants) → `not_repair_referral` even when `repairReferral: true`.
- Missing client → `{ done: false, reason: "no_client" }` (held); locked with fetch trap.
- All funding tiers (`FULL_FUNDING` / `FUNDING_PLUS_REPAIR` / `PREMIUM_STACK`) → `blocked_funding_route:*`; no tag, no messages, no fetch.
- Duplicate replay: still 2 queued messages (email+sms once); no fetch; source has no Vercel / dispatch / drain.

**Files touched:**
- `src/workflows/ds-01-repair-referral.mjs`
- `src/workflows/ds-01-repair-referral.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** ds-02, u-02, letter-pack. No commit, no `--prod`.

**Verify:** `node --test src/workflows/ds-01-repair-referral.test.mjs` → **18 pass** (11 prior + 7 smash). 0 fail, 0 skip.

**Leftover:** null `outcome_tier` at `call.completed` still allows send (pre-existing lock-in test); not in this smash list.
### B28 — Smash C-02 inquiry created (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `event.payload` and threw.
- No tests for missing client, empty/null payload, null event, or a source grep against live pull / SMS / email.
- Duplicate replay already skipped a second log/task, but had no fetch/SMS fences.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Missing client → `{ done: false, reason: "no_client" }` (already); locked with fetch trap + no inquiry_log / no tasks / no messages.
- Empty payload (`null` / `{}` / `newInquiries: []` / `newInquiries: null` / scores-only): `{ done: false, reason: "no_new_inquiries" }`; no pull, no SMS, no mail.
- Duplicate replay: second run `task.created: false`; one inquiry_log row; one task; no fetch, no messages.
- Source grep + runtime `fetch` trap: no pull, no `sendTemplated`, no SMS, no `CRS_ALLOW_LIVE`. Product never emailed here — no new mail added.

**Files touched:**
- `src/workflows/c-02-inquiry-created.mjs`
- `src/workflows/c-02-inquiry-created.test.mjs`

**Not touched:** c-02b, c-03, c-00, c-06. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/c-02-inquiry-created.test.mjs` → **7 pass** (3 prior + 4 smash). 0 fail, 0 skip.

**Leftover:** none in fence.

### B33 — Smash DPC-01 analyzer lock (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null/undefined).
- Missing client already returned `{ done: false, reason: "no_client" }` — held, no smash test.
- Empty payload (`null` / `{}`) already locked progress markers — held, no smash test.
- Duplicate replay already re-merged the same markers — held, no fetch/email fence.
- No source grep against live CRS / pack email.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Missing client → `{ done: false, reason: "no_client" }` (already); locked with fetch trap + no messages / no tasks / no events.
- Empty payload: still writes `last_progress_action` / timestamp; never writes `analyzer_path`; no pull, no email.
- Duplicate replay: same markers; no messages, no events, no tasks, no fetch.
- Source grep + runtime `fetch` trap: no pull, no `sendTemplated`, no `CRS_ALLOW_LIVE`, no letter-pack / u-02.

**Files touched:**
- `src/workflows/dpc-01-analyzer-lock.mjs`
- `src/workflows/dpc-01-analyzer-lock.test.mjs`

**Not touched:** u-02, c-06, other dpc-*. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/dpc-01-analyzer-lock.test.mjs` → **6 pass** (1 prior + 5 smash). 0 fail, 0 skip.

**Leftover:** none in fence. Progress lock still uses `new Date()` when `occurredAt` is absent — intentional.

### B18 — Smash CRS live fence (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-fix):**
- Production host + `CRS_ALLOW_LIVE` missing / `0` / `false` / empty / unset still built a client and called `loadClientIdentity` (Social Security number path) before refusing.
- That throw (`unexpected query` on the identity read) instead of a clean `production_host_refused` fail-closed. Fetch was not reached only because it crashed first.
- Injected production client with live off still ordered bureaus the same way.
- Missing CRS env had no smash test that fetch never ran.
- All three bureaus failing already closed as `no_reports` with no row — no smash test, so an empty success row could have shipped.

**Fixes:**
- Coordinator fence: production host + live not explicitly on → `finishFailed(production_host_refused)` **before** client HTTP, **before** Social Security number reveal, **before** `orderPrequal`.
- Missing CRS env → `not_configured`, no fetch, no row.
- All three bureau failures → `no_reports`, ledger `failed`, **zero** `crs_results` rows (no invented empty success).
- `fetchImpl` wrapped: a production URL with live off throws `production_host_refused` (whole pull fails, not one bureau).
- Tests fail if a live CRS host URL is fetched. Source grep refuses `fetch(`, the live hostname, and `CRS_ALLOW_LIVE='1'`.
- Never set `CRS_ALLOW_LIVE=1`. No secrets printed.

**Files touched:**
- `src/finance/crs-pull.mjs`
- `src/finance/crs-pull.test.mjs`

**Not touched:** adapter.mjs, engine.mjs, crs-tier, c-00, c-06. No commit, no `--prod`. Live CRS stays off.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/finance/crs-pull.test.mjs` → **15 pass** (5 prior + 10 smash). 0 fail, 0 skip.

**Leftover:** none in fence. Sandbox HTTP is still allowed when live is off (live = production host + flag). Turning live on is out of scope.

### B31 — Smash C-03 inquiry removed resume/hold (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null).
- Missing client already returned `{ done: false, reason: "no_client" }` — held, no smash test.
- Duplicate replay already skipped a second task — held, no `task.created` / fetch / SMS fences.
- Empty inquiry payload (`null` / `{}` / blank inquiryId / null inquiry / `inquiries: []`) already resumed — held, no smash test.
- No source grep against live CRS / SMS / mail.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Smash tests lock missing client, duplicate (`task.created: false`), empty inquiry resume, null event, fetch trap, and source grep (no `fetch`, `sendTemplated`, `crs-pull`, `CRS_ALLOW_LIVE`, provider SMS/mail).

**Files touched:**
- `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs`
- `src/workflows/c-03-inquiry-removed-resume-or-hold.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** c-02, c-02b, c-06. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/c-03-inquiry-removed-resume-or-hold.test.mjs` → **7 pass** (3 prior + 4 smash). 0 fail, 0 skip.

**Leftover:** none in fence.

### B30 — Smash C-02b inquiry removal requested (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null).
- No tests for missing client, empty inquiry payload, null event, or a source grep against live CRS / SMS / fetch.
- Duplicate replay already kept a single tag, but had no fetch / message fences.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Missing client → `{ done: false, reason: "no_client" }` (already); locked with fetch trap + no messages / no tasks.
- Empty inquiry payload (`null` / `{}` / `inquiries: []` / `newInquiries: []` / `inquiry: null`): still queues `run_inquiry_removal` + `inquiry-removal-queued` once; no pull, no SMS.
- Duplicate replay: single tag; `run_inquiry_removal` stays true; no fetch, no messages.
- Source grep + runtime `fetch` trap: no pull, no `sendTemplated`, no Bland/GHL host, no `CRS_ALLOW_LIVE`.

**Files touched:**
- `src/workflows/c-02b-inquiry-removal-requested.mjs`
- `src/workflows/c-02b-inquiry-removal-requested.test.mjs`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** c-02, c-03, bland/GHL. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/c-02b-inquiry-removal-requested.test.mjs` → **6 pass** (2 prior + 4 smash). 0 fail, 0 skip.

**Leftover:** none in fence.

### B26 — Update U-02 actual journey (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high  
**One-line:** Hand-traced U-02 actual mermaid from `u-02-analyzer-complete-delivery.mjs` (no PDF → no email; funding needs four analysis PDFs; MANUAL_REVIEW no pack; REPAIR_ONLY no free pack) + CHANGELOG; role `-actual.md` pages unchanged (generator/stale suite).

**Files touched:**
- `docs/journeys/u-02-analyzer-complete-delivery-actual.md` (new)
- `docs/journeys/CHANGELOG.md`
- `docs/workflows/gold-break-gauntlet.md` (board only)

**Not touched:** `*-intended.md`, `client-actual.md` / other generated role actuals, `src/workflows/u-02-analyzer-complete-delivery.mjs` (read only). No commit, no `--prod`.

### B27 — Smash U-05 data health monitor (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / non-object event called `resolveClient` and threw (`event.orgId` on null).
- No tests for missing client, empty/null payload, null event, or a source grep against live pull / email.
- Duplicate replay already skipped a second task, but had no fetch/email fences.

**Fixes:**
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Missing client → `{ done: false, reason: "no_client" }` (already); locked with fetch trap + no messages / no tasks.
- Empty payload (`null` / `{}` / scores-only / utilization-only / all-null scores): tag `analyzer:data-incomplete` + mapping task once per event id; no pull, no email.
- Duplicate replay: second run `task.created: false`; one task; single incomplete tag; no fetch, no messages.
- Source grep + runtime `fetch` trap: no pull, no `sendTemplated`, no `CRS_ALLOW_LIVE`.

**Files touched:**
- `src/workflows/u-05-data-health-monitor.mjs`
- `src/workflows/u-05-data-health-monitor.test.mjs`

**Not touched:** u-03, u-04, crs-pull. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/u-05-data-health-monitor.test.mjs` → **7 pass** (3 prior + 4 smash). 0 fail, 0 skip.

**Leftover:** none in fence. Unhealthy path still needs `event.orgId` for `createTask` (pre-existing); null-orgId + incomplete fields would still throw — not in this smash list.

### B1 — Smash letters (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high  
**COMPLIANCE REVIEW REQUIRED** — dispute / inquiry / personal-info letter generator. No new FCRA claims; existing template bodies only.

**Owner 10 (held unless noted):**
1. Three bureaus, 0 tradelines, 0 inquiries, no identity diffs → 0 PDFs. Held.
2. TransUnion inquiries empty, Experian has inquiries → no `inquiry_tu.pdf`; `inquiry_ex.pdf` has FCRA 604 + creditors. Held.
3. Personal-info with matching name/SSN/address/employer/DOB → 0 `personal_info` PDFs. Held.
4. `personal: null` / `{}` → no throw, safe letters. Held. **Broke:** `generateLetters(null)` (and the other three generators) threw on destructure.
5. Unicode / apostrophe names (O'Brien, José, 李) → `%PDF`, no throw. Held.
6. 80 inquiries → real body, ~14ms (bar 15s). Held.
7. Derogatory tradeline missing name/dates/balance → Round 1 with Unknown creditor + Field 20 body, not header-only. Held.
8. No `priorOutcome` → Round 1 only, never empty R2. Held. **Broke:** whitespace `"   "` dropped the account (0 PDFs); `" verified "` also dropped instead of Round 2.
9. Extracted text must not contain fundhub / FundHub. Held.
10. Every emitted PDF starts `%PDF` and extracted body > 200 chars. Held.

**Extra smash that broke:**
- `tradelines: "nope"` threw (`filter is not a function`) on dispute and inquiry paths.
- `names` / `addresses` as a single string threw (`map is not a function`).

**Fixes:**
- `asInput` / `asPerson` / `asBureaus` — null payload → `[]`, no throw.
- `asTradelines` / `asStringList` — junk lists → empty or a one-item string list; never crash.
- `priorOutcomeOf` trims: blank → Round 1; `" verified "` → Round 2 with the existing e-OSCAR body.

**Files touched:**
- `vendor/underwriteiq-full/api/lite/letter-generator.js`
- `vendor/underwriteiq-full/api/lite/__tests__/letter-generator.test.js`
- `src/underwrite/letter-generator.test.mjs`

**Not touched:** letter-pack, gold-report-shell, apply-qr, fh-charts, workflows, messaging. No commit, no `--prod`, no outbox drain.

**Verify:** `node --test src/underwrite/letter-generator.test.mjs vendor/underwriteiq-full/api/lite/__tests__/letter-generator.test.js` → **37 pass** (18 + 19). 0 fail, 0 skip.

**Leftover:** CJK-only inquiry creditor names are dropped (cannot draw in Helvetica; empty body → no letter). `inquiries: []` still wins over `inquiryList` (explicit empty list). Typeface stays Claude (W8).

### B2 — Smash JSON/report parse (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-fix):**
- A whole-document `if (/```json/)` bail turned mixed markdown + a JSON fence into one "could not be formatted" callout and dropped the real headings.
- Raw `{ "t": "sec", ... }` sitting in markdown printed as a paragraph (the production Claude dump).
- Gold `{ t: "sec" }` objects passed into `contentToNodes` became `""` and rendered empty.
- Trailing commas, double-encoded JSON, and `{ report: { sections } }` wrappers all failed `JSON.parse` and became the unusable callout (no dump, but no report either).
- `parseMarkdown` printed `` ```json `` fence lines as body paragraphs.

**Fixes:**
- Split fences linearly; JSON fences become nodes; surrounding markdown stays.
- Bare gold / sections JSON on its own line is parsed, never printed.
- Object input goes through `goldDocToNodes` / `nodesFromJsonDoc`.
- Lenient JSON: trailing commas, unwrap a JSON string, walk `report` / `doc` wrappers.
- Truncated / unusable JSON → amber callout, never the fence, never a throw.
- Empty / null / whitespace → `[]`.
- Cap: 256KB, 12k markdown lines, 8k nodes.
- `parseMarkdown` skips fenced blocks instead of printing them.

**Outcome stamp:** already `stampedOutcome`. Added regression: `engine.outcome_tier` `FULL_FUNDING` wins over `outcome: MANUAL_REVIEW` and over body text that says `MANUAL_REVIEW`.

**Files touched:**
- `vendor/underwriteiq-full/api/lite/crs/render-pdf.js` (`contentToNodes` / `parseMarkdown` / JSON fence handling only)
- `vendor/underwriteiq-full/api/lite/__tests__/render-pdf-content-nodes.test.js`
- `src/underwrite/gold-report-shell.test.mjs` (tests only)

**Not touched:** apply-qr, letter-generator, fh-charts, letter-pack, gold cover/close, `DRAW_QR`. No commit, no `--prod`.

**Verify:** `node --test vendor/underwriteiq-full/api/lite/__tests__/render-pdf-content-nodes.test.js src/underwrite/gold-report-shell.test.mjs` → **34 pass**, 0 fail (13 content-nodes + 21 shell, including sibling B20 chart-gate tests in the shell file).

**Leftover:** none in fence. Cover stamp still comes from `stampedOutcome`; body markdown that literally says `MANUAL_REVIEW` can still appear as prose (stamp still wins).

### B24 — Smash U-04 promote CRS primary (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Named `crsResultId` was never checked — a missing `crs_results` row still promoted from the payload.
- A `crs_results` row for another org/client still promoted (same throw-class harm as the lifecycle anchor, but U-04 threw nothing and wrote wrong primary).
- Already-primary re-runs with a missing `scores.ex` could null an existing `primary_fico_score` (`?? null`).
- No `primary:crs` tag after removing `primary:analyzer`.
- No fetch / live-CRS fence in tests.

**Fixes:**
- When `crsResultId` is set: look up the row; missing → `{ done: false, reason: "missing_crs_row" }`; wrong org/client → `{ done: false, reason: "wrong_org" }`. Never throw.
- Already-primary: still refreshes present scores, returns `{ done: true, reason: "already_primary" }`. Absent score skipped (no null wipe).
- Add `primary:crs` alongside analyzer untag.
- Null/non-object event → `no_event`. Fetch trap + source grep: no `fetch`, no `runCrsPull`, no `CRS_ALLOW_LIVE`.

**Files touched:**
- `src/workflows/u-04-promote-crs-primary.mjs`
- `src/workflows/u-04-promote-crs-primary.test.mjs`

**Not touched:** u-03, c-06, adapter. No commit, no `--prod`, no live CRS.

**Verify:** `node --test src/workflows/u-04-promote-crs-primary.test.mjs` → **11 pass** (2 prior + 9 smash). 0 fail, 0 skip.

**Leftover:** Legacy events with no `crsResultId` still promote from the payload (no row required). Five-field primary copy beyond FICO stays out of scope.

### B20 — Wire shouldDrawChart into gold shell (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- B4 exported `shouldDrawChart` but gold-report-shell never called it.
- Slot builders already nulled waterfall/money_chain args when projected ≤ current, but a forced chart node could still call the chart fn.
- Empty-string SVG (`CHART_SUPPRESSED`) was falsy in `renderChartSlot`, but there was no test that a suppressed chart does not paint.

**Fixes:**
- Sync-import `shouldDrawChart` from `fh-charts.mjs` into the gold shell.
- `tryFhChart` gates with `shouldDrawChart` before calling the chart; empty SVG → null.
- `injectChartSlots` filters waterfall/money_chain via `shouldDrawChart(name, { current, projected })` and stamps `gain` on the node.
- `renderChartSlot` re-checks the gain gate for waterfall/money_chain before paint.

**Files touched:**
- `vendor/underwriteiq-full/api/lite/crs/gold-report-shell.js` (injectChartSlots / tryFhChart / renderChartSlot only)
- `src/underwrite/gold-report-shell.test.mjs`

**Not touched:** fh-charts.mjs (B4), cover/close/fonts, typeface. No commit, no `--prod`.

**Verify:** `node --test src/underwrite/gold-report-shell.test.mjs` → **21 pass** (3 new: gate-before-call, empty-string no paint, inject skip). 0 fail, 0 skip.

### B21 — Smash U-03 CRS snapshot sync (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- CRS `analysis.completed` with **no scores** still stamped `crs_status: "Complete"` and tagged `crs:snapshot` — lying that the soft pull finished.
- No tests for missing client, missing scores, duplicate replay, null event, or a source grep against live pull / email.

**Fixes:**
- `hasResults` (same rule as C-06): need at least one of `ex` / `eq` / `tu`. Missing → tag `hold:snapshot_missing`, leave status alone, no `crs:snapshot`.
- Null / non-object event → `{ done: false, reason: "no_event" }` (no throw).
- Missing client → `{ done: false, reason: "no_client" }` (already); locked with fetch trap + no messages / no events.
- Duplicate replay: safe re-merge; tags stay a single `crs:snapshot`; no fetch, no messages, no soft-pull events.
- Real scores clear a prior `hold:snapshot_missing`.
- Source grep + runtime `fetch` trap: no pull, no `sendTemplated`, no `CRS_ALLOW_LIVE`.

**Files touched:**
- `src/workflows/u-03-crs-snapshot-sync.mjs`
- `src/workflows/u-03-crs-snapshot-sync.test.mjs`

**Not touched:** c-06, u-02, crs-pull, adapter. No commit, no `--prod`. `CRS_ALLOW_LIVE` stays 0.

**Verify:** `CRS_ALLOW_LIVE=0 node --test src/workflows/u-03-crs-snapshot-sync.test.mjs` → **9 pass** (2 prior + 7 smash). 0 fail, 0 skip.

**Leftover:** none in fence. U-03 still writes `crs_fico_score` from Experian only (`scores.ex`) — same as before; eq/tu-only pulls Complete with null FICO field.

### B14 — Smash gauntlet Gmail rewrite (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-fix):**
- Rewrite lived only inside `dispatchQueued`, with no test. A failed `UPDATE` still called dispatch, so plus-aliases could hit Resend onboarding and bounce.
- `sendUiqDeliverables` would send a funding pack if the MANUAL_REVIEW plus-alias was passed in `emails`.
- `retryHeldSampleMail` could retry queued mail for the review roster row.

**Fixes:**
- `rewriteOutboundToGmail` updates `messages.to_address` to `stanbridgejchris@gmail.com` and **refuses dispatch** unless that value stuck (`RETURNING`).
- All three send paths go through `dispatchQueued` → rewrite then mockable `dispatchMessage`: `sendUiqDeliverables`, `runGauntlet`, `retryHeldSampleMail`.
- `clients.email` stays the unique plus-alias (INSERT/UPDATE clients never `SET email`).
- MANUAL_REVIEW (`mail: none`) never dispatches a pack; review emails are stripped from UIQ send and from held-mail retry.
- Tests inject fake db + dispatch. No live network, no outbox drain, no `--prod`.

**Paths that rewrite:** `rewriteOutboundToGmail` → used only by `dispatchQueued`, which is the only send gate for:
- `sendUiqDeliverables`
- `runGauntlet` (funding U-02 + repair DS-02)
- `retryHeldSampleMail`

**Files touched:**
- `scripts/tmp-letter-gauntlet.mjs`
- `scripts/tmp-letter-gauntlet.test.mjs` (new)

**Not touched:** `dispatch.mjs`, `resend.mjs`, `messaging.mjs` (B5), `apply-qr.js` (W4). No commit, no `--prod`, no live Resend, no outbox drain.

**Verify:** `node --test scripts/tmp-letter-gauntlet.test.mjs` → **13 pass**, 0 fail, 0 skip.

**Leftover:** live one-shot still talks to real Resend when Chris runs the script (not tests). Platform dispatcher still does not rewrite plus-aliases globally — that stays in this gauntlet file on purpose.

### B11 — Smash CRS tier stamp (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-fix):**
- `null` / `{}` CRS result threw (`rawResponsesFromMerged` / no bureau reports).
- Engine throw or missing outcome threw — callers never got a stamp.
- Empty scores + empty tradelines could still be handed to a lying engine as `FULL_FUNDING`.
- No documented winner for CRS-row `outcome_tier` vs engine guess.

**Winner (locked):** exact known 6-tier **stamp always wins**. Engine guess is used only when the stamp is missing or not an exact known name (no trim, no case-fold, no aliases). Fail closed → `MANUAL_REVIEW`, never silent `FULL_FUNDING`.

- Funding stamp + engine `MANUAL_REVIEW` → funding (samples).
- `MANUAL_REVIEW` / `FRAUD_HOLD` stamp + engine funding → stamp (review stays review).
- Garbage / SQL stamp ignored; engine or fail-closed.

**Files touched:**
- `src/finance/crs-tier.mjs`
- `src/finance/crs-tier.test.mjs`

**Not touched:** letter-pack, u-02, product-path (B10), gold-report-shell. No commit, no `--prod`.

**Verify:** `node --test src/finance/crs-tier.test.mjs` → **20 pass**. Callers: `src/finance/crs-pull.test.mjs` → **5 pass**.

**Leftover:** `runCrsPull` still does not pass `opts.outcomeTier` (first write, column is null). letter-pack still overwrites `engine.outcome` from `clients.outcome_tier` after this call (B3 fence).

### B7 — Smash generate-deliverables (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-fix):**
- Funding pack already skipped dispute letters (`opts.pack === "funding"`). Held.
- Missing ANTHROPIC key already skipped via `safeCallClaude` (null docs, no throw, no fake JSON). Held.
- Timeout on an analysis doc already skipped. Held.
- Claude fenced JSON blob was stored as the document body (would print as the PDF).
- Empty / whitespace Claude replies were stored as empty strings instead of skipped.
- Dispute-letter `callClaude` was not wrapped — a timeout threw and crashed the pack.

**Fixes:**
- `usableClaudeContent` — empty, json fence, or whole-payload JSON becomes null (do not store as markdown). Render-pdf still owns JSON to nodes; we refuse to save the dump.
- `safeCallClaude` runs that filter after a successful call.
- Furnisher dispute plus retry now use `safeCallClaude` (timeout / empty / fence skip the letter, pack continues).
- Smash tests stub fetch so unit tests never hit live Anthropic.

**Files touched:**
- `vendor/underwriteiq-full/api/lite/crs/generate-deliverables.js`
- `src/underwrite/generate-deliverables.test.mjs` (new — CI-runnable)

**Not touched:** render-pdf.js, gold-report-shell.js, letter-generator.js, apply-qr.js, fh-charts, letter-pack (B3). No commit, no `--prod`, no live ANTHROPIC spend.

**Verify:** `node --test src/underwrite/generate-deliverables.test.mjs` → **7 pass**; vendor `__tests__/generate-deliverables-dispute.test.js` → **13 pass**.

**Leftover:** `matchLenders` still throws if `consumerSignals.scores` is missing (crashes before Claude). `detectViolations` / `validatePreSend` throws inside a furnisher letter are still uncaught. Stale copy at `vendor/underwriteiq-crs/generate-deliverables.js` is outside the fence.

### B3 — Smash pack + no-mail gates (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-fix):**
- U-02 sent funding mail if *any* PDF existed — inquiry/personal-info only, or a stub `funding-pack.pdf`, skipped the four analysis docs.
- `buildLetterPackForClient` stamped `clients.outcome_tier` onto the engine (sample-roster `FULL_FUNDING` override).
- Missing client / CRS could throw out of the pack builder.
- DS-02 treated UIQ `delivered: true` with **zero files** as a send.
- `documentsFromDeliverables` / `filterPack` did not hard-drop junk input (null / array / unknown types were only incidentally empty).

**Fixes:**
- U-02: no `sendTemplated` on empty pack, missing four analysis PDFs, `MANUAL_REVIEW`, or pack-builder throw. `REPAIR_ONLY` still tags only (no free pack). Repair template `compliance_passed` not flipped.
- DS-02: still refuses funding-path / null / unknown tiers. Empty letter files → no email, status retry. Replay skip does not re-send.
- Removed engine `outcome_tier` stamp. Missing client/CRS → documented skip, no throw.
- `hasFundingAnalysisPdfs` is the four-doc gate (type or filename). Unknown deliverable types dropped. No Claude without `crsResult` (tests stay letter-only).

**Files touched:**
- `src/underwrite/letter-pack.mjs`
- `src/underwrite/letter-pack.test.mjs`
- `src/underwrite/letter-pack-filter.mjs`
- `src/underwrite/letter-pack-filter.test.mjs`
- `src/workflows/u-02-analyzer-complete-delivery.mjs`
- `src/workflows/u-02-analyzer-complete-delivery.test.mjs`
- `src/workflows/ds-02-diy-letters.mjs`
- `src/workflows/ds-02-diy-letters.test.mjs`

**Not touched:** letter-generator, apply-qr, gold-report-shell, fh-charts, messaging providers (B5). No commit, no `--prod`, no live Claude, no Resend.

**Verify:** `node --test` on the eight fenced test files → **35 pass**, 0 fail.

**Leftover:** U-02 `-actual` journey not updated (outside fence). Four analysis PDFs still come from generate-deliverables (B7) when `ANTHROPIC_API_KEY` is set — this unit only refuses mail without them. DS-02 still *attempts* UIQ/Vercel when the in-repo repair pack is empty; send is blocked if that returns no files (B6 owns the Vercel POST).

### B6 — Smash C-06 (no Vercel POST) (2026-08-14)

**Status:** done  
**Model:** Grok 4.6 extra-high

**What broke (pre-lock):**
- Live C-06 still POSTed `{ clientId, orgId, letterSet: "funding" }` to `https://underwrite-iq-lite.vercel.app/api/lite/deliver-letters` (W2 prove: HTTP 401). Funding letters are supposed to ship from U-02 only.
- The POST was already deleted in the working tree, but the remaining test only checked `delivery.reason`. It did **not** trap `fetch`. Re-adding the webhook would have passed.
- No test for `UIQ_DELIVER_LETTERS_URL` set, `MANUAL_REVIEW` tagging, missing client, or a source grep.

**Fixes:**
- Production handle stays tag-only. No `fetch`, no `fetchImpl`, no `postJsonTo`, no ds-02 URL import. Funding return is `{ delivered: false, reason: "letters_ship_from_u-02" }`.
- Tests now fail if `fetch` / `fetchImpl` is called, even with `UIQ_DELIVER_LETTERS_URL` pointed at Vercel.
- Source grep fails on `fetch(`, `fetchImpl`, `postJsonTo`, `DELIVER_LETTERS`, `vercel.app`, `underwrite-iq-lite`, `ds-02-diy-letters`, GHL. Proved: `HEAD` source trips the grep; current source does not.
- Tag matrix locked: funding → `path:funding`; repair → `path:repair`; `MANUAL_REVIEW` / `FRAUD_HOLD` → `not_funding`, no path tag, no send. Payload `MANUAL_REVIEW` beats a stale `FULL_FUNDING` column.
- Missing client / missing scores / non-CRS: no throw, no send, no fetch.

**Files touched:**
- `src/workflows/c-06-crs-results-router.mjs` (POST already gone; left tag-only)
- `src/workflows/c-06-crs-results-router.test.mjs`

**Not touched:** letter-pack, u-02, ds-02, letter-generator, apply-qr, messaging. No commit, no `--prod`, no outbox drain, no email.

**Verify:** `node --test src/workflows/c-06-crs-results-router.test.mjs` → **19 pass** (11 prior + 8 smash). 0 fail, 0 skip.

**Leftover:** Decline email/SMS still queues when the deferred detector is forced on (existing wiring). That is not a Vercel POST. `resolveClient` can still backfill GHL if that helper’s query is wired and a GHL key is set — outside this fence.

### B17 — Smash deliver-letters leftover (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**Path verdict:** **LEFTOVER — not live Fundhub mail.** Live letters ship from in-repo `letter-pack` (U-02 / DS-02). C-06 no longer POSTs Vercel. This file is the old `POST /api/lite/deliver-letters` Vercel HTTP handler.

**What broke (pre-fix):**
- Specs-only POSTs (`contactId` + type, no credit data) invented letter specs and called `deliverLetters` with personal only — the W6 leftover path that used to yield header-only PDFs.
- `body.bureaus` as a name filter (`["experian"]`) was never real tradeline data; handler still treated the call as a delivery.
- Empty `{}` returned 400 instead of 0 files.
- Specs-only still hit GHL lookup (outbound) before W6’s 0-letter outcome.

**Fixes:**
- Require real `bureauData` or `crsResult.normalized` before any GHL lookup or `deliverLetters` call.
- Specs-only / empty body / name-filter-only → **200, delivered: 0, generated: 0**; no invent; no outbound.
- When real bureau payload is present, pass it through to `deliverLetters` (W6 empty-item suppression still applies).

**Files touched:**
- `vendor/underwriteiq-full/api/lite/deliver-letters.js`
- `vendor/underwriteiq-full/api/lite/__tests__/deliver-letters.test.js`

**Not touched:** letter-delivery.js (W6), letter-generator.js, letter-pack, c-06. No commit, no `--prod`.

**Verify:** `NODE_ENV=test node --test vendor/underwriteiq-full/api/lite/__tests__/deliver-letters.test.js` → **7 pass**.

**Leftover:** DS-02 still has a last-resort `deliverLettersUiq` POST to this Vercel URL when in-repo pack is empty — outside this fence (B3 / ds-02). Handler can still call GHL when a caller supplies real `bureauData` (legacy path; live Fundhub does not use it).

---

### B16 — Smash build-documents (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- `normalized` null / missing `meta` / non-array `inquiries` threw on `normalized.meta.availableBureaus` and `normalized.inquiries.some`.
- Any non-hold / non-repair outcome (including null / typo) fell through to **funding** — could invent a funding pack.

**Fixes:**
- `safeNormalized` — null / holes → empty bureaus + inquiries; never throw.
- Findings / consumerSignals null-safe (void findings; coerce signals object).
- Explicit funding allowlist: `FULL_FUNDING` / `PREMIUM_STACK` / `FUNDING_PLUS_REPAIR` only.
- Unknown / null / wrong-case outcome → **hold** (fail closed, no funding letters).
- `REPAIR_ONLY` stays `package: "repair"` with repair summary docs only (no funding analysis types as primary).

**Outcome → package matrix:**
| outcome | package |
|---------|---------|
| MANUAL_REVIEW | hold |
| FRAUD_HOLD | hold |
| REPAIR_ONLY | repair |
| FULL_FUNDING | funding |
| PREMIUM_STACK | funding |
| FUNDING_PLUS_REPAIR | funding |
| null / unknown / typo / lower | hold |

**Files touched:**
- `vendor/underwriteiq-full/api/lite/crs/build-documents.js`
- `src/underwrite/build-documents.test.mjs` (new — CI-runnable)

**Not touched:** generate-deliverables (B7), summary-doc-generator (B8), letter-pack (B3), gold-report-shell, re-export `.cjs` (unchanged). No commit, no `--prod`.

**Verify:** `node --test src/underwrite/build-documents.test.mjs` → **15 pass**; vendor `__tests__/build-documents.test.js` → **14 pass**.

**Leftover:** none in fence. Four analysis PDFs still come from generate-deliverables when pack is funding (B7) — this unit only picks package kind + letter/summary specs.

### B15 — Smash underwrite report.mjs (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**Path verdict:** **LIVE — not dead leftover.** This is the staff API response assembler for `GET /api/read/underwrite` (`buildReport` / `annotateSuggestions`). It is not a PDF path and is not competing with `gold-report-shell.js`. Do not rewrite into a second gold shell.

**What broke (pre-fix):**
- `buildReport(null)` threw on destructure.
- Truthy non-array `adapter.available` threw (`includes is not a function`).
- Object / `` ```json `` / parseable-JSON suggestion payloads shipped as `text` (JSON dump in the advice list).

**Fixes (guards only):**
- Null / non-object input → empty safe report shape (no throw).
- `available` / `tradelineGaps` / `missing` coerced with `Array.isArray` / object checks.
- `isJsonDump` filter drops non-string + fence + parseable JSON suggestion lines before annotate.

**Files touched:**
- `src/underwrite/report.mjs`
- `src/underwrite/report.test.mjs` (new)

**Not touched:** gold-report-shell.js, render-pdf.js, letter-pack.mjs, engine.mjs (B12). No commit, no `--prod`.

**Verify:** `node --test src/underwrite/report.test.mjs` → **7 pass**; `fixtures.test.mjs` still green with it.

**Leftover:** none in fence. Endpoint still 404s a missing client before `buildReport` — that is correct, not a report.mjs gap.

### B12 — Smash underwrite engine (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- `buildSuggestions(null|undefined)` threw (`Cannot read properties of null (reading 'optimization')`).
- Hostile CRS bags (throwing score getters, Proxy tradelines) made `computeUnderwrite` / `normalizeBureau` throw.
- Non-finite utilization could theoretically pass through; no catch → safe empty at the boundary.

**Fixes:**
- Wrapped `computeUnderwrite`, `normalizeBureau`, `buildSuggestions`, `getNumberField` in try/catch at `engine.mjs` (vendor untouched).
- Throw / non-object → `SAFE_EMPTY_UNDERWRITE` with `utilization_pct: null`, `lenders: []`, `lite_banner_funding: null`, `fundable: false`.
- Non-finite util scrubbed to null; non-array `lenders` stripped to `[]` (never invent names).
- Null uw suggestions → single fallback line with no util/lender claims.
- Smash tests in `engine.test.mjs`; pinned fixtures still green.

**Files touched:**
- `src/underwrite/engine.mjs`
- `src/underwrite/engine.test.mjs` (new)

**Not touched:** adapter.mjs (B13), letter-pack, fh-charts, gold-report-shell, vendor/*.cjs. No commit, no `--prod`.

**Verify:** `node --test src/underwrite/engine.test.mjs src/underwrite/fixtures.test.mjs` → **27 pass**.

**Leftover:** Vendor still collapses unknown negatives/inquiries to 0 (fundable trap) — contained by adapter/report, not forked here. Clock-dependent seasoning unchanged. Catch-path `per_bureau` summaries are slim vs full vendor shape (enough for suggestions; report.mjs deep reads are B15).

### B13 — Smash CRS adapter (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- `crsResults` with `null` / hole entries threw inside `triMerge` sort (`created_at` on null).
- Whitespace-only strings (`"   "`) coerced via `Number(...)` to **0** for limits, balances, inquiries, negatives, and business age — inventing real zeros (and for negatives, inventing a fundable condition).
- `customFields: []` was treated as an object bag (arrays are `typeof "object"`).

**Fixes:**
- `crsRows()` filters null/non-object pulls before `triMerge`; empty after filter = no pull finding.
- `count()` / `dollars()` trim strings; blank / `"null"` → unknown (never invent 0).
- Refuse array `customFields` (use `{}`).
- One missing bureau still leaves the other scored bureaus available (already true; locked in smash tests).
- Duplicate tradeline ids: no throw, both rows map (not silently dropped).

**Files touched:**
- `src/underwrite/adapter.mjs`
- `src/underwrite/adapter.test.mjs`

**Not touched:** engine.mjs (B12), crs-tier, letter-pack, finance crs-pull. `CRS_ALLOW_LIVE` unchanged. No commit, no `--prod`.

**Verify:** `node --test src/underwrite/adapter.test.mjs` → **37 pass** (28 prior + 9 smash).

**Leftover:** nothing in fence. (`triMerge` itself still throws on null holes if called directly — callers outside this adapter are out of fence.)

### B4 — Smash charts (NaN / suppress) (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high  
**Hard rule:** no LLM in the draw path (unchanged — pure SVG from numbers).

**What broke (pre-fix):**
- `score_lineup` with NaN/null/missing scores emitted `NaN` in SVG; <3 rows threw.
- `utilization_tank` limit 0 / non-finite → `NaN` SVG (division by zero).
- Empty `utilization_bars` / empty `score_lineup` drew or threw instead of suppress.
- `waterfall` with projected ≤ current (or total 0) still drew / emitted NaN scale — could invent a misleading picture.
- `unlock_ladder` empty tiers drew an empty rail; `hi === lo` emitted NaN.
- `drawChart` threw on malformed SVG attrs (`x="bad"`, NaN line coords).

**Fixes (DIAGRAM_SPEC §6):**
- Sentinel: `CHART_SUPPRESSED === ""` (falsy for W3 `tryFhChart` / `renderChartSlot`).
- Charts return `""` rather than lie: bad scores, limit ≤ 0, empty rows, waterfall with no real gain, empty unlock tiers, <3 severity items, empty money_chain / application_order.
- `utilization_tank` bal > limit: fill clamps at 100%, printed % stays true (no suppress — honest overage).
- `unlock_ladder` / `timeline`: widen `lo`/`hi` when equal or tier/score outside range.
- `drawChart`: non-finite attrs skipped; per-primitive try/catch; never throw on malformed SVG.
- Caption: huge strings truncated to 240 chars; negative caption stringifies without NaN.

**W3 note — `shouldDrawChart(name, args)`:**
- Exported from `fh-charts.mjs` for gold-report-shell without editing the shell in this unit.
- Use before embedding: `shouldDrawChart("waterfall"|"money_chain", { current, projected })` → false when projected ≤ current.
- Also accepts chart arg arrays for score_lineup / tank / bars / unlock_ladder / severity / timeline / application_order.
- Track 1 suppress stays inside `journey_map({ hasCleanBureau: false })` (already wired).

**Files touched:**
- `src/underwrite/fh-charts.mjs`
- `src/underwrite/fh-charts-embed.mjs`
- `src/underwrite/fh-charts.test.mjs`

**Not touched:** gold-report-shell.js (W3), fh_charts.py, generate-deliverables. No commit, no `--prod`, no npm deps.

**Verify:** `node --test src/underwrite/fh-charts.test.mjs` → **26 pass** (18 prior + 8 smash).

**Leftover:** W3 may optionally call `shouldDrawChart` at slot-build time; shell already nulls money_chain/waterfall args when projected ≤ current.

### B8 — Smash summary docs (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Null / undefined engine threw (`decision_label` / `consumerSignals` / etc.) on every generator.
- `consumer_summary` could print `` ```json `` fences and `[ QR CODE ]` / spaced `[ Q R C O D E ]` into the PDF.
- `generateAllSummaryDocuments` hid null throws by returning `[]` (no 0-byte PDF, but direct callers still threw).

**Fixes:**
- `safeEngine` / `safePersonal` — null engine + empty personal emit a real non-empty `%PDF-` (no throw).
- `sanitizePdfText` on all draw paths — strips JSON fences, QR placeholders, newlines, non-WinAnsi.
- `savePdf` refuses empty / non-`%PDF-` buffers.
- Funding vs repair stay split (Capital Readiness vs Optimization Plan titles + sections).
- Documented: funding/repair summaries are **1-page**, no gold close CTA / QR page (matches gold `summary_funding_snapshot`).

**Path verdict (W3 leftover):** **Keep alive — do not mark dead.** `letter-pack` still attaches `funding_summary` / `repair_plan_summary` from this generator. Full analysis PDFs (`funding_snapshot`, etc.) already use gold shell. Visual parity with gold shell remains a W3 leftover, not a delete.

**Files touched:**
- `vendor/underwriteiq-full/api/lite/crs/summary-doc-generator.js`
- `src/underwrite/summary-doc-generator.test.mjs` (new)

**Not touched:** bridge re-export (`summary-doc-generator.cjs`), gold-report-shell, render-pdf, letter-generator, apply-qr, fh-charts, letter-pack. No commit, no `--prod`.

**Verify:** `node --test src/underwrite/summary-doc-generator.test.mjs` → **8 pass**; vendor `__tests__/summary-doc-generator.test.js` → **15 pass**.

**Leftover:** still not gold-shell styled (plain Helvetica 1-pager). That is visual, not smash-dead.

### B9 — Smash doc-prompts (no JSON) (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix / smash read):**
- Dual structure on credit analysis (numbered 1–9 + gold H2s) could invent non-gold headings.
- JSON ban existed but did not name `JSON object` / `sections array` / ` ```json ` fences.
- Funding report prompts did not explicitly refuse dispute-letter bodies as the pack.

**Fixes:**
- Credit / roadmap / snapshot / lender prompts: markdown only; Never JSON / JSON object / sections array / ```json / code fences.
- Gold section order pinned to W3 (`PICTURE` → … → `BOTTOM LINE`, etc.) — not inverted.
- Funding report prompts: do not write dispute / inquiry / personal-info letter bodies; letters stay separate.
- No separate repair/funding prompt variants in this file; dispute letter prompts unchanged.

**Files touched:**
- `vendor/underwriteiq-full/api/lite/crs/doc-prompts.js`
- `src/underwrite/doc-prompts.test.mjs` (new)

**Not touched:** generate-deliverables.js (B7), render-pdf.js (B2), gold-report-shell.js, vendor/underwriteiq-crs/doc-prompts.js. No commit, no `--prod`.

**Verify:** `node --test src/underwrite/doc-prompts.test.mjs` → **11 pass**.

**Leftover:** stale JSON instructions remain in `vendor/underwriteiq-crs/doc-prompts.js` (outside fence; not the live import path).

### B10 — Smash product-path / review silence (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What was locked:**
- `isFundingPath` / `isRepairOnlyPath` stay exact-string, fail-closed.
- `MANUAL_REVIEW`, `FRAUD_HOLD`, null, undefined, `""`, unknown names, typos, lowercase, and padded strings are never funding and never repair-only.
- Funding only: `FULL_FUNDING`, `FUNDING_PLUS_REPAIR`, `PREMIUM_STACK`.
- Repair-only only: `REPAIR_ONLY`.
- No trim / case-fold / new tier aliases (documented in tests).

**Files touched:**
- `src/config/product-path.mjs`
- `src/config/product-path.test.mjs`

**Not touched:** u-02, ds-02, letter-pack (B3). No commit, no `--prod`.

**Verify:** `node --test src/config/product-path.test.mjs` → **13 pass**.

**Matrix (tier → isFundingPath / isRepairOnlyPath):**
| tier | funding | repair |
|------|---------|--------|
| FULL_FUNDING | true | false |
| FUNDING_PLUS_REPAIR | true | false |
| PREMIUM_STACK | true | false |
| REPAIR_ONLY | false | true |
| MANUAL_REVIEW | false | false |
| FRAUD_HOLD | false | false |
| null / undefined / "" | false | false |
| typo / lower / spaces | false | false |

**Leftover:** nothing in fence.

### B5 — Smash attachments / empty send (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Whitespace-only / empty-ish attachment content could still encode and leave a named file (including `pack.pdf`) on the queue or Resend payload.
- Filenames accepted path traversal (`../../…`) and unbounded length.
- Non-PDF bytes with a `.pdf` name were attached as-is (no `%PDF` magic check).
- Queue and Resend encoders were soft — drop was incomplete.

**Fixes:**
- Hardened `encodeAttachments` in `src/workflows/messaging.mjs` and `src/messaging/providers/resend.mjs`: safe basename, 180-char cap, `%PDF` magic required, missing/empty/non-PDF dropped without throw.
- Documented: `attachments: []` still queues (non-pack); pack “no PDF → no email” stays U-02 / letter-pack (B3).
- Resend payload remains `{ filename, content }` base64.
- `MESSAGING_DRY_RUN=1` still never fetches (test pinned).

**Files touched:**
- `src/workflows/messaging.mjs`
- `src/workflows/messaging.test.mjs`
- `src/messaging/providers/resend.mjs`
- `src/messaging/providers/providers.test.mjs`

**Not touched:** `dispatch.mjs` (gauntlet Gmail rewrite stays in `scripts/tmp-letter-gauntlet.mjs`; no live plus-alias rewrite added). No outbound_enabled flip, no outbox drain, no live Resend, no commit, no `--prod`.

**Verify:** `node --test src/messaging/providers/providers.test.mjs src/workflows/messaging.test.mjs` → 99 pass.

**Leftover:** sendTemplated with all-bad attachments still queues the email body (by design for non-pack). Pack callers must keep refusing before queue — that is B3.

### B23 — Smash C-00 CRS soft pull request (2026-08-14)

**Status:** done  
**Model:** Grok 4.5 high

**What broke (pre-fix):**
- Missing client already returned `{ done: false, reason: "no_client" }` — held, no test.
- Duplicate `already_open` / replay already skipped a second bureau order — held, only replay was tested.
- `CRS_ALLOW_LIVE=0` already forwarded `env` into `runPull` and soft-refused when the pull returned `production_host_refused` — held.
- **SoftPullError from `runPull` (ledger already failed / wrong org / missing row) threw out of `handle`** — Inngest would retry a permanent ledger state.

**Fixes:**
- Catch `SoftPullError` around `run-crs-pull` the same way as consent refusal: `{ pulled: false, reason: code }`, no throw.
- Smash tests lock missing client, `already_open`, `CRS_ALLOW_LIVE=0` env forward + refuse, SoftPullError from pull, and source grep (no `fetch(`, no stitchcredit host, no live flag flip).

**Files touched:**
- `src/workflows/c-00-crs-soft-pull-request.mjs`
- `src/workflows/c-00-crs-soft-pull-request.test.mjs`

**Not touched:** crs-pull.mjs (B18), adapter, c-06. No commit, no `--prod`, no live CRS.

**Verify:** `node --test src/workflows/c-00-crs-soft-pull-request.test.mjs` → **12 pass** (7 prior + 5 smash). 0 fail, 0 skip.

**Leftover:** Production-host fence still lives in crs-client / crs-identities / crs-pull (B18). C-00 only forwards `env` and refuses throws.
