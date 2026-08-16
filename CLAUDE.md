# How to work in this repository

This file governs agent behavior. It is not product documentation.

Domain facts, business rules, and architecture live in `docs/`. Read them when a task touches them. Do not restate them here.

## 0. STOP — split the work first

This is a hard rule. It fires at the start of every new project, task, or build request. No exceptions.

Before you plan, before you read code, before you write anything: propose how to split this into parallel workflows.

I forget to do this. When I forget, a ten-minute job takes ten hours. Your job is to make sure I never start serial work that should have been parallel. Do not wait to be asked. Do not skip it because the task seems small.

### Required output, before any other work

1. The split. How many workflows, and what each one owns.
2. What runs at the same time vs. what has to wait. Name any real dependency. If there is none, say "no dependencies — all parallel."
3. A copy-paste prompt for each workflow. Written so I can open a new session, paste it, and go. Self-contained — each prompt must stand on its own without the others for context.
4. Which one you are taking. You run one. I launch the rest.
5. The shared board. Name the `docs/workflows/<batch>.md` file all workflows will read and write.

Then stop and wait for my go.

### If it truly cannot be split

Say so in one line, give the reason, and continue. But bias hard toward splitting. Four workflows that finish in twenty minutes beat one that finishes in two hours, every time.

### The test

Before you begin any work, ask yourself: could a second agent be doing something useful right now? If yes, and I have not launched one, you did not do your job.

## 1. Check the model before you start

Right after the split proposal, state one line: the model this work needs, and whether the current one matches.

Format: `Model: <tier> — current is <tier>. Match / Switch.`

Rough mapping:

* Haiku — mechanical and fully specified. Copy changes, renames, formatting, single-file edits where the answer is already decided.
* Sonnet — normal build work. Building a component from a clear spec, writing tests, wiring a route.
* Opus — anything where being wrong is expensive. Architecture, debugging something that already failed once, refactors across many files, anything touching a hard rule, compliance-flagged code, or work I cannot verify myself.

Raise thinking effort — not just the tier — for debugging and architecture. Lower it for mechanical work.

**Hard rule: if the current model is below what the work needs, say so and stop. Do not proceed underpowered and hope.** A cheap model on expensive work is the most costly mistake available — I cannot read the output, so I will not catch it.

Overshooting is fine. If in doubt, ask for the higher tier.

## 2. Ground rules

This repo only. Do not read, reference, or modify systems outside it to "stay consistent" with them. If a task appears to require changes outside this repo, stop and say so.

**Ask when you are not certain.** This is a hard rule, not a courtesy.

Stop and ask a clarifying question when any of these are true:

* The request could reasonably mean more than one thing
* You are inferring intent rather than reading it
* The change touches a flow and the intended journey does not cover it
* You are about to add a step, field, route, or dependency that was not explicitly asked for
* You are about to modify a file you have not read
* Confidence in the approach is below certain

Ask one question. Wait. Do not ask and proceed in the same turn.

**Guessing costs more than asking.** A wrong build is a day. A question is a minute.

**Never invent.** If information is missing, that absence is the finding. Report it. Do not fill the gap with a plausible assumption.

## Owner decisions are final.

I'm the owner and sole decision-maker. When I set a value or make a call — retention windows, compliance posture, scope, priorities — it's decided.

Log it as owner-set and move on.

Do not re-raise it. Do not recommend legal or compliance review. Do not add "you should have counsel look at this" to reports or summaries.

If something is genuinely unsafe or broken, say it once, plainly, and then drop it.

**This section qualifies the ones around it.** Where it and another section disagree, this one wins:

* §2's "ask when you are not certain" does not apply to a call I have already made. Uncertainty about *how* to build it is still a question worth asking. Uncertainty about *whether I meant it* is not.
* §7 still applies as written — keep the `COMPLIANCE REVIEW REQUIRED` label on the changes it lists. That label is a marker I asked for, not a recommendation. What stops is the advice attached to it.
* §9's task report and §10's summaries carry the decision as recorded fact, with no rider suggesting I revisit it.

**Left unnumbered on purpose.** Section numbers are referenced 27 times across this repo (`CLAUDE.md §4`, `§12`, and so on). Inserting a numbered section here would shift every later number and silently break all of them.

## 3. Before writing any code

