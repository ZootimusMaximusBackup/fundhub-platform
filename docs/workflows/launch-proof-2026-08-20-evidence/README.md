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
| Call handler → `call_outcomes` → agent context → model request | pending real-Postgres run | pending |
| Present `log_disposition` → `call_outcomes` → agent context → model request | pending real-Postgres run | pending |
| Required deployed live suite | pending | pending |
| Pipeline card and drawer | pending live browser run | `screenshots/pipeline-card-drawer-MARKED.png` when run |
| Inactive tier rule | pending live browser run | `screenshots/commission-tier-read-only-MARKED.png` when run |
| Client Portal session | pending live browser run | `screenshots/client-portal-session-MARKED.png` when run |
| Fixture cleanup | pending live browser run | pending |

## Environment note

This cloud run started without `DATABASE_URL`, a staff e2e password, or a repo
`.env` file. The real-Postgres proof will run in the repository's PostgreSQL CI
job after push. The live gate and browser proof require credentials from a
gitignored environment and will not be replaced with demo data.
