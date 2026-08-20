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
| Required deployed live suite | **BLOCKED — live credentials unavailable in this cloud run** | no 31/31 claim |
| Pipeline card and drawer | **BLOCKED — fixture database and staff login unavailable** | no screenshot created |
| Inactive tier rule | **BLOCKED — fixture database and staff login unavailable** | no screenshot created |
| Client Portal session | **BLOCKED — fixture database and client password unavailable** | no screenshot created |
| Fixture cleanup | **NOT NEEDED — setup never ran and no live rows were created** | production database untouched |

## Environment note

This cloud run started without `DATABASE_URL`, a staff e2e password, or a repo
`.env` file. The rollback-only chain proof passed in GitHub's disposable
PostgreSQL job. The live gate and browser proof could not safely start: this
machine has no Netlify command-line tool, and its GitHub token is denied access
to repository secret names and values. No demo data or guessed credential was
used.

Because fixture setup did not run, there are no honest live UI screenshots to
mark. Creating screenshots from mocked or demo data would not prove the
requested deployed paths.
