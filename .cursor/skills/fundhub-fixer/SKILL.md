---
name: fundhub-fixer
description: >-
  Named Fundhub repair only — smallest diff for what Chris asked, then prove
  it. Use when Chris says fix, ship, repair, wire, "make X work", or unblock.
  Enforces owner-scope-minimal-diff, live Playwright 100/100, and human click
  before claiming done. Never audits-and-fixes in one pass; never weakens tests.
---

# Fundhub Fixer

You change **only** what Chris named. Then you prove it.

Auditing is a separate task (`fundhub-auditor`). If he has not named the fix,
do not invent one — ask one question or send him to Auditor first.

## Prime rules

1. **Only what he named.** See `.cursor/rules/owner-scope-minimal-diff.mdc`. One field / one line of copy is the default. No drive-by renames, refactors, dep bumps, or "while I was in there."
2. **Unnamed file / new route / new field / new dependency** → stop. Ask one question. Wait. Do not ask and edit in the same turn.
3. **Stuck rule.** Two failed attempts at the same fix → stop. Report what you tried, what happened, and your best guess. Do not try a third time by rewriting surrounding code.
4. **Never weaken, skip, or delete a test** to get green. Never edit a baseline or hook to turn red into green.
5. **Never put a live production integration into demo / mock / sandbox mode.** Unit-test fake `fetchImpl` / fake env inside `src/**` tests is fine. Leaving Resend, webhooks, payments, or messaging in demo mode is not.
6. **Fake e2e emails only:** `e2e+aff-*@`, `e2e+wl-*@`. Outbound prove sends: Chris / prove addresses only. Never print passwords. Never ask him to paste a key that is already in `.env` or Netlify.

## Before you write code

1. Read the files you will touch (symbol search first).
2. Read the relevant `docs/journeys/*-intended.md` if you are changing a user flow. If code needs a step not in intended — **stop and ask**. Do not edit the intended file to match your code.
3. Plain-English plan: files, journeys, how you will verify. If the request was already a clear one-line fix, the plan can be one sentence — then build.

## Prove path (required before "done")

**Prove** = reproduce the board finding's exact check and write evidence (screenshot + response) to the evidence folder; update the board row. Chat claims of success count for nothing.

Order matters. Do not skip.

1. `npm run lint` and the relevant unit tests green (`npm test` / targeted `node --test`).
2. Live Playwright against the deployed site until **100/100** — `.cursor/rules/live-playwright-100-before-manual.mdc`. Prefer `npm run test:e2e:live`. Fix and re-run; do not dump a long failure list and stop.
3. Human click path on `https://fundhub.ai` (or the page he named) — `.cursor/rules/test-means-human-click.mdc`. A green script alone is not a UI test.
4. Chris does **exactly one** manual pass after that.
5. If a journey changed: update `docs/journeys/*-actual.md` in the same commit as the code, append `docs/journeys/CHANGELOG.md`. Write the change manifest to the batch board under `docs/workflows/`.

## Deploy

- Only when he asked to ship/deploy, or the named task needs live proof and going live was already approved.
- New env vars: set them yourself (secret when needed), **batch**, then **one** deploy. Never deploy-per-variable.
- Never print secret values. Confirm by name only.

## Outbound / compliance

- New outbound `fetch` only behind `src/messaging/providers/*` (CLAUDE.md §12).
- Flag `COMPLIANCE REVIEW REQUIRED` for dispute logic, credit-repair messaging, fee timing, refunds, payment rails, consent, or credit-pull type.

## Done report (plain language)

1. What changed — one line
2. What Chris should check — one or two human steps
3. Risk — one line, or "none"
4. Left undone — or "nothing"
5. Next — single next action

## Never

- Audit-and-fix in one pass
- Scope creep past roughly double the plan without re-asking
- Inventing ground truth or journey steps
- Rotating keys unless the exact key is proven broken right now
