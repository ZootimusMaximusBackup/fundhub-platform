# 05 — Gaps and uncertainties

**Rule:** Absences stay open. No invented business rules.

**Owner-set (2026-08-21, FINAL):** In-house repair is **ON** for Fundhub. GHL docs / 05/30 PDF are **guides**. Do not re-raise DS-only vs delete-repair.

---

## ANSWERED — Repair product law

### 1. In-house repair ON (owner-set)

**CONFIRMED (owner-set 2026-08-21):** In-house repair is 100% going to be in action — confirmed by the repair dashboard already built. Earlier audit framing that “05/30 says DS-only / R-series DECOMMISSIONED so repair is off” is **wrong for the new system**.

**CONFIRMED in 05/30 Part A (GHL-era guide only):** soft pull on call; GHL-era writeup said in-house repair was outsourced to downsell (DS-01 / DS-02); R-series under PDF `DECOMMISSIONED`; stickies N-05 / N-08 / BS-EMAIL-REPAIR-72HR “DECOMMISSIONED. No wiring.”

**STRUCTURE-INFERRED in current code (intended home, not a conflict):** `src/repair/` handlers registered from `src/workflows/index.mjs`; `repair.*` events; `repair-bureau-response`; Repair desk tab in `public/app/inquiry-remover.html`; `api/repair/{enroll,generate,send,exceptions,inbound-mail}`; pipeline stages in `src/repair/pipeline.mjs`.

**Next mapping work (strategy — not tonight):** which R-guide / S-07 / S-09 / S-10 steps exist in that home vs missing. See “Repair fidelity questions” below.

**UNCERTAIN coexistence:** DS-01 / DS-02 may still be valid **downsell guides** alongside in-house repair. Do not assume they die unless evidence says so.

---

## Needs Chris verification (remaining)

### 2. Pre-call Analyzer pages vs Part A

Part A: no pre-call Analyzer; LOCKS outdated.  
PDF still prints U-01, S-03, DPC-01 “Analyzer Lock”, BS-01 Analyzer Authority gate.  
Code still has Analyzer-named workflows (U-02, DPC-01) that now react to `analysis.completed` (may be CRS-shaped).

**Ask:** Treat Analyzer-named workflows as **CRS-era renames**, or retire them once CRS path is proven?

---

### 3. Stage 2 `cf_svy_has_negatives`

Part A open item: field key pending DirectROAS; gate not enforceable until it exists.  
Code: `classifySurvey` → MANUAL_REVIEW when absent (`survey-qualification.mjs`).

**Ask:** Is the field live in production survey answers yet? If not, Stage 2 downsell cannot run as written.

---

### 4. BS-01 under 05/30

At booking, recommendation does not exist. BS-01 still path-splits Funding vs Repair drips; repair email sticky is DECOMMISSIONED in GHL.

**Ask:** Keep universal pre-call SMS only, drop path split, or move path drip to **after** C-06 / repair enroll?

---

### 5. AR-01..AR-04

Part A Stage 9 is LIVE intended. Code has **no** AR workflow files (migration BLOCKED).

**Ask:** Is AR collection still required in custom CRM now, or handled elsewhere (manual / Commas)?

---

### 6. C-04 stale CRS gate

Named in Part A Stage 7. Missing in code; threshold never specified (migration BLOCKED).

**Ask:** What age makes a CRS snapshot “stale” before next round submit?

---

### 7. Sales Outcome signal for DS-01 / DS-02 (and in-house enroll)

Part A: DS fires from Sales Outcome (Repair Referral Sent / DIY Letters Purchased).  
Code: DS-01 guards on that string or `repairReferral===true`; DS-02 on `payment.received`.  
In-house: enroll via `api/repair/enroll` from Repair desk (**STRUCTURE-INFERRED**).

**Ask:** Does the CRM write those Sales Outcome values today on call close — and what signal starts **in-house** enroll vs DS lanes?

---

### 8. Product Path = Repair vs Referred vs in-house

Part B still lists Product Path Repair and Sales Outcome Repair Purchased; Part A’s GHL-era line outsourced fulfillment. Owner law restores in-house.

**Ask (strategy):** Is “Repair” path now the in-house lifecycle, with Referred / DIY as optional downsells — or still undecided? Marked **UNCERTAIN** until strategy pass.

---

### 9. S-10 upgrade + N-05

Part A Stage 10 mentions S-10 repair graduate → funding. N-05 sticky is DECOMMISSIONED in GHL.

**Ask:** Is upgrade-from-repair still a live journey for the **in-house** track? (Guide says yes in places; sticky said no wiring — **UNCERTAIN** for Fundhub until mapped.)

---

### 10. client-intended.md vs this lifecycle

`docs/journeys/client-intended.md` is a **portal route** matrix generated from code, not the GHL sales journey. It is **not** ground truth for this mapping.

**Ask:** Should a new `docs/journeys/` pair be authored for the **sales/client funding + repair lifecycle** from Part A + owner law (human-authored intended)?

---

## Repair fidelity questions (guide → code) — for next strategy pass

Still **STRUCTURE-INFERRED / UNCERTAIN** — skim only; no code edits this pass. Concrete questions for the fidelity map:

1. **S-07 “Repair Purchased” → enroll:** Does call close / sale write a signal that hits `api/repair/enroll` (or `repair.enrolled`), or is enroll only a manual Repair-desk click today? (**UNCERTAIN**)
2. **R-series round loop vs `REPAIR_STAGES`:** Which GHL R-sticky steps (docs chase, letter send, bureau response, legal, round complete) already map to `src/repair/` events (`repair.docs.*`, `repair.letters.*`, `repair.response.*`, `repair.round.*`), and which are still missing as workflows? (**STRUCTURE-INFERRED** stages exist; sticky-by-sticky fidelity unproven)
3. **S-09 decline + S-10 upgrade + DS coexistence:** After C-06, when does the CRM take DS-01 / DS-02 vs in-house enroll — and does S-10 graduate-to-funding (or N-05) have any Fundhub equivalent yet? (**UNCERTAIN**)

---

## Secondary-source conflicts (do not treat as Fundhub product veto)

| Secondary | Conflict with Part A / owner law |
|---|---|
| Master Workflow / LOCKS (`/tmp/master_wf.txt`) | Pre-call Analyzer authority; Analyzer Path Funding/Repair before call |
| `workflow-migration-table.md` | Ported from **04/08**; admits 05/30 was unread at port time; some “RETIRED” rows refer to GHL folder copies while live ports exist |
| Jan 2026 GHL URL inventory | Snapshot; no LIVE/DECOM labels |
| 05/30 R-series DECOMMISSIONED section | CONFIRMED for **GHL document placement**; under owner law = **guide** for custom repair, not “delete `src/repair/`” |

---

## Insufficient evidence (auditor stops)

- Live Inngest run proofs for each workflow (not run this pass).  
- Whether production survey posts `svy_has_negatives`.  
- Whether Soft pull payment UI is only available inside the call cockpit.  
- Sticky-by-sticky R-series ↔ `src/repair/` fidelity (strategy pass).  
- Whether DS-01 / DS-02 and in-house repair run as parallel product lanes in live ops (**UNCERTAIN** coexistence).

**Next:** strategy mapping repair guide → code — **wait for Chris’s go**. No Fixer / no workflow rebuild in this audit pack.
