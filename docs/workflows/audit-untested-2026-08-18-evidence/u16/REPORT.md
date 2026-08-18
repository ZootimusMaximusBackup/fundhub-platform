# U16 — Bland call started from this site

Date: 2026-08-18  
Did not start a call. Did not Save or Promote. Did not put Bland in sandbox.

## Ground truth

No `docs/journeys/*-intended.md` step names “this site starts a Bland call.”

**MISSING** journey step. Scored against Chris’s claim on the board.

Env names: `BLAND_API_KEY` present, `INQUIRY_API_BASE` **absent**, `INQUIRY_API_SECRET` present. Values not printed.

## Chris’s claim

fundhub.ai can start a Bland call (Bland is the phone-robot company).

## Score

**BROKEN.** This site has no start-call button and the phone door says not configured. Last Bland call on this key is **2026-08-16**. Not proven from this CRM.

## Prove

1. Dial / start-call button
   - Agent Editor: Save / Promote only. **0** start-call buttons. Did not press Save or Promote.
   - Specialist: **0** start-call buttons. Did not press Send (U6 owns that).
   - CCP TEST: **0** start-call buttons.

2. Who calls Bland
   - `src/` files that mention `api.bland.ai`: **0**
   - `src/adapters/bland.mjs` listens for a finished-call ping. It does not start a call.
   - Vendor send path: `vendor/inquiry-remover/src/lib/bland-client.js` (and its test).

3. Phone proxy
   - `INQUIRY_API_BASE` unset.
   - Owner `GET /api/inquiry?action=cases` → **503** `not_configured` “Inquiry phone runtime is not configured.”
   - Did not POST `action=launch`.

4. Last safe refuse: **503 not_configured**. No number dialed.

5. Last Bland call on this key: **2026-08-16**. Total **30**. GET does not name fundhub.ai as the source.

## Evidence

- `01-agent-editor.png`
- `02-specialist.png`
- `03-ccp.png`
- `screens.json`
- `inquiry-door.json`
- `repo-bland-hosts.json`
- `bland-last-call.json`
- `env-names.json`

## FAIL — start a Bland call from this site

- Journey: start Bland call (Chris’s claim; **MISSING** in intended)
- Step: press start-call / phone proxy
- Expected: a call starts from fundhub.ai
- Observed: no dial button; `/api/inquiry` 503 `not_configured`; `src/` never calls Bland
- Evidence: `inquiry-door.json`, `01-agent-editor.png`, `repo-bland-hosts.json`
