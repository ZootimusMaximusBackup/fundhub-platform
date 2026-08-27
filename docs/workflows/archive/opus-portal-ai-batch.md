# Opus portal + AI batch — 2026-08-16

Owner: Chris. Decision: **Claude (ANTHROPIC_API_KEY) is the one API for all
conversation / completion work.** Approved 2026-08-16.

## Tasks

| ID | Owner | Status | Notes |
|----|-------|--------|-------|
| W1 | main thread | done | Ship pre-qual amount in client portal |
| W2 | agent: ai-claude | done | Company Brain synthesize + classify → Claude via callModel |
| W3 | main thread | done | Portal chat AI replies; staff Ask on Claude |
| W4 | agent: scope-rule | done | `.cursor/rules` minimal-diff rule, no code changes |

## Context brief

Pre-qual (W1), coded locally, not deployed:

- `api/read/portal-summary.mjs` — new client-safe read
- `src/http/portal-prequal.mjs` — field precedence + formatting
- `src/http/portal-prequal.test.mjs`
- `public/app/client-portal.html` — `sb-prequal-row` / `sb-prequal-amt`
- `public/app/data.js` — `portalSummary`
- `netlify/functions/api.mjs` — route `read/portal-summary`

AI as of the start of this batch:

| Surface | Backend today |
|---------|---------------|
| `src/agents/model.mjs` `callModel` | Claude (Anthropic Messages API) |
| `src/company-brain/answer.mjs` synthesize | OpenAI chat completions |
| `src/company-brain/classify.mjs` | OpenAI chat completions |
| `src/company-brain/embed.mjs` | OpenAI embeddings (`text-embedding-3-small`, 1536 dims) |
| `api/chat/ask.mjs` mode=system | rule-based `src/chat/platform-help.mjs` |
| `api/chat/portal-message.mjs` | stores a message for staff, **no AI reply** |

**Embeddings decision (owner-set):** completions move to Claude. Anthropic has
no embeddings API, so `embed.mjs` stays on OpenAI. Stored vectors are 1536-dim
and re-indexing is not in scope for this batch.

## Guardrails for every workflow

- Only change what the task names. No drive-by refactors.
- Test email targets: `stanbridgejchris@gmail.com` / prove client
  `9af65808-a619-4e65-ae91-239766a006b7` only. Never a real client.
- Batch env vars, then deploy exactly once.
- Credit repair dashboard is BACKLOG. Do not build it.

## Manifests

(written by each workflow on completion)

### W2 — Company Brain completions → Claude (done 2026-08-16)

Both Company Brain completion calls now go through `callModel` in
`src/agents/model.mjs`. No second Anthropic client was written. `embed.mjs`
untouched and still on OpenAI.

Files changed:

- `src/company-brain/answer.mjs` — `synthesizeAnswer()` calls `callModel`
  instead of OpenAI chat completions. Key gate is now `ANTHROPIC_API_KEY`.
  Fallback string no longer names OpenAI.
- `src/company-brain/classify.mjs` — `classifyWithModel()` calls `callModel`.
  Added a local `extractJsonObject()` because Claude has no JSON response mode.
- `src/company-brain/embed.mjs` — header comment only: embeddings stay on OpenAI.
- `src/company-brain/answer.test.mjs` — new, 7 tests, fake Anthropic fetch.
- `src/company-brain/classify.test.mjs` — added 7 Claude-path tests.
- `src/lib/no-unfenced-transmit.test.mjs` — `INTERNAL_CALLERS` shrank to
  `embed.mjs` only; the other two no longer declare a fence.

Signatures and return shapes unchanged. No caller edits needed:
`api/chat/ask.mjs`, `api/read/company-brain.mjs`,
`api/read/company-brain-affiliate.mjs` all still pass `{ query, chunks, env,
fetchImpl }` and read `{ ok, text, thin, source, citations }`.

Env: dropped reads of `COMPANY_BRAIN_ANSWER_MODEL`, `COMPANY_BRAIN_CLASSIFY_MODEL`,
`COMPANY_BRAIN_OPENAI_API_KEY` (for completions only), and `OPENAI_API_BASE`
(for completions only). Nothing else in the repo or docs referenced the two model
vars. Model now comes from `DEFAULT_MODEL` in `model.mjs` — deliberate, since the
old values were OpenAI model names Anthropic would reject.

