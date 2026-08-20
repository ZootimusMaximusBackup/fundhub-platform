# Real PostgreSQL context-chain proof

- Commit: `05900ab1f73c700da55b2b11c2abe8f149bf82d0`
- CI run: <https://github.com/ZootimusMaximusBackup/fundhub-platform/actions/runs/32422552899>
- Job: `suite (real Postgres — reports, does not block)`
- Focused step: `Prove Call and Present context chain` — **PASS**
- Database: disposable PostgreSQL 16 with pgvector; every migration passed first

## Proved in one transaction

1. The Call write handler stored `LAUNCH-PROOF-CALL-20260820` in `call_outcomes`.
2. `/api/read/agent-context` returned that marker in `context.as_prompt_block`.
3. The next real agent runtime turn sent that marker in the model spy's `system` request.
4. The Present `log_disposition` handler stored `LAUNCH-PROOF-PRESENT-20260820` in `call_outcomes`.
5. The context endpoint and next model request both received the Present marker.
6. The model requests were also present in `agent_shadow_log`.
7. The test ended with `ROLLBACK`, removing its org, staff, client, session, messages, outcomes, and shadow rows.

## Other focused checks

- Fixture safety tests: **3/3 pass**
- Syntax lint: **1,368 files and inline scripts parse clean**

The later full-suite failures are older repository failures. They do not change
the focused step result above.
