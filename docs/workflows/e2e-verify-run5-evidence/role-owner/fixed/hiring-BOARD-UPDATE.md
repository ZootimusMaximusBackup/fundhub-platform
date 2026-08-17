# Board update — ticket 3

| Field | Value |
|---|---|
| Ticket | 3 |
| Journey | role-owner |
| Login | owner@fundhub.ai |
| Step | Hiring screen crashes |
| Status | FIXED-UNCLICKED |
| Screen | /app/hiring.html |
| Base | http://localhost:8888 |

## What changed

When the hiring screen maps a candidate row, missing or null `flags` becomes `[]`. The board no longer dies on `a.flags.length`. The API was not changed.

File: `public/app/hiring.html` — one line in `mapCandidateRow`.

## Prove

- Signed in as owner@fundhub.ai (password from `.env` `STAFF_E2E_PASSWORD`, never printed).
- Opened `/app/hiring.html`.
- GET `/api/hiring/candidates` → **200**.
- Board painted **3 cards** (Juniper Vale, Cedar Holt, Maple Crest). Not stuck blank.
- Mapped flags on those rows: all arrays, length 0 (API still sends null; the screen defaults it).
- **No** pageerror `Cannot read properties of null (reading 'length')` / `flags.length`.
- Screenshot: `docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/hiring-shot.png`
- Network + console: `docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/hiring-network.json`

## Left on the page (not this ticket)

After the board paints, a **different** pageerror still fires: `Cannot read properties of undefined (reading 'label')`. That throw happens later in `boot()`, so the yellow bar can still say `loading hiring…`. The named crash (flags null → board never paints) is gone. Do not treat the leftover `.label` error as this ticket.

## Not done here

No deploy. No commit. No `fable-audit-2026-08-16.md` edit. Chris has not clicked yet → FIXED-UNCLICKED.
