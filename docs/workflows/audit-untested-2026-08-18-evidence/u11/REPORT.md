# U11 findings — Pipeline MOVE / archive (test card only)

Walked 2026-08-18 on `https://fundhub.ai`. Owner `chris@fundhub.ai`. One write: MOVE on TEST client `8556bedc-…` card `5410b98b-…`. Never opened the live credit file. Did not archive. Did not move anyone else’s card.

Ground truth: **MISSING.** No `docs/journeys/*-intended.md` step names pipeline MOVE or archive. Scored Chris’s claim on the board only.

Evidence: `docs/workflows/audit-untested-2026-08-18-evidence/u11/`  
Logs: `db.json` `before.json` `walk.json`  
Shots: `00-owner-login.png` `u11-pipeline.png` `u11-before-move.png` `u11-after-move.png`

## What I did

- Counted `cards` rows for the TEST file. There is **1**.
- Opened the live Sales board. The TEST card was on **Diagnostic Paid**.
- Dragged that card to **Decision Rendered**. Did not press Archive. Did not click a Funding route.
- Re-checked the database.

## Score

| Ask | Result |
|---|---|
| TEST file has a cards row? | **Yes — 1.** Card `5410b98b-…`. Sales. Stage was `diagnostic_paid`. Not a demo row. Client is not tagged simulated. |
| Move or Archive once | **PASS.** Drag on the TEST card only. Board showed it in Decision Rendered. |
| Database stage after | **PASS.** Same card, same pipeline (Sales), stage now `decision_rendered`. Still 1 TEST card. Live board still 18 cards. |
| Archive | Not pressed. MOVE was enough. |

Chris’s claim (“a pipeline card can be moved or archived, and the board updates”): **PASS** on MOVE. Archive not tried.

## PASS

- Journey: **MISSING.**
- Expected (board): only move a card for TEST `8556bedc-…`. Shot before/after. Database stage.
- Observed: before stage `diagnostic_paid`. After stage `decision_rendered`. `POST /api/pipeline-cards` → **200**. After shot shows **TEST Client Role** in Decision Rendered.
- Evidence: `u11-before-move.png` `u11-after-move.png` `walk.json` `db.json`

## What I did not do

- No Archive (that archive button files the whole contact, not just the card).
- No MOVE of a real person’s card.
- No new card. No simulate.
- No live credit file.
- No deploy. No app, test, config, env, or intended-journey edits.

## Stop

Chris names what to fix. Nothing to fix on this door unless he wants Archive proven too.
