# Launch proof — 2026-08-20

Branch: `cursor/launch-proof-gaps-89ad`

## Safety contract

- Database chain proof uses one real PostgreSQL connection and rolls back.
- Live browser fixtures are named `E2E ... TEST FIXTURE`.
- Pipeline proof creates its own client and card. It never moves or archives a real client.
- The commission tier fixture is inactive and has no edit control.
- Portal proof uses a real client account at an allowed `e2e+aff-*` address.
- Cleanup checks fixed ids, email, names, and markers before deleting anything.
- No send, pull, letter, payment, archive, move, rate change, or delete button is used.

## Proof status

| Proof | Status | Evidence |
|---|---|---|
| Call handler → `call_outcomes` → agent context → model request | **PASS — disposable real PostgreSQL** | `postgres-chain-proof.md` |
| Present `log_disposition` → `call_outcomes` → agent context → model request | **PASS — disposable real PostgreSQL** | `postgres-chain-proof.md` |
| Fixture safety source checks | **PASS — 3/3** | local `node --test src/http/launch-proof-fixtures.test.mjs` |
| Required deployed live suite | **PASS — 31/31 required ids (100/100)** | local run against deployed Fundhub |
| Pipeline card and drawer | **PASS — human path** | [`human/pipeline-drawer-MARKED.png`](human/pipeline-drawer-MARKED.png) |
| Inactive tier rule | **PASS — human path** | [`human/tiered-rule-MARKED.png`](human/tiered-rule-MARKED.png) |
| Client Portal session | **PASS — human path** | [`human/client-portal-header-MARKED.png`](human/client-portal-header-MARKED.png) |
| Fixture cleanup | **PASS — complete** | proof fixtures removed after all three human checks |

## Local human-proof completion

The deployed live suite passed all 31 required checks. The Pipeline drawer,
read-only tiered commission rule, and Client Portal session then passed their
human click paths. The marked screenshots above show the exact verified
elements. Cleanup finished after the checks, and no proof fixtures remain.
