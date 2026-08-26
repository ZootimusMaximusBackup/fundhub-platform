# Employee ramp system — funding class (beta)

**Date:** 2026-08-24  
**Status:** live on current screens (no new dashboard).  
**Owner law (updated same day):** Chris said quizzes, **OP-06**, and the smallest call watcher are **LIVE**. That overrides the earlier do-not-promote / do-not-approve / do-not-deploy for these three only.  
**UI law:** **No new top-level tabs. No new main-nav items. No new dashboard page.** Quiz lives in Company Brain → Documents. Drill lives on Agent Editor → OP-06. Call watcher uses Sales floor Drive refresh + `call_outcomes`.

**COMPLIANCE REVIEW REQUIRED** on closer, funding-advisor, and repair lessons (fees, file reads, repair talk).

---

## What this is

A 5-day class for new Fundhub people. Four seats. Twenty checks.

**Closer path this pass:**

1. Study / learn (packs)  
2. **AI drills** (test / roleplay) — live coach **OP-06** on Agent Editor reports well / missed / pass-fail  
3. **Sarah’s sit** — last human gate  
4. Then live clients  

Setter is AI. No setter hire ramp.

---

## PASS_BAR: owner must lock

Searched the repo. Found:

- **20/20** = camp boxes before live people (not a percent on AI drills)  
- Interview scores **1–5**, average **4+** (hire filter, not drill bar)  
- Live job bar after graduation: **27 deposits / month** in the pod  

**Not found:** a percent or “high rate” for AI roleplay. Chris said “whatever is acceptable.” Do **not** invent a number.

The coach still writes a score report. A **banned line** fails that drill (compliance rule, not a percent).

---

## Units

| ID | Owns | Status |
|----|------|--------|
| U1 | Board + plan | `done` |
| U2 | Four ramp packs + funding education core | `done` |
| U3 | Load packs into Company Brain as **pending** | `done` — then owner asked LIVE: Approve those rows |
| U4 | Prove unpublished; no prod deploy | `done` for the draft pass. Live pass deploys once if new code shipped. |
| U5 | Closer AI drills — all products + CRM module | `done` |
| U6 | Agent Editor coach | `done` — **OP-06** live. Start drill is a card on Agent Editor, not a new tab. |
| U7 | Sarah final gate from real repo text | `done` |
| U8 | Watch sales calls → train the closer AI on real data | `claimed` — Drive transcript pair + short Whisper sweeper. Coach reads `call_outcomes.transcript`. |

---

## How Chris opens it (live)

**Quizzes**

1. Sign in as **you**.  
2. Open **Company Brain** (`/app/company-brain.html`).  
3. Click **Documents**.  
4. Use **Class quizzes**. Pick a day. Write answers. Click **Check answers**. Day 5 must miss zero.

**AI coach**

1. Open **Agent Editor** (`/app/agent-editor.html`).  
2. Open **Closer drill (beta)** (**OP-06**).  
3. Status should say **live**.  
4. Use **Start a drill** / Send on that same page.  
5. Do not edit Setter Josh or Inquiry Removal.

---

## Roles in

| Seat | Pack | This pass |
|------|------|-----------|
| Closer | ramp + AI drills + Sarah gate | Full. All products. CRM module. |
| Funding advisor | ramp checklist | Checklists only |
| Inquiry remover | ramp checklist | Checklists only |
| Credit repair | ramp checklist | Checklists only |

**Shared funding class core:** `docs/company-resources/closer-funding-education-2026-08-24.md`

---

## All products in the closer drills

D1 $32 · D2 funding DFY · D3 start moves · D4 funding+repair · D5 repair $1,000 · D6 trial $200 · D7 UnderwriteIQ · D8 Funding Mastery · D9 cash downsell · D10 mad/denied · D11 CRM path.

---

## Sarah’s checklist — found vs UNVERIFIED

**Found (use these):**

- SM signed §2.2: script, Closer Dashboard, UnderwriteIQ process, offers, pay plan  
- SM §2.3: call reviews, live coaching, role-play  
- SM §2.5: score calls, enforce dashboard + script, downsells  
- SM §2.4 KPI names: dials, talk time, show rate, close rate, deposit collection, downsell conversion  
- Closer agreement §2.1–2.8 (especially 2.8 compliance)  
- Sarah manages closer hires  
- Interview form + 60-sec video + 3 scored questions (avg 4+)  

**UNVERIFIED:**

- No Sarah-authored numbered tick sheet  
- No Sarah score percent  
- Closer Exhibit A pay dollars  
- Alec `ai-call-reviewer` scrape **not on disk** (`credentials/notion-scrape/output/ai-call-reviewer--2b0c3aa7`)

---

## Manifest (this pass)

**Created / updated**

- `docs/workflows/employee-ramp-system-2026-08-24.md` (this board)  
- `docs/company-resources/ramp-closer-2026-08-24.md`  
- `docs/company-resources/ramp-funding-advisor-2026-08-24.md`  
- `docs/company-resources/ramp-inquiry-2026-08-24.md`  
- `docs/company-resources/ramp-repair-2026-08-24.md`  
- `docs/company-resources/closer-ai-drills-2026-08-24.md`  
- `docs/company-resources/sarah-final-gate-2026-08-24.md`  
- `docs/company-resources/closer-drill-agent-prompt-2026-08-24.md`  
- evidence `_load-pending.mjs`, `_seed-draft-coach.mjs`

**Used, not rewritten**

- funding education, closer playbook, Alec ramp map, closer pack, `src/config/offers.mjs`  
- Sarah SM OCR, closer agreement review, Agent Editor `/api/agents` create+save  

**Live pass (this thread)**

- Class quizzes on Company Brain Documents (`public/app/ramp-quizzes.js`)  
- `POST /api/agents` action `run` + Agent Editor drill card  
- OP-06 prompt updated; Promote + Approve via `_go-live.mjs`  
- Call samples from `call_outcomes` injected into the drill turn  

**Still not touched**

- AG-04 Setter Josh, AG-09 Inquiry Removal  
- New routes / new dashboards  
- New tables  

---

## Leftover

1. **PASS_BAR** — Chris must lock the AI / Sarah number. Unchanged.  
2. Clickable 20-box tracker. Not added.  
3. Two scrubbed sample reports. Not in repo.  
4. FA / inquiry / repair AI coaches. Later.  
5. Alec call-reviewer scrape missing from disk.  
6. **Meet audio words** — still UNVERIFIED. Drive has the file. Coach does not hear it.  
7. Company Brain class files may still have **0 search chunks** if embed failed earlier. Quizzes do **not** need those chunks.

---

## Confirm

- Quizzes run on **Company Brain → Documents**. No new dashboard. No new route.  
- Drill runs on **Agent Editor** via existing `POST /api/agents` `run`.  
- Call listener = existing `call_outcomes` + Drive stamp. Not “all calls as audio.”  
- Did **not** commit unless Chris asked (he did not).  
- Did **not** pull credit, charge a card, or mail a letter.  
- Did **not** touch AG-04 or AG-09.  