1. Read the relevant code. Symbol lookup before file reads (Grep patterns, not full file reads).
2. Read the intended journey for any flow you are touching.
3. Produce a plan in plain English. Name: files to be touched, journeys affected, how the change will be verified.
4. Wait for approval. Do not write code in the same turn as the plan.

## 4. Journey documentation

Every flow in this system is documented as a Mermaid flowchart. This is how a non-coder sees what the system actually does. Keeping it accurate is part of the work, not a nice-to-have.

### Location and format

`docs/journeys/`, one pair of files per journey:

* `<name>-intended.md` — hand-authored. What should happen. Source of truth. Agents do not edit this file.
* `<name>-actual.md` — generated from code. What does happen. Agents maintain this.

Mermaid goes inside fenced blocks in `.md` files so GitHub renders it:

````
```mermaid
flowchart TD
    A[Step] --> B{Decision}
    B -->|Yes| C[Outcome]
    B -->|No| D[Other outcome]
```
````

A standalone `.mermaid` file will not render. Always `.md`.

### Journeys tracked

`client`, `role-owner`, `role-sales-manager`, `role-closer`, `role-funding-advisor`, `role-inquiry-remover`, `affiliate`, `white-label`

### Rules

* Read before you build. Intended journey first, every time a flow is in scope.
* If code requires a step not in the intended journey — STOP AND ASK. Do not add the step. Do not edit the intended file to match your code. This is the single most important rule in this document.
* Update `-actual.md` in the same commit as the code change. Never a follow-up commit. A stale journey is worse than no journey.
* Generate `-actual.md` from code, never from the spec or from memory. If you cannot trace a path in the code, mark it `UNVERIFIED` in the diagram. Do not draw what you assume.
* Gaps between intended and actual are findings. Report them in your summary. Do not silently reconcile them.

### Changelog

Append one line to `docs/journeys/CHANGELOG.md` for every journey change:

```
YYYY-MM-DD | <journey> | <what changed> | <why> | <commit>
```

Newest at top. This is the human-readable record. Keep it honest — including when a change made a journey worse.

## 5. Orchestration

The split proposal is section 0. It happens before anything else. This section covers how the workflows behave once running.

### Rules

* Fan out only on independent units — one workflow per screen or module. Never parallelize steps that depend on each other's output.
* Ground once, fan out. One agent reads shared context and writes a brief. Other agents consume the brief. Never have four agents independently read the same modules.
* Pipeline, don't barrier. Each unit runs ground → build → verify on its own. Do not hold a whole phase for the slowest agent.
* **Max agents (owner-set 2026-08-14).** Fill every independent unit in one turn. One agent per file fence. Do not sit serial when a second agent could work. The old “cap at 5” is repealed — merge conflicts come from two writers on one file, not from too many workflows.

### How workflows coordinate

Agents do not message each other. They coordinate through a shared file. That file is the communication layer.

Every multi-workflow batch gets `docs/workflows/<batch-name>.md` containing:

* The task list — every unit, its owner, its status (`pending` / `claimed` / `done` / `blocked`)
* The shared context brief from the ground phase
* Change manifests — files touched, exports added, props changed, routes affected, journeys impacted
* Blockers and open questions

Protocol:

* Claim a task by marking it `claimed` before starting. Never work an unclaimed or already-claimed task.
* Write your manifest to the file when done, before reporting complete.
* Read the file before starting. Another workflow may have already changed something you depend on.
* Verify agents read manifests. They never rediscover changes by re-reading the tree.
* Blocked? Mark it `blocked`, write why, and stop. Do not work around another workflow's unfinished output.

Keep this file human-readable. I use it to see what is happening without opening a single code file.

## 6. Definition of done

Never report a task complete until all of these pass:

1. `npm run lint`
2. `npx tsc --noEmit`
3. Test suite green — no skipped, deleted, or weakened tests
4. Playwright check on any UI change
5. `-actual.md` journeys updated, changelog appended
6. Change manifest emitted

If something fails and you cannot fix it, say so plainly. Do not report partial work as finished. Do not make a suite pass by removing the test that failed.

## 7. Compliance flagging

This is a regulated consumer-finance product. Domain rules live in `docs/compliance/`. Read them before touching related code.

Flag `COMPLIANCE REVIEW REQUIRED` at the top of your summary for any change affecting: dispute logic, credit-repair messaging, fee timing, refund behavior, payment rails, consent capture, or credit-pull type.

