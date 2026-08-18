# U8 — Bank-app launcher (do not file)

Date: 2026-08-18  
Test client only: `8556bedc-46e1-4d85-b0cd-a24adfee1521`  
Never opened: `9af65808-…`

## Ground truth

No `docs/journeys/*-intended.md` step names “staff launches a bank application.”

**MISSING** journey step. Scored against Chris’s claim on the board.

Env names checked: `OXYLABS_USERNAME`, `OXYLABS_PASSWORD`, `STAFF_E2E_PASSWORD`, `DATABASE_URL`. Values not printed. Both Oxylabs names are **absent** in local `.env`. Did not put Oxylabs in sandbox.

## Chris’s claim

From the TEST file, staff can launch a bank application.

## Score

**BROKEN.** Launch door answers. It stops at missing Oxylabs keys. No session. No bank site.

Did not file an application. Did not type a bank login.

## Prove

1. Owner login on TEST. One `POST /api/proxy/launch` with dummy lender `00000000-0000-4000-8000-000000000001`.
2. Status **503**. Key **`oxylabs_credentials_missing`**. Message names `OXYLABS_USERNAME`, `OXYLABS_PASSWORD`. `session_id` null.
3. `proxy_sessions`: **0** before, **0** after (all / TEST / live file).
4. Other apply doors:
   - CCP TEST: “FUNDING • APPLY” says lender list is empty. Script `FHProxyApply` is loaded. No Apply press.
   - Lenders TEST: table empty. Apply column exists. **0** Apply buttons. Did not click Apply.
   - Pipeline loads `proxy-apply.js` (same door). Did not click Apply.

## Evidence

- `proxy-launch.json`
- `proxy-sessions-before.json`
- `proxy-sessions-after.json`
- `oxylabs-cred-names.json`
- `login.json`
- `01-ccp-test.png`
- `02-lenders-test.png`
- `03-pipeline.png`
- `ccp-doors.json`
- `lenders-doors.json`

## FAIL — launch a bank app

- Journey: staff launch bank app (Chris’s claim; **MISSING** in intended)
- Step: `POST /api/proxy/launch` on TEST
- Expected: a session / bank apply door that can start
- Observed: **503** `oxylabs_credentials_missing`. Sessions stayed 0. Lender list empty.
- Evidence: `proxy-launch.json`, `proxy-sessions-after.json`
