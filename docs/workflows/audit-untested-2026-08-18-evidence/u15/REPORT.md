# U15 — GoHighLevel live list

Date: 2026-08-18  
Did not POST a fake GHL body to a catch-door. Did not rotate keys. Did not put GHL in sandbox.

## Ground truth

No `docs/journeys/*-intended.md` step names “GHL live list.”

**MISSING** journey step. Scored against Chris’s claim on the board.

Env names used (values not printed): `GHL_RELAY_API_KEY` (local), `GHL_API_KEY` / `GHL_PRIVATE_API_KEY` / `GHL_LOCATION_ID` (Netlify when local missing).

## Chris’s claim

We still do not know what GHL is doing. Get a live list, or prove we still cannot.

## Score

**UNVERIFIED — same as W15.** Every live list API still says no. I did not invent the 140-name list.

## Prove

1. List APIs (GET only)

   | Key | Workflows | Pipelines | Phone / A2P |
   |---|---|---|---|
   | `GHL_RELAY_API_KEY` | **401** “token is not authorized for this scope” | **401** same | 404 / 401 |
   | `GHL_API_KEY` | **401** “Invalid JWT” | **401** Invalid JWT | 404 / 401 |
   | `GHL_PRIVATE_API_KEY` | **401** “Invalid JWT” | **401** Invalid JWT | 404 / 401 |

   No workflow on/off table. No A2P 10DLC table. No pipeline table.

2. Platform door
   - `POST https://fundhub.ai/api/webhooks/ghl` with empty JSON → **404** `unknown provider: ghl`
   - `webhook_captures` GHL-like rows: **0**

3. Did not POST to old GHL catch-doors.

## Evidence

- `env-names.json`
- `ghl-list.json`
- `platform-webhook.json`
- `db-captures.json`

## FAIL — live GHL list

- Journey: GHL live list (Chris’s claim; **MISSING** in intended)
- Step: GET workflows / pipelines / phones
- Expected: a list we can read
- Observed: 401 / 404 on every list path. Platform GHL webhook 404. 0 GHL captures.
- Evidence: `ghl-list.json`, `platform-webhook.json`
