# Ticket 2 — Staff & Teams footer prints [object Promise]

- **Ticket:** 2
- **Journey:** role-owner
- **Step:** Staff & Teams footer prints
- **Status:** FIXED-UNCLICKED
- **Login:** owner@fundhub.ai
- **Screen:** /app/staff-teams.html
- **Base:** http://localhost:8888 (no deploy)

## Files changed

- `public/app/staff-teams.html` — `FHData.wire` paint callback still runs `applyMyShift`, but no longer returns that Promise. It returns the live-roster footer string.

## Observed

Footer strip: `live roster · 1 staff · signed-in user not on roster · consent 0/1`

Not `[object Promise]`. Roster showed 1 person (Chris Stanbridge, OWNER). Staff read returned 200.

## Evidence

- `docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/staff-teams-shot.png`
- `docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/staff-teams-footer.json`
- `docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/staff-teams-capture.mjs`
