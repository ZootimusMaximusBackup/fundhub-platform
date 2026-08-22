# 04 — Current map (GHL LIVE → Fundhub code)

For each **05/30 LIVE** (or guide) piece: how the custom CRM stands today.

Labels:

- **EXISTS** — Registered workflow/file present and named for this job.  
- **MISSING** — No workflow file / not registered.  
- **CHANGED** — Exists but trigger, gate, or intent differs from Part A (evidence cited).  
- **DUPLICATED** — Two systems doing overlapping jobs.  
- **NO LONGER NECESSARY** — GHL/Airtable glue that one-DB CRM replaces.  
- **GUIDE→CODE** — GHL page was DECOMMISSIONED / outsourced in the old system; Fundhub owner law keeps in-house repair ON — fidelity mapping is the next phase (not “delete repair”).

Evidence is file presence + headers + migration table notes. **Not** live runtime PASS.

Registered set: `src/workflows/index.mjs` (read 2026-08-21).

**Owner-set (2026-08-21, FINAL):** In-house repair ON for Fundhub. GHL Part A’s “outsourced / R-series DECOMMISSIONED” describes the **GHL-era** model and is a **guide**, not a veto.

---

## Stage 0–2 — Intake & survey

| Original | Verdict | Evidence |
|---|---|---|
| AT-01 First touch | EXISTS | `src/workflows/at-01-first-touch-capture.mjs` — trigger `entry.captured` |
| AF-02 Ownership lock | EXISTS | `af-02-referral-ownership-capture.mjs` — `entry.captured` / `diagnostic.paid` / `analysis.completed` |
| S-01 New lead | EXISTS | `s-01-new-lead-intake.mjs` — `entry.captured` |
| S-02 Incomplete survey | EXISTS | `s-02-incomplete-survey-nudge.mjs` — `entry.captured` + 20m wait |
| Stage 2 survey gates | EXISTS (logic) / CHANGED (enforceability) | `src/config/survey-qualification.mjs` + `api/public/survey-submit.mjs` call `classifySurvey`. Part A open item: negatives field pending — module intentionally returns MANUAL_REVIEW when absent |
| App-stage downsell on FAIL | UNCERTAIN wiring | Gate returns DOWNSELL; full “dispute-letter referral” automation path not proven as a dedicated workflow beyond DS-* which are Stage 5 / call-path |

---

## Stage 3 — Booking & setter

| Original | Verdict | Evidence |
|---|---|---|
| S-04 Call booked | EXISTS | `s-04-call-booked.mjs` — `booking.created` |
| S-04B Reminders | EXISTS | `s-04b-booking-reminders.mjs` — `booking.created` |
| AI-SET-01 Josh | EXISTS | `ai-set-01-josh-setter.mjs` — `booking.created` |
| AI-SET-03 No-answer | EXISTS / CHANGED (copy risk) | `ai-set-03-no-answer-cadence.mjs` — migration notes pre-approval copy vs 05/30 no pull yet |
| AI-SET-04 Handoff | EXISTS | `ai-set-04-3way-handoff.mjs` |
| BS-01 Pre-call launcher | EXISTS / **CHANGED (likely dead pathing)** | `bs-01-precall-launcher.mjs` — `booking.created`; still splits Funding vs Repair email drip via `clientOutcomeTier` / product path. Under Part A, recommendation **does not exist at booking**. Migration table: “MIGRATED — DEAD under 05/30.” SMS companion may still send. |
| BS-EMAIL-REPAIR-72HR | DECOMMISSIONED in GHL; still merged into BS-01 repair drip keys | Sticky DECOMMISSIONED; code still has `BS-REPAIR` prefix in BS-01 |

---

## Stage 4–5 — On-call pull & fork

| Original | Verdict | Evidence |
|---|---|---|
| C-00 Soft pull request | EXISTS / **CHANGED** | `c-00-crs-soft-pull-request.mjs` — trigger `diagnostic.paid`. Part A: pull initiated **on the call** after consent+pay. Payment-triggered request may still be correct if pay happens on-call; if pay can happen pre-call, order drifts. Migration flagged model drift. |
| U-03 CRS sync | EXISTS | `u-03-crs-snapshot-sync.mjs` — `analysis.completed`, source crs |
| U-04 Promote CRS | EXISTS | `u-04-promote-crs-primary.mjs` |
| U-02 Analyzer delivery | EXISTS / **CHANGED / OUTDATED name** | `u-02-analyzer-complete-delivery.mjs` — `analysis.completed`. Header notes repair not delivered here under 05/30 (DIY owns repair pack). Funding delivery may overlap C-06. |
| DPC-01 Analyzer Lock | EXISTS / OUTDATED name | `dpc-01-analyzer-lock.mjs` — locks on `analysis.completed` (can serve CRS lock if naming ignored) |
| C-06 Results router | EXISTS | `c-06-crs-results-router.mjs` — `analysis.completed`. Hard-decline threshold DEFERRED/no-op per migration. |
| S-06 Funding purchased | EXISTS | `s-06-post-call-funding-purchased.mjs` — `deposit.paid` (migration also mentions sale.closed in places — verify if needed) |
| S-08 Funding didn't buy | EXISTS | `s-08-post-call-funding-declined.mjs` — `call.completed` |
| DS-01 Referral | EXISTS / CHANGED trigger fidelity; **UNCERTAIN** coexistence with in-house | `ds-01-repair-referral.mjs` — wants Sales Outcome “Repair Referral Sent” or `repairReferral===true`; otherwise won't fire. May still be a valid **downsell guide** alongside in-house repair — do not assume it dies. |
| DS-02 DIY | EXISTS / CHANGED; **UNCERTAIN** coexistence with in-house | `ds-02-diy-letters.mjs` — `payment.received` (generic). Invoice is staff task; letter webhook built. Risk: $32 diagnostic is also a payment. Same coexistence note as DS-01. |
| S-07 / S-09 / S-10 | MISSING as workflows; **GUIDE→CODE** | No `s-07*`, `s-09*`, `s-10*` files. Under owner law these are **guides** for enroll / decline follow-up / graduate-to-funding — map onto `src/repair/` + Repair desk, not “leave missing because GHL outsourced.” |

