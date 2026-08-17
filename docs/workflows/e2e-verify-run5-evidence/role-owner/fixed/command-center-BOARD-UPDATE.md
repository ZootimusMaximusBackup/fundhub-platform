# Ticket 5 — board update (every dash)

| Field | Value |
|---|---|
| Ticket | 5 |
| Journey | role-owner |
| Step | Command Center pipeline summary |
| Status | **FIXED-UNCLICKED** |
| Role | owner@fundhub.ai |
| Base | http://localhost:8888 |

## Dash list (each wired or removed)

| Was | Now |
|---|---|
| CC-01 meta `— active clients · — moved forward today` | `16 active clients · 1 moved forward today · counts only` (pipeline + kpis) |
| Holds chips / Oldest `—` | Removed. One empty: "No holds. A hold will show here when a file is waiting." |
| Hardcoded stage chips with `—` | Removed. Chips built from `/api/dashboard/pipeline` stage names and counts |
| Rail totals `—` | Live numbers, or `0` if that board could not load |
| KPI values `—` (including API "—" for empty rates) | `$0`, `1`, `0`, `0`, `0`, `0` |
| Footer `— active clients` | `16 active clients` |
| Clock `—` | Live clock (not a metric) |
| R-07 rail total | Left blank (no pipeline). Empty copy, no dash |

## Evidence

- `docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/command-center-shot.png`
- `docs/workflows/e2e-verify-run5-evidence/role-owner/fixed/command-center-network.json` (`leftoverDashes: []`)
