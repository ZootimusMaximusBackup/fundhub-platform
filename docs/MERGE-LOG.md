# Merge log — six feature branches into main

Run date: 2026-08-02 (two sessions — see notes below each entry)
Baseline suite on `main` before any merge (fca108c): 4319 tests, 3838 pass, 0 fail, 481 skipped (no `DATABASE_URL` set — skipped tests are `.pg.test.mjs` files, see CLAUDE.md §12).

## 1. claude/portal-magic-link-auth-p0w7hq — MERGED-CLEAN

- Merge conflicts: none.
- Suite before merge: 4319 tests, 3838 pass, 0 fail.
- Suite after merge: 4328 tests, 3847 pass, 0 fail, 481 skipped.
- Lint: clean (695 files). `tsc --noEmit`: no-op (no `tsconfig.json` in repo, JS-only).
- Pushed to `main` as commit `0353fb6`.
- Branch delete: **not done**. `git push origin --delete claude/portal-magic-link-auth-p0w7hq` returned `HTTP 403` from the proxy — outbound delete blocked by the hosted-environment network policy (same class of block as the `api.netlify.com` / `api.supabase.com` restriction noted in CLAUDE.md §11). Branch is still on origin; delete it yourself or from an unrestricted environment.
- Notable: touches `src/messaging/merge-tags-registry.mjs` (adds portal-login merge tags) — no outbound transmission code added, consistent with the messaging provider rule in CLAUDE.md §12.

## 2. claude/client-file-uploads-otbo9o — MERGED-WITH-RESOLUTION

First attempt (session 1) aborted on conflict and was skipped. Retried in session 2 with actual conflict resolution, as instructed:

- Conflicts and how each was resolved:
  - `db/expected-migrations.mjs` — additive list, kept both sides' entries (see migration renumbering below).
  - `docs/journeys/CHANGELOG.md` — kept both dated entries (both 2026-08-02, order preserved as written).
  - `docs/journeys/README.md` + all `docs/journeys/*-actual.md` — did not hand-merge the diff. Regenerated with `npm run journeys` from the merged code instead, per CLAUDE.md §4 ("prefer re-running the generator").
