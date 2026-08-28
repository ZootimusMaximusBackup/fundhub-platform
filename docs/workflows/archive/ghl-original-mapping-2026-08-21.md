# GHL original → Fundhub CRM mapping (audit board)

**Status:** Auditor Step 1 — Discovery only. Read-only.  
**Date:** 2026-08-21  
**Board:** this file  
**Evidence:** [`ghl-original-mapping-2026-08-21-evidence/`](./ghl-original-mapping-2026-08-21-evidence/)

| File | Contents |
|---|---|
| [00-method.md](./ghl-original-mapping-2026-08-21-evidence/00-method.md) | Sources + confidence labels |
| [01-lifecycle.md](./ghl-original-mapping-2026-08-21-evidence/01-lifecycle.md) | Stages 0–10 + always-on from 05/30 Part A |
| [02-workflow-catalog.md](./ghl-original-mapping-2026-08-21-evidence/02-workflow-catalog.md) | Per-series LIVE / DECOMMISSIONED / OUTDATED |
| [03-interactions.md](./ghl-original-mapping-2026-08-21-evidence/03-interactions.md) | Event spine (Mermaid) |
| [04-current-map.md](./ghl-original-mapping-2026-08-21-evidence/04-current-map.md) | EXISTS / MISSING / CHANGED / guide→code notes |
| [05-gaps-and-uncertainties.md](./ghl-original-mapping-2026-08-21-evidence/05-gaps-and-uncertainties.md) | What only Chris can settle |

**Law (how to read sources):** 05/30 Part A Customer Journey + GHL workflow canvases / stickies are **guides** to reconstruct intended business logic for the **new custom CRM** — including repair. They are **not** a veto that kills Fundhub in-house repair.

**Owner-set (2026-08-21, FINAL):** In-house repair is **ON** for Fundhub. Confirmed by the repair dashboard already built. Earlier audit framing that “05/30 says DS-only / R-series DECOMMISSIONED so repair is off” was **wrong for the new system**. Do not re-raise.

**Stop rule:** No Fixer. No workflow edits tonight. After this map update, next step is **strategy: repair guide → code fidelity** — wait for Chris’s go.

---

## Top 5 confirmed lifecycle truths (05/30 Part A as GHL-era guide)

1. Soft pull runs **on the call** — not before. No pre-call Analyzer in the live GHL model described by Part A.  
2. Survey Stage 2 is the only pre-call qualifier (FICO band + negatives). Fail → repair downsell path in the GHL-era writeup.  
3. After the live pull, **C-06** forks three ways: Funding close, repair downsell (DS-01 referral or DS-02 DIY), or hard decline.  
4. **GHL-era Part A:** in-house repair fulfillment was described as outsourced; R-series / N-05 / N-08 / BS-EMAIL-REPAIR-72HR sit under PDF DECOMMISSIONED stickies — treat those pages as **guides for what the custom repair track should do**, not as “delete `src/repair/`.”  
5. Funding clients then run F-series onboarding → rounds (with inquiry cleanup) → fee lock → AR while Balance Due > 0 → post-funding nurture.

---

## Top 5 gaps vs current custom CRM

1. **Repair guide → code fidelity** — owner law = in-house ON; still need a step map of which R-guide / S-07 / S-09 / S-10 steps exist in `src/repair/` + Repair desk vs which are missing (**STRUCTURE-INFERRED** until fidelity pass).  
2. **BS-01** still path-splits at booking using product path / tier that Part A says does not exist until the call — **CHANGED / likely dead drip path**; repair email sticky is DECOMMISSIONED in GHL (guide may still inform post-C-06 drips).  
3. **AR-01..AR-04** are LIVE in Part A Stage 9 but **MISSING** as workflows in `src/workflows/`.  
4. **C-04** stale-CRS gate is named in Part A and **MISSING** in code (threshold never defined).  
5. **C-00 / DS-02 / AI-SET-03** timing and copy still carry pre-call / generic-payment / “results already exist” assumptions — **CHANGED** vs on-call model.

**UNCERTAIN (coexistence):** DS-01 / DS-02 may still be valid **downsell guides** alongside in-house repair. Do not assume they die unless evidence says so.

---

## Mapping matrix (compressed)

| Journey slice | 05/30 intent (guide) | Current code |
|---|---|---|
| First touch / affiliate lock | AT-01, AF-02 | EXISTS |
| Survey + Stage 2 gates | Survey-only qualify | Logic EXISTS; negatives field may still be open |
| Book + Josh setter | S-04/B, AI-SET-01 | EXISTS |
| Pre-call BS drip | BS-01; repair drip DECOM in GHL | EXISTS but CHANGED / path-split risk |
| On-call CRS | C-00 → U-03 → U-04 → C-06 | EXISTS; C-00 trigger timing CHANGED risk |
| Repair downsell | DS-01, DS-02 | EXISTS; trigger fidelity CHANGED; **UNCERTAIN** coexistence with in-house |
| In-house R-series (+ S-07/S-09/S-10) | GHL DECOM pages = **guide** for custom track | **Owner-set ON** — home is `src/repair/` + Repair desk; fidelity mapping next |
| Funding F-01..F-11 | LIVE | Mostly EXISTS; F-12A / POD auto MISSING |
| Inquiry loop | C-02/03/05 + C-04 | C-04 MISSING |
| AR collect | AR-01..04 | MISSING |
| Nurture | N-01..04,06 LIVE; N-05/08 DECOM in GHL | Matches; N-07 MISSING; N-05 may matter again as repair-complete guide |

Full table: [04-current-map.md](./ghl-original-mapping-2026-08-21-evidence/04-current-map.md).

---

## Ground truth pointers

- Intended sales lifecycle: reconstruct from 05/30 Part A → evidence `01-lifecycle.md` (not `client-intended.md`, which is portal routes).  
- Current registration: `src/workflows/index.mjs`.  
- Events: `src/events/canonical.mjs`.  
- In-house repair home: `src/repair/` + Inquiry Remover **Repair** tab (`public/app/inquiry-remover.html`) + `api/repair/*`.

---

## ANSWERED: in-house repair ON (owner-set 2026-08-21). GHL docs = guides.

Chris confirmed: in-house repair is **100% going to be in action** (repair dashboard already built). GHL workflows / 05/30 PDF guide what to wire in Fundhub — including R-series and related stickies — they do **not** veto repair.

**Next (strategy only — wait for go):** Map repair guide → code fidelity. No workflow code changes, no Fixer, no rebuild in this audit pack.

---

## Claims hygiene

Every evidence file labels claims **CONFIRMED | STRUCTURE-INFERRED | UNCERTAIN**.  
Migration table = port history from 04/08, not 05/30 law.  
Owner decisions are final when logged — do not re-raise.