Behavior note: the old OpenAI calls had 45s / 30s timeouts. `callModel` has no
timeout param; none was added to keep the diff minimal.

Verify: `node --test` on the three touched test files — 32/32 pass.
`npm run lint` — clean, 1223 files. `npm test` — 5433 pass, 2 fail, both
pre-existing and outside W2: `every read endpoint scopes to the caller's company`
(names `portal-contracts.mjs`, a W1/W3 file) and `the journeys are not stale`
(the five `-actual.md` pages already edited locally by W1).

### W1 + W3 — portal pre-qual, portal chat AI, staff Ask on Claude (done 2026-08-16)

**Finding that changed the plan.** There is no `OPENAI_API_KEY` on Netlify (any
context) or in local `.env`, and `brain_files` / `brain_chunks` in production are
**both 0 rows**. Company Brain has never had a document synced from Drive, and its
retrieval needs embeddings. So "Knowledge" mode could not answer regardless of
which model writes the prose. Building a keyword-search fallback over an empty
table was rejected as work with no user-visible result. The chat surface that
*could* be made to work today is the staff **Ask** tab plus the **client portal**
chat, and that is what shipped.

Files changed:

- `src/http/portal-prequal.mjs` (new) — pre-qual field precedence + `$` formatting
- `api/read/portal-summary.mjs` (new) — client-safe read, binds `org_id = $2`
- `public/app/client-portal.html` — `sb-prequal-row` / `sb-prequal-amt`; the
  before-call line becomes "You're pre-qualified for approximately $X"
- `public/app/data.js` — `portalSummary()`
- `netlify/functions/api.mjs` — route `read/portal-summary`
- `src/chat/portal-assistant.mjs` (new) — client-facing Claude assistant. Context
  is built from that client's own row only. Hard rules in the system prompt: no
  promised amounts, no guaranteed approvals or deletions, no legal advice, no
  dollar figure that is not on the file, escalate anything upset or urgent.
- `api/chat/portal-message.mjs` — stores the client message (unchanged), then adds
  a Claude reply. Reply is written `status='delivered', provider='internal',
  sender_kind='agent'` — deliberately NOT `'queued'`, because
  `src/messaging/dispatch.mjs` claims outbound rows with `status='queued'` and
  would have texted the client a second copy.
- `public/app/chat-widget.js` — portal branch renders `res.reply.text`
- `src/chat/staff-assistant.mjs` (new) — Ask tab answered by Claude, grounded on
  the `platform-help.mjs` corpus. Citations still come from the deterministic
  keyword ranker, never from the model, so a link can't point at a screen that
  does not exist.
- `src/chat/platform-help.mjs` — added `platformHelpCorpus()` (returns copies)
- `api/chat/ask.mjs` — system mode routes through `answerStaffQuestion`
- `api/read/portal-contracts.mjs` — added an explicit client-in-org check
- Tests: `src/http/portal-prequal.test.mjs`, `src/chat/portal-assistant.test.mjs`,
  `src/chat/staff-assistant.test.mjs` (30 tests total)
- Journeys regenerated (`npm run journeys`), `docs/journeys/CHANGELOG.md` appended

Every model path degrades instead of failing: no key or an Anthropic error gives
the client "your message is saved and your advisor will see it", and gives staff
the old keyword answer. The shadow-mode debug string can never reach a client.

Two suite failures were fixed rather than excused: `portal-contracts.mjs` now
carries a visible `org_id = $2` tenancy check, and the journeys were regenerated.

Verify: `npm run lint` clean (1225 files). `npm test` — **5444 pass, 0 fail,
3 skipped**. `npx tsc --noEmit` is a no-op in this repo (no tsconfig; it prints
compiler help).