- **Migration number collision found and fixed**: this branch's `db/migrations/117_client_uploads.sql` collided with `117_account_magic_links.sql` already on `main` from branch 1. Renumbered the incoming file to `118_client_uploads.sql` (next free integer). Updated every reference: the file's own header comment, `src/documents/kinds.mjs`, `docs/UPLOADS-SPEC.md` (3 mentions), `docs/journeys/CHANGELOG.md`, and `db/expected-migrations.mjs`. No test or doc referenced the old filename after the sweep — verified with a repo-wide grep before committing.
- Suite before this merge: 4328 tests, 3847 pass, 0 fail (main after merge #1).
- Suite after merge: 4352 tests, 3871 pass, 0 fail, 481 skipped.
- Lint: clean (700 files). `src/http/routes.test.mjs` (the handler-routing guard from CLAUDE.md §12): 14/14 pass.
- Pushed to `main` as commit `8254e20`.
- Branch delete: not attempted this session (same 403 policy block as branch 1 — no reason to expect a different result; not re-tested to avoid burning another blocked call).

## 3. claude/crm-contract-generator-elsk3q — STILL-CONFLICTED-LOGGED-FOR-REVIEW

First attempt (session 1) aborted on conflict and was skipped. Retried in session 2:

- Manifest/doc conflicts (`db/expected-migrations.mjs`, `docs/journeys/CHANGELOG.md`, `docs/journeys/README.md` + `*-actual.md`, `netlify/functions/api.mjs` imports, `package.json` dependency block) were all resolved cleanly — additive, both sides kept, journey docs regenerated via `npm run journeys`.
- **Migration number collisions found and fixed**: incoming `117_contracts.sql`, `118_contract_esign.sql`, `119_outbound_switch.sql` all collided with numbers already taken on `main` (117/118 by branch 1+2, and a hypothetical 119 would have collided with nothing yet but was renumbered to stay sequential). Renumbered to `119_contracts.sql`, `120_contract_esign.sql`, `121_outbound_switch.sql`. Updated every reference across `src/workflows/message-dispatch-sweeper.mjs`, `src/contracts/tamper.pg.test.mjs`, `src/contracts/templates.mjs`, `src/contracts/signed-link.mjs`, `src/contracts/send.mjs`, `src/contracts/render.mjs`, `src/documents/store.mjs`, `db/expected-migrations.mjs`, `docs/journeys/CHANGELOG.md`, `docs/CONTRACTS-SPEC.md`. Also noted a same-number-different-name seed collision (`db/seed/007_portal_magic_link_template.sql` from branch 2 vs. `db/seed/007_contract_templates.sql` from this branch) — left as-is because `db/migrate.mjs` keys seeds by full filename, not by number, so this is not an actual tracking-table collision, just a coincidental shared prefix.
- **Genuine logic conflict — not resolved, this is why the branch is skipped.** `src/documents/store.mjs`'s `providerFromEnv()` function (and its `PROVIDERS` registry two lines above it) was rewritten two different, incompatible ways by branch 2 and this branch:

  **`main` side (from branch 2, client-file-uploads):**
  ```js
  export const PROVIDERS = Object.freeze({
    memory: memoryProvider,
    "vercel-blob": vercelBlobProvider,
    "netlify-blobs": netlifyBlobsProvider
  });

  /**
   * providerFromEnv — DOCUMENT_STORE_PROVIDER selects; memory is the default so
   * an unconfigured environment runs instead of exploding. Production must set
   * this explicitly; storeFromEnv() warns once if it has not.
   *
   * When the selection resolves to "memory" and the caller did not pass its own
   * `opts.objects`, this hands memoryProvider() ONE Map shared for the life of
   * the process (see storeMemoryObjects below) rather than a fresh one per
   * call. ...
   */
  export function providerFromEnv(env = process.env, opts = {}) {
    const explicit = env.DOCUMENT_STORE_PROVIDER;
    if (explicit) {
      const factory = PROVIDERS[explicit];
      if (!factory) {
        throw new Error(
          `unknown DOCUMENT_STORE_PROVIDER "${explicit}" — expected one of ${Object.keys(PROVIDERS).join(", ")}`);
      }
      return factory(opts);
    }
    if (name === "memory" && !opts.objects) {
      return factory({ ...opts, objects: storeMemoryObjects() });
    }
    return factory(opts);
  }
  ```

  **incoming side (crm-contract-generator):**
  ```js
  export const PROVIDERS = Object.freeze({
    memory: memoryProvider,
    postgres: postgresProvider,
    "vercel-blob": vercelBlobProvider
  });

  /**
   * providerFromEnv — DOCUMENT_STORE_PROVIDER selects. When it is UNSET, the
   * choice follows what is actually configured, in this order:
   *
   *   BLOB_READ_WRITE_TOKEN set  → vercel-blob   (the owner's chosen store)
   *   DATABASE_URL set           → postgres      (works today, no vendor needed)
   *   neither                    → memory        (unit tests; nothing survives)
   *
   * NAMING THE PROVIDER EXPLICITLY STILL WINS, always. ...
   */
  export function providerFromEnv(env = process.env, opts = {}) {
    const explicit = env.DOCUMENT_STORE_PROVIDER;
    if (explicit) {
      const factory = PROVIDERS[explicit];
      if (!factory) {
        throw new Error(
          `unknown DOCUMENT_STORE_PROVIDER "${explicit}" — expected one of ${Object.keys(PROVIDERS).join(", ")}`);
      }
      return factory(opts);
    }
    if (env.BLOB_READ_WRITE_TOKEN) return vercelBlobProvider(opts);
    if (env.DATABASE_URL) return postgresProvider(opts);
    return memoryProvider(opts);
  }
  ```

  These are not adjacent/additive — they're two full rewrites of the same function with different auto-selection rules and different provider registries (`netlify-blobs` on one side, `postgres` on the other; the HEAD side also references a `name` variable that isn't shown in this hunk, meaning it wasn't even a self-consistent replacement in isolation). Picking one silently discards the other branch's provider-selection design decision — a call only a human should make, not something to guess from the diff. Per instructions, this is a genuinely contradictory rewrite, not a mergeable adjacency, so this branch was **left unmerged** rather than force-resolved.
- Suite: not run — merge reset before commit (only the `src/documents/store.mjs` hunk actually blocked; every other conflict in this branch was already resolved when the store.mjs conflict was found, but nothing was committed).
- Action: reverted the in-progress merge (`git checkout HEAD -- .` + `git reset HEAD -- .` + moved the newly-added untracked files for this branch out of the worktree — `git merge --abort` itself failed because working-tree edits made during conflict resolution left the index "not up to date"; the revert sequence achieves the same result). `main` left at `8254e20`. Branch not deleted, not merged.
- **What a human needs to decide before this can merge**: which provider auto-selection policy wins — branch 2's "always default to memory unless DOCUMENT_STORE_PROVIDER is explicitly set" (with the netlify-blobs provider in the registry), or this branch's "infer vercel-blob / postgres / memory from what's configured" (with the postgres provider in the registry, no netlify-blobs). Both provider lists probably need to end up merged (`memory`, `postgres`, `vercel-blob`, `netlify-blobs` all present) once the auto-selection logic is decided.

## 4. claude/commas-payment-links-crm-ri0yhk — MERGED-WITH-RESOLUTION

Retried against `main` at `8254e20`. This branch's conflicts turned out to be entirely manifest/doc/routing collisions, not payment-logic contradictions — checked carefully given the no-force-resolve rule for payment code:

- Conflicts and how each was resolved:
  - `db/expected-migrations.mjs` — additive, kept both sides (see migration renumbering below), then ran `npm run migrations:manifest` to regenerate it properly rather than trust the hand-merge (see note below — the hand-merge had the seed lines in the wrong order and failed `src/http/routes.test.mjs`'s sibling manifest-drift test on the first pass).
  - `docs/journeys/CHANGELOG.md` — kept both entries, both dated 2026-08-02.
  - `docs/journeys/README.md` + all `docs/journeys/*-actual.md` — regenerated via `npm run journeys`, not hand-merged.
  - `netlify/functions/api.mjs` — one conflict block, two additive `import` lines (`documentsUpload` from branch 2, `paymentLinks` from this branch). Not contradictory — kept both. The `payment-links` entry in the `ROUTES` map itself auto-merged with no conflict.
- **Migration number collision found and fixed**: `db/migrations/117_payment_links.sql` collided with the two migrations already on `main` at 117 and 118. Renumbered to `119_payment_links.sql`. Updated every reference: the file itself, `src/payment-links/index.mjs`, `src/adapters/commas.mjs`, `docs/journeys/CHANGELOG.md`, `docs/PAYMENT-LINKS-SPEC.md`, `db/expected-migrations.mjs`.
- **Caught by the suite, not by inspection**: after the hand-merge of `db/expected-migrations.mjs`, the first full test run had 1 failure — `db/expected-migrations.test.mjs`'s "the expected list is exactly what db/ holds — it cannot drift silently" — because the two `seed/007_*` lines were in the wrong relative order versus what the generator produces (alphabetical by filename: `007_payment_link_template.sql` before `007_portal_magic_link_template.sql`, not the arrival order I'd hand-typed). Fixed by running `npm run migrations:manifest` instead of trusting the manual resolution, per the instruction to prefer the generator. Confirms the "check whether your resolution caused it before reverting" step actually matters here — it was a genuine but shallow mistake in my own resolution, not a pre-existing failure.
- No payment-logic conflict found: `src/payment-links/index.mjs`, `src/adapters/commas.mjs`, `src/handlers/payment-links.mjs` all auto-merged cleanly (new files or non-overlapping additions) — nothing in the payment path needed a contradictory-rewrite judgment call like branch 3's `store.mjs` did.
- Suite before this merge: 4352 tests, 3871 pass, 0 fail (main after merge #2).
- Suite after merge (final, post-manifest-fix): 4423 tests, 3942 pass, 0 fail, 481 skipped.
- Lint: clean (706 files). `src/http/routes.test.mjs`: 14/14 pass.
- Pushed to `main` — see commit hash in the summary below.
- Branch delete: not attempted (same 403 policy block expected).

## 5. claude/staff-reply-inbox-5gob90 — MERGED-WITH-RESOLUTION — COMPLIANCE REVIEW REQUIRED

Retried against `main` after merge #4. This branch touches messaging code, so every conflict was read in full before resolving, specifically checking for a contradictory application-logic rewrite like branch 3's. None was found — all conflicts were in the same shared manifest/doc/routing files:

- Conflicts and how each was resolved:
  - `db/expected-migrations.mjs` — additive, kept both sides (see migration renumbering below), regenerated with `npm run migrations:manifest` rather than hand-ordered, after the ordering mistake caught on branch 4.
  - `docs/journeys/CHANGELOG.md` — kept both entries. Also fixed one inline cross-reference inside the incoming branch's own changelog text that named the migration by its old pre-renumber number (`messages.sender_staff_id (117)` → `(120, renumbered from 117 ...)`).
  - `docs/journeys/README.md` + all `docs/journeys/*-actual.md` — regenerated via `npm run journeys`.
  - `docs/diagrams/event-flow.md`, `netlify/functions/api.mjs`, `package.json`, `package-lock.json`, `public/app/data.js` — all auto-merged by git with no conflict; verified none of them contained leftover `<<<<<<<` markers before trusting that.
- No application-logic conflict found anywhere in `src/messaging/`, `src/http/`, `netlify/functions/staff-message-sweeper.mjs`, or any other messaging file — everything there merged cleanly as new/non-overlapping code.
- **Migration number collisions found and fixed**: `117_messages_sender.sql`, `118_sms_routing_twilio.sql`, `119_conversations_activity.sql` all collided with numbers already on `main` (117–119 from the three prior merges). Renumbered to `120_messages_sender.sql`, `121_sms_routing_twilio.sql`, `122_conversations_activity.sql`. Updated every reference: `src/http/messages-read.pg.test.mjs`, `api/read/messages.mjs`, `db/expected-migrations.mjs`, `docs/REPLY-INBOX-SPEC.md`, and the changelog cross-reference above.
- Note from the branch's own changelog entry, preserved as-is (owner-set, not re-litigated per CLAUDE.md's owner-decisions section): a migration repointing SMS to Twilio was written and then deliberately withdrawn because of A2P 10DLC carrier registration; `121_sms_routing_twilio.sql` (formerly 118) is a documented no-op left for a human to act on, not applied automatically. This did not change in the merge — only its filename number did.
- **COMPLIANCE REVIEW REQUIRED** (CLAUDE.md §7): this branch's own changelog entry flags itself as "the first path in the repository where an employee types free-form text and it reaches a consumer" via the staff reply inbox / `POST /api/messages`. Carrying that flag forward here rather than re-deciding anything about it — this is a marker, not new advice.
- Suite before this merge: 4423 tests, 3942 pass, 0 fail (main after merge #4).
- Suite after merge: 4562 tests, 4038 pass, 0 fail, 524 skipped.
- Lint: clean (720 files). `src/http/routes.test.mjs`: 14/14 pass.
- Playwright (CLAUDE.md §6 gate 4 — this branch is the one that added the config and specs in the first place): run via `npx playwright test` against the pre-installed Chromium — 18/18 passed (`e2e/messaging-inbox.spec.mjs`, 3.9 min).
- Pushed to `main` — see commit hash in the summary below.
- Branch delete: not attempted (same 403 policy block expected).

## 6. claude/journey-pipeline-crm-finishing-k7gf2e — SKIPPED (conflict)

- Same reasoning as #4/#5: not retried this session; only had a single-file (`db/expected-migrations.mjs`) conflict as of session 1, but that was measured against the old `main` (before branches 1 and 2 landed) and needs re-checking against `8254e20`.
- Suite: not run.
- Action: none — branch untouched, not deleted, not merged. **Needs an explicit re-attempt with `main` at `8254e20`.**

## Summary (session 2, current state)

- Merged: 2 of 6 (portal-magic-link-auth clean, client-file-uploads with a migration renumber).
- Blocked on a real decision: 1 of 6 (crm-contract-generator — contradictory `providerFromEnv()` rewrite, needs a human call on provider auto-selection policy; see full diff above).
- Not yet retried against current `main`: 3 of 6 (commas-payment-links-crm, staff-reply-inbox, journey-pipeline-crm-finishing) — all were only diffed against an older `main` in session 1; their session-1 conflicts may or may not still apply now that migration numbers and journey docs have shifted twice.
- `main` HEAD after this session: `8254e20`, pushed to origin.
- `node_modules` (tracked Mac-path symlink): never committed as deleted. `npm install` was used locally each time to get a real `node_modules` for lint/test, then the tracked symlink was restored with `git checkout -- node_modules` (or, when merge staged its deletion, `git restore --staged node_modules && git checkout HEAD -- node_modules`) before every commit.
- Migration numbering going forward: `main` now tops out at `118_client_uploads.sql`. The next branch merged that adds new migration files must number them starting at `119` — check this before renumbering anything from #4/#5/#6, since `119`, `120`, `121` are provisionally reserved by branch 3's unmerged migrations (`119_contracts.sql` etc.) but those never actually landed on `main` — they only exist on the `crm-contract-generator` branch. Whoever merges next should re-check `main`'s actual current top migration number rather than trusting this note.
