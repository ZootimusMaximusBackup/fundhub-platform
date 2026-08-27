# Staff deep monitoring — workflow board

Updated: 2026-08-04
**Location:** git worktree `/Users/zootimusmaximus/fundhub-platform-staff-monitoring` branch `staff-deep-monitoring`

(Parallel agents were wiping new files in the main workspace on `money-chain-writers`, so this build lives in an isolated worktree.)

## Decisions

| Decision | Choice |
|---|---|
| Hubstaff pull | **Poll** every 10 minutes |
| Revoke | Clears `monitoring_consent_at` to NULL |
| Event kinds | `monitor_activity`, `monitor_screenshot` |
| Migration | `142_staff_monitoring_consent.sql` |
| Credentials | `HUBSTAFF_TOKEN`, `HUBSTAFF_ORG_ID` unset |
| Consent gate | Ingest path; SQL + JS; no global override |

## Status

All units done. Tests: 51 pass (adapter, ingest consent gate, consent grant/revoke, routes, telemetry). Lint clean. Journeys regenerated.
