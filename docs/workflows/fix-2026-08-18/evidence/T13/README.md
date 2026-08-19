# T13 — Agent Editor & Bland voice agents · evidence

Branch `fix/T13-agent-editor-bland` off `origin/main` at `c860b8c`.
Everything below was re-proved on 2026-08-19 before anything was changed.

## How each item was re-walked

**Before** — `https://fundhub.ai` as `owner@fundhub.ai` with the read-only audit harness
(`docs/workflows/ui-audit-evidence/_tools/ui-audit.mjs`, which answers every non-GET with 599 so
nothing is written), plus three read-only queries against the production database.

* `before/screen/audit.md`, `before/screen/audit.json`, `before/screen/1440-full.png` — the live screen
* `before/db-agents.json`, `before/db-events-triggers.json`, `before/db-schema-calls.json` — the live rows
* `tools/probe-*.mjs` — the exact queries, re-runnable

**After** — the screen rendered with the post-migration row shapes and driven by Playwright
(`after/screen/after-dom.json`, `after/screen/after-1440-full.png`,
`after/screen/after-retired-agent.png`), and migration 177 applied to a scratch Postgres 16.
`after/live-route-check.txt` shows `/api/agent-call` answering 404 on live today, which is how we
know the route ships with this branch.

## Verdicts

| Item | Status on 2026-08-19 | Proof |
|---|---|---|
| T13-01 two LIVE agents that cannot act | **REPRODUCED → FIXED** | `before/db-agents.json`: AG-04/AG-09 `status=live`, `prompt_missing=true`, `guardrails_missing=true`, `never_edited=true`. Now `draft`. |
| T13-02 8 retired agents painted as drafts, wrong counts | **REPRODUCED → FIXED** | Live screen read `2 LIVE · 0 SHADOW · 20 DRAFT`; database said 2/0/12/8. Now `0 live · 0 shadow · 14 draft · 8 retired`. |
| T13-03 no `agent_triggers`, no `agent_runs` | **REPRODUCED → FIXED** | `before/db-agents.json` `tables_present` lists only `agent_shadow_log` and `outbound_calls`. Both tables created by 177 and proved on scratch Postgres. |
| T13-04 `message.inbound` never written | **DOES NOT REPRODUCE AS WRITTEN — corrected** | The event now fires: **2 rows**, 2026-08-18T21:43 (`before/db-events-triggers.json`). The audit measured 0 before T5 merged. The robot still never wakes, for a different reason — see below. |
| T13-05 the picker rejects both LIVE agents | **REPRODUCED — working as designed, not a defect** | `src/agents/select.mjs:16,34` and `db/migrations/144_agent_runtime.sql:29-30` both record the exclusion as an owner decision. Not changed. The screen now says so instead. |
| T13-06 no way to start a phone call | **REPRODUCED → SEAM BUILT, DIALLING STILL HELD** | 55 controls clicked on the live screen, none starts a call; `outbound_calls` 0 rows; `INQUIRY_API_BASE` unset. New route proved absent on live (`after/live-route-check.txt`). |
| T13-07 seeded live without passing the gate | **REPRODUCED → FIXED** | `went_live_at = created_at = 2026-07-31T02:24:53.163Z` on both. 177 corrects the rows and adds the missing constraint. |
| T13-08 Editor and the real call script are two places | **REPRODUCED → FIXED** | Nothing in `src/` or `api/` posted to `api.bland.ai`. The new provider sends `agents.prompt`, pinned by a test. |
| T13-09 Bland's dashboard stores nothing | **NOT RE-TESTED — accepted as recorded** | Would need a live Bland API call. `webhook_captures` holds **0** rows for provider `bland`, consistent with the original finding. |
| T13-10 Save writes no runtime or Bland id | **REPRODUCED → FIXED** | The save `UPDATE` had 8 parameters and neither column. Now 10, proved by `src/http/agents-write.pg.test.mjs`. |
| T13-11 nobody has clicked Save on the two LIVE agents | **CONFIRMED, AND NOW MOOT** | `never_edited=true` on both. They are drafts now; saving one is an ordinary draft save, covered by test. |
| T13-12 the words spoken on the 30 prior calls | **CANNOT BE CONFIRMED — unchanged** | Bland's API does not return the `task` text. Nothing in this branch changes that. |
| T13-13 Save really does write | **STILL WORKS — now pinned** | `src/http/agents-write.pg.test.mjs` asserts the stored prompt, guardrails and a moved `updated_at`. |

## The one correction to the audit

**T13-04 is out of date.** `message.inbound` has fired twice, both on 2026-08-18 at 21:43, both
`channel: email` — almost certainly from T5's inbound-mail work merging in wave 1.

The reply robot still never wakes, but the reason has moved. Both events carry **no client**
(`has_client: false`), and `src/agents/runtime.mjs:57` returns `no_client` when the event has no
client attached. So the trigger exists now; what is missing is the step that matches an inbound
email to a person. That is messaging territory, not this thread's — recorded on the board.

## Test baseline, measured here

Local Postgres 16 on macOS, two scratch databases built by `db/migrate.mjs`, run one at a time.

| | tests | pass | fail |
|---|---|---|---|
| `origin/main` `c860b8c`, database `fh_t13_base` | 5845 | 5842 | **3** |
| this branch, database `fh_t13` | 5859 | 5856 | **3** |

The same three failures, in the same three files, none of them mine:
`scripts/journeys/generate.test.mjs` (gates on `finance/crs-pull` and `gifts/message-blaster` — T3/T11),
`src/http/read-endpoints-org-scope.test.mjs` (`company-brain-affiliate.mjs` — T9), and
`src/security/superuser-guard.test.mjs` (my scratch database connects as a superuser; an artefact of
the local setup, not of any code).

14 tests were added and all pass.