- **W4 (scope-rule) — done.** Added `.cursor/rules/owner-scope-minimal-diff.mdc`
  (`alwaysApply: true`): agents change only what Chris named, smallest diff,
  no drive-by renames/refactors/dep bumps/test rewrites; needing an unnamed
  file or adding a route/field/dependency is a stop-and-ask (ask one question,
  do not proceed same turn). Reinforces CLAUDE.md §8. No code, no exports, no
  routes, no journeys touched. Files: `.cursor/rules/owner-scope-minimal-diff.mdc`
  (new), `docs/workflows/opus-portal-ai-batch.md` (status + this manifest).

## Ship record — 2026-08-16

Two production deploys (batched, not per-variable). No new env vars were needed:
`ANTHROPIC_API_KEY` was already set on production.

- `6a8255eb` — pre-qual + portal chat AI + staff Ask on Claude
- `6a825a35` — plain-text fix (the widget escapes HTML, so Claude's Markdown
  asterisks were rendering as literal characters)

**Migration ledger repair.** The first live run scored 25/26: `api:health up
pending0` failed with `pending: 1`. Migration
`169_contract_template_placeholders.sql` had been applied by hand in an earlier
session but never recorded, and `db/migrate.mjs` could not record it because
`DATABASE_URL` is the unprivileged `fundhub_app` role
(`FATAL: permission denied for schema public`), while `MIGRATION_DATABASE_URL`
is masked by the Netlify CLI. All three templates were confirmed present in
`contract_templates`, so the migration's effect was already applied and only the
`schema_migrations` row was missing. That row was inserted. Health returned to
`pending: 0`.

**Live Playwright: 26/26 = 100/100** after both deploys.

**Human walk (headed browser, real clicks), screenshots in
`opus-portal-ai-batch-evidence/`:**

- Portal shows `PRE-QUALIFIED FOR / $50,000` and the before-call line reads
  "Your soft-pull assessment is in. You're pre-qualified for approximately $50,000."
- `GET /api/read/portal-summary` → `200 {"prequal_amount":50000,"prequal_display":"$50,000"}`
- Staff Ask tab answered by Claude in plain text, with ranker-supplied sources
- Portal assistant guardrails exercised against the live Anthropic API: it
  refused "can you guarantee I get approved for 200k", repeated the $50,000 only
  as an estimate, and escalated an angry refund demand to a human without
  attempting to resolve it

## Open findings (not fixed — reported, per CLAUDE.md §2 "never invent")

1. **Nothing in production produces a pre-qual number.** Of 34 clients, exactly
   one carries `analyzer_prequal_amount`, and its value is `0`. No `crs_results`
   row has a non-zero `fundingEstimate`. The portal field is correct and hides
   itself when there is no amount — but it will stay hidden on every real file
   until the analyzer starts sending a real estimate. To make the UI visible for
   the owner, `analyzer_prequal_amount` / `total_funding_estimate` were set to
   `50000` on the **prove client only**
   (`9af65808-a619-4e65-ae91-239766a006b7`). That is demo data and should be
   cleared or left knowingly.
2. **Company Brain Knowledge mode cannot answer anything.** `brain_files` and
   `brain_chunks` are both **0 rows** — no document has ever been synced from
   Drive — and retrieval requires OpenAI embeddings, for which there is no key on
   Netlify or in `.env`. Moving the answer model to Claude does not change this.
   Knowledge needs a Drive sync plus an embeddings key before it can work.
3. **Journey gap.** `client-intended.md` does not describe an AI reply in the
   portal. The owner directed it on 2026-08-16; recorded in
   `docs/journeys/CHANGELOG.md` as a gap rather than silently reconciled, and the
   intended file was not edited.
4. **Not clicked live: the client-side portal chat round trip.** The prove
   client's portal account
   (`stanbridgejchris+prove-funding-acct@gmail.com`) is still `invited`, never
   activated, so there is no client session to log in with. The assistant itself
   was verified against the live model and the HTTP wiring is covered by tests,
   but nobody has typed into the portal chat as a signed-in client.
5. **No timeout on the model call.** The OpenAI paths W2 replaced had 45s / 30s
   timeouts; `callModel` has none and none was added, to keep the diff minimal.

## Not built, deliberately

Credit repair dashboard — owner backlog, unchanged.

