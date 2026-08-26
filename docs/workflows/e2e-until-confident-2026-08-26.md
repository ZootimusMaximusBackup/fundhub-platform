# E2E until confident — 2026-08-26

**Door:** test only. Auditor + agent-tester + system-map.  
**No product fixes.** Did not touch PR #173. Did not remake PDFs. Did not send. Did not charge. Did not live CRS. Did not paper mail. Did not remint. Did not load the unused Josh script.

**PASS rule (owner-set):** a journey PASS is the **full event list in order** plus a **real talk** for a live voice agent. Desk load, one field, or a hang-up under 5 seconds is **FAIL**. If the intended file has **no talk order**, score **UNVERIFIED**, never PASS.

**Overall: not 100%. No journey is PASS.**

Map: `docs/workflows/system-map-2026-08-26.md`  
Skill: `.cursor/skills/fundhub-system-map/SKILL.md`

---

## What I now know how to e2e (without lying)

1. Read the **system map** first. Then cite the intended file. Say if it is only doors.
2. Walk **live fire** from `src/workflows/` — that is the event list. Do not treat a page open as the list.
3. For a live voice agent: load the **Agent Editor** prompt. Count letters. Roleplay that string. A 169-letter stub is FAIL even if a long file sits unused on disk.
4. If intended has no talk order → sequence is **UNVERIFIED**. Overall cannot be PASS.
5. A 0.13s Bland ring is FAIL for talk. Empty model replies are FAIL for talk.
6. Staff can open a desk and still fail the journey.

## What I still cannot claim

- Any customer journey as PASS.
- That I walked every live-fire event twice.
- That Josh or Inquiry Removal AI can do their real job on the live script.
- That PR #170 “what is next / six rounds” is on the live site.
- That I finished the Specialist click path on Repair Horse this pass (two click tries failed; I stopped).
- 100%.

---

## Sims (already minted — reused)

| File | Id | Plus-tag |
|---|---|---|
| Sim Repair Horse | `5ce80871-0b70-4d2d-89e0-efdd62aa2e2f` | `+sim-repair-20260825h` |
| Sim Fund Horse | `614927f7-95a9-4623-86e8-cd85420d9716` | `+sim-fund-20260825h` |
| Agent phone | — | `+16616054248` |

---

## Journeys

Ground truth cited. Live-fire list is from the system map. I did **not** walk those lists start to finish this pass.