Flagged changes ship only after explicit human approval. Never draft customer-facing claims about credit outcomes.

## 8. Guardrails

**The stuck rule.** Two failed attempts at the same fix, stop. Report what you tried, what happened, and your best guess at the cause. Do not try a third time. Do not start rewriting surrounding code to make the problem go away. Thrashing is the most expensive failure mode there is.

**Scope discipline.** Touch only what the task requires. No drive-by refactors, no renaming things you happened to notice, no "while I was in there." If you find something worth fixing, write it down and move on.

**Scope creep check.** If the work grows past roughly double what the plan estimated, stop and re-scope with me. Do not push through a task that turned out to be three tasks.

**Reuse before you build.** Search for an existing implementation before writing a new one. Two functions doing the same thing is a bug that takes months to surface.

**Commit working states.** Commit whenever the suite is green and a unit is complete. Small commits mean a bad build costs minutes to undo instead of a day.

**Checkpoint when context fills.** If a session is long or has gone sideways, write current state to the workflow file and tell me to start fresh. Do not push a degraded session forward. Quality drops well before you run out of room.

**Conventions.** Simplest thing that works, no speculative abstraction. No new dependencies without asking. Match existing patterns in the file you are editing over your own preference. Never commit secrets — no keys, tokens, or PII in code, fixtures, or logs. Delete dead code you create.

## 9. Task report

End every completed task with this, in this order:

1. What changed — one line, in plain language
2. What I need you to check — the one or two things only a human can verify, with exact steps
3. Risk — anything that could break elsewhere, or "none"
4. Left undone — anything skipped, deferred, or worked around
5. Next — the single next action

If the answer to 4 is "nothing," say so explicitly. Silence there reads as complete, and if it wasn't, that is how things ship broken.

## 10. How to talk to me

I am the decision maker and I do not read code. Optimize for that.

### Plain language — required

Write everything at a 5th grade reading level. This is not optional and it is not a style preference. If I cannot understand what broke, I cannot decide what to do about it.

* No jargon. If a technical term is unavoidable, define it in one short sentence right there.
* Say what broke in terms of what the user sees, not what the code does. Not "null pointer on the auth middleware" — "people can't log in."
* No acronyms unless you spell them out first.
* Short sentences. One idea each.
* Never assume I know a tool, library, or pattern. I don't.

If you catch yourself writing a sentence I would have to look up, rewrite it.

### Everything else

* No preamble, no filler, no "Sure, I'd be happy to."
* No hedging. State it.
* Lead with the answer, reasoning after.
* When something breaks: fastest likely fix first, then the next two causes. No troubleshooting trees.
* Flag risk in one line, not a paragraph. Skip obvious warnings.
* One question at a time, and only when it actually blocks you.

## 11. Deployment and infrastructure

| | |
|---|---|
| Deploys from | `main` |
| Netlify team | `zootimusmaximusbackup` |
| Netlify site | `transcendent-wisp-888771` |
| Supabase project ref | `oqpnlusrotpxfenysfxz` (Postgres, session pooler, us-west-2) |

Config lives in Netlify env vars. Schema lives in `db/schema`, `db/migrations`, `db/seed` and is applied by `db/migrate.mjs`. The app reads `DATABASE_URL`.

**Env law (owner-set):** Real env values are gitignored (`.env`, `.env.*` except `.env.example`, `credentials/`) or live on Netlify. Agents **read** local `.env` when it exists. Never commit secrets. Never ask me to paste or rotate a key that is already set unless that exact key is proven broken right now.

### Do these without asking

* **A new env var is yours to set.** When code you write or review reads one:
  `netlify env:set KEY "value" --context production --context deploy-preview --context branch-deploy --secret`.
  Generate strong random values for secrets. Do not hand me a form to fill out.
* **`--secret` on anything holding a credential.** Always.
* **Batch env vars. ONE deploy at the end.** Set every variable first, then deploy once: `netlify deploy --build --prod`.

  `netlify env:set` does not build anything by itself — there is no `--no-restart` flag and none is needed. A new value simply sits there until the next build picks it up. So setting ten variables costs nothing; it is the deploy after each one that costs a build.

  Deploying per-variable on 2026-08-06 burned the month's build credits and paused the live site. Never do it again. The same applies to any credential or config work: collect the whole set, verify with `netlify env:list --context production --plain`, then deploy exactly once.
