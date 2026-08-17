# role-funding-advisor — payload shapes (GET only, signed in as advisor@fundhub.ai)

Ran 2026-08-17T03:40Z – 03:41Z against https://fundhub.ai. Token never printed. No bodies sent.
`array(N)` = N rows came back. Shapes are top-level keys only.

## Role-defining and high-value reads

| Route | Status | Shape |
|---|---|---|
| `/api/read/proxy-sessions` | 200 | `{ok, count, limit, offset, hasMore, items:array(0)}` — reachable, empty |
| `/api/read/lenders` | 200 | `{ok, lenders:array(0), meta}` — empty (matches lenders.html empty state) |
| `/api/read/inquiries` | 200 | `{ok, count, limit, offset, hasMore, items:array(0)}` |
| `/api/read/inbox` | 200 | `{ok, count, limit, offset, hasMore, items:array(8)}` |
| `/api/read/finance-command` | 200 | `{ok, as_of, window, entities:array(0), totals, per_card:array(28), cashflow_series:array(6), combined_series:array(6), …}` |
| `/api/read/company-activity` | 200 | `{ok, simulated, demo_mode, nodes:array(12), kpis:array(3), clients:array(24), routes:array(0)}` |
| `/api/read/agents` | 200 | `{ok, count, …, items:array(22)}` |
| `/api/read/search?q=a` | 200 | `{ok, q, groups}` |
| `/api/read/workflows` | 200 | `{ok, count, …, items:array(50)}` |
| `/api/tasks` | 200 | `{ok, count, tasks:array(63)}` |
| `/api/shifts` | 200 | `{ok, shift}` |
| `/api/read/entitlements` | 200 | `{ok, count, …, items:array(0)}` |
| `/api/read/funding-rounds` | 200 | `{ok, count, …, items:array(0)}` |
| `/api/read/contracts` | 200 | `{ok, view, count, items:array(6)}` |

## Routes -actual.md lists with no method (probe skipped them) — GET follow-up

See `extra-get-probe.json`.

| Route | Status | Shape / error |
|---|---|---|
| `/api/dashboard/kpis` | 200 | `{ok, kpis, display}` |
| `/api/dashboard/clients` | 200 | `{ok, count, clients:array(27)}` |
| `/api/dashboard/pipeline` | 200 | `{ok, pipeline, stages:array(10), total}` |
| `/api/dashboard/client` | 400 | `?id= required` (needs a client id — reachable, not blocked) |
| `/api/health` | 200 | `{ok, db, state, migrations, expected, pending, error, checkedAt}` |
| `/api/auth/session` | 200 | `{ok, principal, staff}` |
| `/api/read/tradelines` | 400 | `client_id is required and must be a uuid` |
| `/api/read/agent-context` | 400 | `client_id is required and must be a uuid` |
| `/api/read/agent-shadow-log` | 200 | `{ok, rows:array(0), log:array(0)}` |
| `/api/climate/config` | 200 | `{ok, mapsKey, applyUrl}` |

Not probed (write-only, no bodies sent): `/api/proxy/launch`, `/api/proxy/end`, `/api/dashboard/seed`, `/api/dashboard/client-archive`.