| Journey | Intended | Has event / talk order? | What I actually did | Score |
|---|---|---|---|---|
| Client | `client-intended.md` | **No.** Doors only. Live fire is 15 events (welcome → book → Josh → closer → pay → docs → advisor). | Did not fire entry, welcome, book, Josh, close, or docs. Did not remint. | **UNVERIFIED** (no intended talk order). Not PASS. Full live-fire **not walked** = cannot be done. |
| Closer / Present | `role-closer-intended.md` | **No.** Doors only. Live fire: pipeline → Present → context → soft-pull → offer mint → contract → disposition → `fetchContext`. | Did not open Present. Did not mint. Did not log a disposition. | **FAIL** as a journey (desk not finished). Talk order **UNVERIFIED**. |
| Funding advisor | `role-funding-advisor-intended.md` | **No.** Doors only. | **B2 PASS** (expected vs actual, Fund Horse, stored + reload). **B1 FAIL** live (play saved, box empty; wait #176, one reload only). **B4 FAIL** twice — do **not** click Apply again. B3 tests-only, no DNS. | Journey **FAIL**. B2 locked PASS. |
| Inquiry | `role-inquiry-remover-intended.md` | Desk path **yes** (toggle → queue → open → Send if ready). **No talk script.** Phone inquiry on hold. | Live HTML/API only. Click walk failed (see Specialist). Did not Send. Did not call bureau. | Desk path **FAIL** this pass (could not finish the clicks). Talk **UNVERIFIED**. |
| Repair | same Specialist file + map §4 | Event bus **yes** (`repair.enrolled` → docs → analysis → letters ready → sent → response → next round). Intended has no talk. | API read on Repair Horse. Did not enroll, generate, send, or walk later events. | **FAIL** — not the full bus. See #170 row. |
| Affiliate | `affiliate-intended.md` | **No.** Doors only. | `/start?ref=AFF-000001` **wrote a click** (locked). Desk load is still not a journey PASS. Drips **not-live**. | Click **PASS**. Journey **FAIL**. Drips **not-live**. |
| White-label | `white-label-intended.md` | **No.** Doors + marketing notes. | Did not re-walk as a full journey. Custom domain / partner drips **not-live**. | **FAIL** as a journey. Domain / drips **not-live**. |
| Owner KPIs | `role-owner-intended.md` | **No** event tree. | **LOCKED PASS:** Funded tile and DB both **2**. Cash **$375.96**. Do not re-litigate. These five horsemen are still `funded=false` — the 2 are other files. | KPI strip **PASS**. Not “five horsemen funded.” |
| AR / pay-link mint | map §3 | AR-01…04 on **success-fee** only. Present Invoice does **not** start AR (AR/calls fact). | Two unpaid success-fee invoices. First notice **sent**. Next **sleeps 7 days**. New pay link minted unpaid. Did not pay. Did not walk AR-02–04. | AR-01 **happened**. Chain **FAIL** / not done. |

---

## PR #170 — Specialist Repair Horse (named test)

**Ask:** After deploy, staff on Repair Horse can see rounds, bureau, what was hit, what’s next. Do not remake PDFs. Do not send. Missing view = FAIL.

| Check | Expected | Observed | Score |
|---|---|---|---|
| Deploy of `c7a94dd` / “What is next” | Live HTML has the card. API has `rounds`. | Live `inquiry-remover.html` has **no** “What is next”. Live `GET /api/read/repair-cases?client_id=` has **no** `rounds` key. | **FAIL** — view missing. Did not fix. |
| File still exists | Sim Repair Horse | API: name match. Stage **Ready to send**. Round **R1**. Program **trial**. Cap **2**. Bureaus **EQ, EX**. Letters ready **2** (not sent). Items **41**. Timeline **0**. Need-me **true**. | API row exists. That is **not** a journey PASS. |
| Click the desk twice | Intended: Specialist → Repair → open person | Walk 1: found a hidden Inquiries `case-main` row, click timed out. Walk 2: login wait timed out. Stopped (two tries). | **FAIL** this pass. |

Did not click Stage. Did not click Send. Did not remake PDFs.

---

## Live AI agents

Live list from `GET /api/read/agents` (2026-08-26). Four live. Two talk on the phone.

| Agent | Prompt source | Letters | Intended talk order | Talk | Overall |
|---|---|---|---|---|---|
| **AG-04** Setter Josh | Agent Editor (live). Unused vendor file **not** loaded. | **169** stub | `client-intended.md` has **none** | First roleplay: called itself Sarah. Board `agent-tester-2026-08-26.md`. Did not re-run. | **FAIL** |
| **AG-09** Inquiry Removal AI | Same live stub as Josh (same 169 letters) | **169** stub | `role-inquiry-remover-intended.md` has **none** | Roleplay attempted with live stub. `callModel` was “live” but text was empty (OpenAI 429 / no credits). No Bland call. | **FAIL** (stub + no talk + sequence UNVERIFIED) |
| **AG-06** Document Check | Empty | 0 | none | Not live (draft) | **FAIL** / empty |
| **GHL-DOC** | Retired row (2266 letters) | — | none | Retired. Did not treat as live. | **not-live** |
| **AG-07** Recon | Internal watchdog | 342 | none | Not a buyer talk agent. Not roleplayed as Josh. | not a client talk PASS |
| **OP-06** Closer drill | Internal coach | 2621 | none | Desk glance is not a drill PASS. Not run. | **UNVERIFIED** |

A Bland call under 5 seconds would also be FAIL. I did not place one.

AG-09 detail: `docs/workflows/agent-tester-2026-08-26-2.md`

---

## Second pass

| Item | Second pass? | Result |
|---|---|---|
| Josh / AG-04 | No (already FAIL; do not load unused script) | still **FAIL** |
| AG-09 | Yes — new roleplay on live stub | still **FAIL** |
| Specialist Repair Horse clicks | Two tries | still **FAIL** |
| Full client / closer / funding / AR event lists | Not walked once, so not twice | **UNVERIFIED** / not done |

---

## What I still do not understand

1. How a later agent is supposed to walk the **client live-fire list** without ClickFunnels and without reminting — the map says those events start at apply / entry. I did not invent a workaround.
2. Where the **Josh talk order** will live. It is not in `client-intended.md`. Agents must not write intended files. Until a human writes it, sequence stays UNVERIFIED.
3. Whether **PR #170** is waiting on a deploy. Main has the “What is next” card. Live does not. I did not deploy.
4. Why `callModel` stayed on OpenAI after a 429 and returned empty talk. I did not change the model file.
5. I still have not seen Repair Horse **opened on the live desk** with my own clicks this pass.

---

## Left undone

- Full live-fire for five horsemen
- Closer Present + disposition → `fetchContext` `said:`
- Funding MOVE → Apply → mint (no pay)
- AR-01 through AR-04
- Meet tape
- Beta every-button
- Human-marked screenshots of the Specialist open row (no open shot this pass)
- Gmail / SMS prove on this pass

## Next

Do not call this e2e done. A Fixer can deploy #170 and/or write a real Josh prompt **only if Chris names that**. This lane stops.