* **Apply new SQL yourself** when it lands in `db/schema`, `db/migrations` or `db/seed`:
  `DATABASE_URL="$(netlify env:get DATABASE_URL --context production)" node db/migrate.mjs`
* **Never print a secret value back to me.** Confirm by name only.

### Ask me first — these three only

1. Anything that **deletes data**.
2. Anything that **repoints `DATABASE_URL`** at a different database.
3. Anything that turns on **`INNGEST_EVENT_KEY`** — that switch makes 47 workflow functions go live.

### Egress

`api.netlify.com` and `api.supabase.com` are blocked by the network policy in the hosted agent environment. Both CLIs fail with a 403 at `CONNECT` before any request is sent. A 403 from the proxy is an org policy denial: report the blocked host, do not retry or route around it.

## 12. Traps in this repo

These have already cost time. Read them before you trust a green result.

* **`npm test`'s glob is `src/**` and `scripts/**` only.** A test placed under `api/` silently never runs. Endpoint tests live at `src/http/<name>.pg.test.mjs` and import the `api/` handler.
* **The suite is not as green as it looks.** With `DATABASE_URL` unset, **442** `.pg.test.mjs` tests skip and the suite reports **3730 passing, 0 failing** — measured 2026-08-01 on this branch. That number is real but partial: it proves nothing about anything that needs a database.

  Against a real Postgres there are pre-existing failures, and **the recorded count has never been stable**: 24 and 29 were recorded against one environment, 45 against a local Postgres 16.13 on `main` at `e67e2db` (2026-07-31). Do not trust any of these three as *the* number. Measure it yourself, and **record where you ran it** — the environment demonstrably moves the count.

  What changed on 2026-08-01: the bulk of those failures are multi-tenant isolation tests, and they were failing because the connection role was a Postgres superuser, which bypasses row-level security entirely. `db/migrations/104_app_role.sql` fixes that by giving the app an unprivileged `fundhub_app` role. **So the historic counts above are now expected to be wrong in the good direction, and nobody has yet measured the new one.** The measurement runs on every push — see the "Partner isolation, as the unprivileged app role" step in `.github/workflows/tests.yml`. Read that step's result before quoting any failure count in this file.

  Either way: diff against the baseline commit before concluding you broke something.
* **A handler file is not a route.** `netlify/functions/api.mjs` holds a hardcoded `ROUTES` map; a handler absent from it 404s locally and deployed. This has shipped twice. `src/http/routes.test.mjs` now fails if a handler is neither routed nor on an explicit allow-list — keep it passing.
* **`requireAuth` ignores a `roles` key.** It forwards `opts` to `authenticate()`, which reads only `db` and `env`. Gate with `requireRole` after it. `src/http/auth-gate.test.mjs` fails on the broken shape.
* **Editing an applied migration is a silent no-op.** `migrate.mjs` records each file in `schema_migrations` keyed `<dir>/<file>`. Supersede it with a new file instead.
* **Money is integer cents** via `src/commissions/money.mjs`. `fromCents` returns a string; `percentOf` takes percent units (`10` = 10%). NULL means unknown and must survive — never default it to 0.
* **Outbound transmission is permitted in `src/messaging/providers/*` and nowhere else.** That directory is the only place new outbound `fetch` may be added. `src/lib/`, `src/handlers/` and `src/mail/` contain none, and none may be added to them.

  One call site predates this rule and is an exception, not precedent — do not cite it to justify a second: `src/adapters/lendflow.mjs` (submits an application). `src/workflows/ds-02-diy-letters.mjs` and `src/workflows/c-06-crs-results-router.mjs` no longer POST to the old letter-delivery URL — both now build PDFs in-repo and send through `src/messaging/providers/resend.mjs`, so neither needs a raw-fetch exception anymore. Anything new that transmits belongs behind a provider module.

  `sendTemplated` still only writes `messages` rows with `status='queued'`. Handing those rows to a provider is the dispatcher's job (`src/messaging/dispatch.mjs`), and nothing schedules the dispatcher yet — see `src/workflows/message-dispatch-sweeper.mjs`, which is defined and deliberately not registered.
* **`src/mail/` mails nothing, deliberately.** No scheduler, no send path, no activation flag. Prescreen data needs a firm offer of credit under FCRA; nothing drops until the FCRA report is in, Deluxe compliance reviews the piece, and a lawyer signs off on the broker/lender-of-record structure. The build is not gated — the drop is.