---

## Stage 6–8 — Funding ops

| Original | Verdict | Evidence |
|---|---|---|
| F-01..F-11 (core) | EXISTS | Registered f-01 … f-11 in `index.mjs` |
| F-12A Zoho remote | MISSING | No `f-12a*` file; migration OUT OF SCOPE |
| POD-01B | MERGED / partial | Migration: folded into F-01 task fallback; no auto pod lookup |
| C-02 / C-02B / C-03 / C-05 | EXISTS | Matching files registered |
| C-04 Stale CRS gate | MISSING | No `c-04*`; migration BLOCKED (threshold unknown) |
| AX-* Airtable mirrors | NO LONGER NECESSARY | One Postgres; migration RETIRED AX series |

---

## Stage 9–10 — AR & nurture

| Original | Verdict | Evidence |
|---|---|---|
| AR-01..AR-04 | **MISSING** | No `ar-*` workflow files; migration BLOCKED (Balance Due gate / money) |
| N-01..N-04, N-06 | EXISTS | Registered |
| N-05 / N-08 | MISSING + correctly DECOMMISSIONED in GHL | No files; matches sticky DECOMMISSIONED |
| N-07 | MISSING | Migration DEFERRED |
| SYS-01 / SYS-01-LTV | EXISTS | `sys-01-client-value-calculator.mjs`, `sys-01-ltv-calculator.mjs` |
| F-08 → N-04 | EXISTS | Both on `round.funded` |

---

## Always-on DPC / BC / AF / HX

| Original | Verdict | Evidence |
|---|---|---|
| DPC-02 / 03 / 05 | EXISTS | Registered |
| DPC-04 | MERGED | Into DPC-03 per migration; no standalone file |
| BC-01 / BC-02 | EXISTS | Registered; triggers mapped to `round.started` (may be narrower than GHL) |
| BC-03 Motivation | MISSING | No `bc-03*` |
| AF-04 Commission | MISSING | No `af-04*`; money path BLOCKED historically |
| HX-01..05 | MISSING / RETIRED | Migration RETIRED (heartbeat / no Airtable) |

---

## GUIDE→CODE — In-house repair (owner-set ON)

| GHL Part A (GHL-era) | Fundhub owner law + code | Verdict |
|---|---|---|
| In-house repair **outsourced**; R-series under PDF DECOMMISSIONED | **Owner-set ON.** `src/repair/` pipeline (`REPAIR_STAGES` / `repair.*` events); `registerRepairHandlers()` from `src/workflows/index.mjs`; `repair-bureau-response.mjs`; Repair desk in `inquiry-remover.html`; `api/repair/{enroll,generate,send,exceptions,inbound-mail}` | **Not a CONFLICT.** GHL described old outsource; custom CRM keeps in-house. Next = fidelity map (which R / S-07 / S-09 / S-10 guide steps exist vs missing). |

**STRUCTURE-INFERRED skim (no code edits):** Pipeline stages cover intake → docs → analysis → letters → send → response → rounds → program complete. Dashboard enroll/generate/send exists on the Repair tab. Still **UNCERTAIN** which GHL R-sticky steps (DisputeFox, legal, upgrade SMS, etc.) are covered vs still missing as workflows.

**UNCERTAIN:** Whether DS-01 / DS-02 remain parallel downsell lanes beside in-house, or collapse later — evidence does not prove either yet.

---

## Matrix snapshot (LIVE Part A / guides → code)

| Area | EXISTS | MISSING | CHANGED | GUIDE→CODE / notes |
|---|---|---|---|---|
| Intake / survey gate | Yes | App-stage downsell automation clarity | Negatives field open | — |
| Booking / setter | Yes | — | AI-SET-03 copy; BS-01 path split | BS-REPAIR drip vs GHL DECOM sticky (guide) |
| On-call CRS + C-06 | Yes | C-04 | C-00 timing; U-02 naming | — |
| DS-01 / DS-02 | Yes | — | Triggers / payment generic | **UNCERTAIN** coexistence with in-house |
| Funding F-series | Mostly | F-12A, POD auto | Partial F-07/F-10 | — |
| AR | — | AR-01..04 | — | — |
| Nurture | N-01..04,06 | N-07 | — | N-05 may matter again as repair-complete guide |
| Repair fulfillment | `src/repair/` + Repair desk | Dedicated `s-07*` / `s-09*` / `s-10*` / R-* workflow files | — | **Owner-set ON** — fidelity mapping next |
