# U18 — Plaid Connect bank

Date: 2026-08-18  
Did not click Connect. Did not open Plaid Link. Did not attach a bank. Did not put Plaid in sandbox. Never opened the live credit file.

## Ground truth

No `docs/journeys/*-intended.md` step names “Connect a bank through Plaid.”

**MISSING** journey step. Scored against Chris’s claim on the board.

## Chris’s claim

Finance OS can Connect a bank (personal / business / investment) through Plaid.

## Score

**BROKEN.** No Connect button. No `link_token` path. Webhook is not live. `plaid_items` is 0.

## Prove

1. Owner opened `https://fundhub.ai/app/finance-os.html`.
   - Header: “COMPANY MONEY — Not connected.”
   - “The bank is not linked.”
   - Personal / Business / Investment: NONE.
   - **0** Connect bank / Plaid / Add account buttons.
   - Did not click anything that would open Plaid Link.

2. Repo search (src / api / public): `Plaid.create` **0**, `link_token` **0**, `Connect bank` **0**, `cdn.plaid.com` **0**.
   - Git history `-S Plaid.create`: **0** commits.

3. `plaid_items` count: **0**.
   - `POST /api/webhooks/plaid` empty JSON → **404** `unknown provider: plaid`.

4. No button and no `link_token` path. Did not start a Link session.

## Evidence

- `01-finance-os.png`
- `finance-os.json`
- `repo-search.json`
- `db.json`
- `webhook.json`

## FAIL — Connect bank

- Journey: Connect bank through Plaid (Chris’s claim; **MISSING** in intended)
- Step: Connect button / link_token / webhook
- Expected: a live Connect door
- Observed: no button; no Plaid.create ever; webhook 404; items 0
- Evidence: `01-finance-os.png`, `repo-search.json`, `webhook.json`
