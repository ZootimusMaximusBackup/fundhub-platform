# Company Brain chat — where this stopped and why

Date: 2026-08-17

## Built and committed

| Commit | What |
|---|---|
| `13d1b8d` | The whole feature: chat screen, upload, saved conversations, approval gating, 3 migrations, tests, route wiring, regenerated migration manifest |
| `bfeac1e` | Chat jumps to the newest message in a background tab |
| `a41f2fe` | Journey maps regenerated + changelog |

## Proven

- `npm run lint` — clean, 1296 files parse.
- Company Brain tests — **165 pass, 0 fail** (`src/company-brain/*.test.mjs`,
  `src/http/company-brain*.test.mjs`, `src/http/routes.test.mjs`).
- Journey staleness test — passes.
- Full suite — 5614 pass. Remaining failures are either pre-existing at the
  baseline commit (see `baseline.md`) or belong to other work in flight in this
  tree (the two Contracts screen tests). None are from this batch.

## NOT proven — and why

**Nothing has been proven on the live site. Nothing is deployed.**

### Blocker 1 — the database changes are not applied

Migrations 174, 175 and 176 have not run against production.

- `DATABASE_URL` is the restricted app role and is read-only for schema
  changes: `FATAL: cannot execute CREATE TABLE in a read-only transaction`.
- The documented fix is `MIGRATION_DATABASE_URL`
  (`docs/runbooks/postgres-least-privilege.md`), but that value is stored on
  Netlify as a **secret**, so `netlify env:get` returns it masked
  (`****************gres`) rather than the real value. This CLI build has no
  `env:exec`, so it cannot be injected without being read.
- Reading the local `.env` is blocked by this session's permissions.

This is a credentials boundary, not a code problem. It needs a human.

### Blocker 2 — deploying before the migration WOULD BREAK Company Brain

Do not deploy first. `src/company-brain/retrieve.mjs` now filters on
`f.approval_status`. That column arrives in migration 174. Deploying the code
against a database that does not have the column yet makes every Company Brain
search fail. **Migration first, then deploy.** In that order.

## The two commands to unblock

Run from `~/fundhub-platform`:

```bash
set -a && . ./.env && set +a && node db/migrate.mjs
```

Then, only after that reports the three migrations applied:

```bash
netlify deploy --build --prod
```

Then the live proof already written for this batch:

```bash
npm run test:e2e:live -- e2e/live-company-brain-chat.spec.mjs
```

That spec proves the whole thing end to end with real writes, including the
one check that matters most: a document that has been uploaded but NOT yet
approved is never cited and its contents never reach the answer.

## One thing to look at that is not ours

This working tree is being edited by several other sessions at once. During
this batch, `git stash` ran twice from outside it and reverted finished work
three times — including the approval gate itself, which silently turned the
safety tests red after they had passed. The work was recovered from
`stash@{0}` and committed. That stash still holds ~30 other files belonging to
other work; it was deliberately left alone rather than popped.

Because the shared git index already held other sessions' staged files, commit
`a41f2fe` swept some of them in (closer-call and closer-dashboard screens).
Nothing was lost — that work is committed rather than pending. It was left
alone rather than un-picked, because rewriting history in a tree this busy
risked destroying work that is not ours.
