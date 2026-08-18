# U17 — PostGrid capture received

Date: 2026-08-18  
Did not send a letter. Did not POST a fake webhook. Did not put PostGrid in sandbox.

## Ground truth

No `docs/journeys/*-intended.md` step names “PostGrid tells Fundhub a letter landed.”

**MISSING** journey step. Scored against Chris’s claim on the board.

Env names: `POSTGRID_API_KEY` present, `POSTGRID_WEBHOOK_SECRET` present. Values not printed.

## Chris’s claim

PostGrid (the letter-mail company) can tell Fundhub a letter landed.

## Score

**UNVERIFIED — event never fired.**

The receive door exists. It has never stored a capture. No letter row has a delivery time.

## Prove

1. Webhook route
   - URL: `https://fundhub.ai/api/webhooks/postgrid`
   - Code: `src/http/router.mjs` has a `postgrid` branch (signature check, then `onMailDelivered`).
   - Live GET → **405** `Method not allowed` (door is there; POST-only). Did not POST.

2. Capture table
   - PostGrid / mail-letter rows in `webhook_captures`: **0**

3. Send path in this repo
   - Yes. `src/messaging/providers/mail-letter.mjs` `sendLetter` posts to `api.postgrid.com/print-mail/v1`.
   - Callers: `src/metro2/delivery/send.mjs`, `api/repair/send.mjs`.
   - `dispute_letters` rows: **0**
   - Inquiry cases: **3**, `first_delivery_at` on **0**

4. Receiver exists. Capture never stored. Event never fired.

## Evidence

- `door.json`
- `db.json`
- `route-code.json`
- `env-names.json`

## FAIL — PostGrid capture received

- Journey: PostGrid letter landed (Chris’s claim; **MISSING** in intended)
- Step: a stored capture or delivery row
- Expected: at least one PostGrid capture
- Observed: door 405 on GET; captures **0**; no letter delivery
- Evidence: `door.json`, `db.json`
