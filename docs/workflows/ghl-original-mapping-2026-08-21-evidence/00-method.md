# 00 — Method

**Audit type:** Read-only discovery (fundhub-auditor Step 1).  
**Date:** 2026-08-21  
**No code, env, template, workflow, or test edits.**

## Confidence labels (every claim)

| Label | Meaning |
|---|---|
| **CONFIRMED** | Stated in the 05/30 Part A (Customer Journey / State Contract), or an explicit DECOMMISSIONED / “No wiring” line in the same PDF text; **or** an owner-set decision logged on the board. |
| **STRUCTURE-INFERRED** | Taken from later PDF pages (workflow canvases, LOCKS, sticky notes) that Part A says may be outdated; or from file presence / registration in current code. Used as **guides** for what the custom CRM should do — not as a veto against owner-set product law. |
| **UNCERTAIN** | Conflict between sources, missing field, or no observable wiring. Gaps stay open — never filled with guesses. |

## How GHL sources relate to Fundhub (owner-set 2026-08-21)

- **GHL Part A + canvases / stickies** = guides to reconstruct intended business logic for the **new custom CRM**, including repair (R-series, S-07 / S-09 / S-10, etc.).  
- **GHL-era Part A** described in-house repair as outsourced / R-series DECOMMISSIONED. That described the **old GHL outsource model** — it is **not** a rule that Fundhub must delete repair.  
- **Owner law for Fundhub:** in-house repair is **ON**. Intended home = `src/repair/` + repair dashboard (Inquiry Remover Repair tab) + `api/repair/*`. Next phase = map guide → code fidelity, not “delete repair.”

## Primary source (GHL guide)

1. **PDF:** `FUNDHUB.AI GO HIGH LEVEL CRM SOURCE OF TRUTH (05_30_2026).pdf`  
   Extract used: `/tmp/ghl_0530.txt` (~448KB, 12940 lines).  
2. **Part A lines 1–203** of that extract are the **GHL-era intended customer journey**. Part A says it **supersedes** old LOCKS that still describe a pre-call Analyzer. For Fundhub product law on repair, see **owner-set** above — Part A does not veto in-house repair in the custom CRM.

## Secondary sources (inventory / guides when they conflict with Part A)

| Source | Path | Role |
|---|---|---|
| Master Workflow Document (older) | `/tmp/master_wf.txt` from CLEAN CANONICAL PDF | Pre-call Analyzer / LOCK-era model. Secondary. |
| GHL Workflows inventory (Jan 2026) | `/tmp/ghl_workflows.txt` | Name + URL list. Secondary. |
| Migration dispositions | `workflow-migration-table.md` | Evidence of what was ported from an **04/08** port — not law. Table itself says 05/30 was not in-repo when that port ran. |
| Timing inventory | `docs/workflows/messaging-review-2026-08-21-evidence/C-timing-audit.md` | Trigger/sleep inventory only. |
| Journeys | `docs/journeys/client-intended.md`, `client-actual.md` | Client **portal route** matrix, not the GHL sales lifecycle. Weak fit for this audit. |
| `fundhub-docs/sources/*ghl*` | **Not present** in repo (only SMS/EMAIL/Airtable sources). | Gap noted. |

## Current system scanned (read-only)

- `src/workflows/index.mjs` — registered Inngest functions  
- `src/workflows/*.mjs` — workflow files  
- `src/events/canonical.mjs` — event names  
- `src/repair/` — `repair.*` bus handlers (registered from workflows index); **intended home for in-house repair** (owner-set ON)  
- `public/app/inquiry-remover.html` — Repair desk tab (dashboard proof that repair is in action)  
- `api/repair/*` — enroll / generate / send / exceptions / inbound-mail  
- `src/config/survey-qualification.mjs` + `api/public/survey-submit.mjs` — Stage 2 gate

## How LIVE vs DECOMMISSIONED was decided (GHL document labels)

1. Start from **Part A** stages 0–10 + always-on. Those paths are **LIVE intended in the GHL guide** unless Part A says otherwise.  
2. Explicit sticky lines such as “DECOMMISSIONED. No wiring.” → **DECOMMISSIONED** in the GHL PDF (CONFIRMED for document placement).  
3. Pages under the PDF heading `DECOMMISSIONED` (extract ~line 11752 onward), including R-series repair fulfillment → **DECOMMISSIONED as printed** (CONFIRMED for document placement). For Fundhub: treat as **guides** for the custom repair track, not as “remove `src/repair/`.”  
4. Workflow pages still printed earlier in the PDF (e.g. S-07 Repair Purchased, DPC-01 Analyzer Lock, BS-01 Analyzer Authority gate) that **contradict Part A’s GHL-era outsource line** → marked **STRUCTURE-INFERRED (outdated page vs Part A)** in the GHL reading; under owner law they remain **candidate guides** for in-house repair wiring.

## What this audit does **not** claim

- Live runtime PASS/FAIL on production sends or pulls (no live proofs this pass).  
- That migration-table “MIGRATED” means behavior matches 05/30.  
- A fix list. Strategy (repair guide → code fidelity) is a separate step after Chris’s go.  
- That DS-01 / DS-02 must die because in-house repair is ON — coexistence is **UNCERTAIN** until proven.
