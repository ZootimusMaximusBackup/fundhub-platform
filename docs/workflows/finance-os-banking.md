# finance-os-banking

Shared board for the Finance OS banking batch — W5 (bank linking), W6
(liabilities/cards), W7 (transactions), W8 (projections/reminders).

Each workflow claims its task here, writes its manifest here when done, and reads
this file before starting. Append your own `## W<n>` heading below rather than
editing anyone else's.

---

## W5 — Plaid bank linking

**Task:** migrations 080–082, `src/adapters/plaid.mjs`, `src/banking/`,
`api/banking/plaid.mjs`. `status: done`

**What changed, in plain language:** a member of staff can now connect a client's
bank account through Plaid Link and see the balances. The key that reads the bank
is scrambled before it is saved, so nobody can read it out of the database. Every
time anyone looks at a client's bank data, the system writes down who looked and
when. Each account is marked as personal, business, or **unknown** — and unknown
stays unknown until a person says otherwise, because Plaid does not tell us.

### Decisions made (nobody was asked — this run was set to decide and keep going)

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Branch name | Stayed on `claude/plaid-bank-linking-my2j8w` | Two later instructions named different branches (`claude/bank-plaid-link`, `<workflow>-w5`). The environment's designated branch wins; pushing elsewhere needs explicit permission. |
| 2 | `PLAID_ENV` values | `sandbox` and `production` only. Anything else refuses. | Plaid retired `development`. Accepting it means either a dead hostname or silently serving sandbox data in production. |
| 3 | Currency column | Two columns, `iso_currency_code` and `unofficial_currency_code` | Plaid returns exactly one of the two. Collapsing them into one `currency` column would require deciding which wins — a decision nobody made. |
| 4 | Balance that Plaid did not send | `NULL`, never `0` | Unknown ≠ empty. A zero would tell a funding advisor a client has no money. `toCents()` returns 0 for null, so `centsOrNull()` exists specifically to not use it here. |
| 5 | Balance Plaid sent that we cannot parse | Throw, audit the error, mark the item | A value we cannot read is a provider change or a mapping bug. Silently storing "unknown" hides it forever. |
| 6 | Plaid returns **zero** accounts | Mark nothing closed; record it in the audit summary | Closing everything is the right reading of "the client removed them all" and the wrong reading of a blip, and the two are indistinguishable. Marking nothing is recoverable. |
| 7 | `entity_kind` sources | `unclassified` and `staff` only — no `plaid` | Plaid does not know whose money it is. A `plaid` source would legitimise a guess. |
| 8 | Which business, when known | `business_id uuid REFERENCES businesses(id)` | `businesses` already exists in `001_init.sql`. No new table invented. |
| 9 | Who may use the endpoint | `owner`, `admin`, `funding_advisor` | Narrower than `ROLE_SETS.STAFF` on purpose — a setter or closer has no reason to see a client's chequing balance. Same reasoning as `/api/pii`'s narrower gate. |
| 10 | Client-facing linking | **Not built.** Staff-only for now. | The real flow is the client opening Plaid Link themselves. W5's fence excludes UI, and a client-facing write path with no screen to exercise it is a hole nobody watches. |
| 11 | Plaid SDK | **Not added.** Plain `fetch` against the REST API. | Dependencies stay `pg` + `inngest`. Two endpoints do not justify an SDK. |
| 12 | Naming vs. the second brief | Kept `isPlaidConfigured` / `linkItem` / `fetchAccounts` | The second brief asked for `isPlaidEnabled` / `linkAccount` / `getAccounts`. Same three functions. Adding aliases would be two names for one thing. |
| 13 | Audit summary contents | Account ids, masks, types, and *whether* a balance was present — never a figure | An audit trail is not a second copy of the client's finances. |
| 14 | Commit footer | `Co-Authored-By: Claude Opus 5` | The instruction template said Sonnet 5. This ran on Opus 5, and a commit trailer should be true. |

### Findings — read these

1. **The brief's premise was wrong and the PR says so.** "There is currently NO
   outbound HTTP anywhere in this codebase" is not accurate. `api/inquiry.mjs:60`
   already does `await fetch(...)` to an external inquiry-removal service, and
   `src/adplatforms/_api.mjs:22` calls Meta and TikTok. What *is* true, and what
   the PR claims instead: this is the first outbound call in `src/adapters/`, and
   the first anywhere that carries a credential to a named person's bank account.

2. **`WORKFLOW-AUTONOMY.md` does not exist in this repository.** The second
   instruction set said to read it first. It is not there, on this branch or on
   `main`. The decision rules pasted inline in that message were followed instead.

3. **`docs/journeys/` does not exist.** `CLAUDE.md` §4 describes
   `<name>-intended.md` / `<name>-actual.md` pairs and a
   `docs/journeys/CHANGELOG.md`. Neither the directory nor the changelog is in
   the repo — `docs/` contains only `diagrams/` and `workflows/`. Nothing was
   invented to fill the gap. The generated diagrams under `docs/diagrams/` were
   updated instead, which is the mechanism that actually exists.

4. **The adapter-boundary diagram used to assume every adapter was inbound.**
   Adding the first outbound-only adapter exposed two false edges: an arrow from
   the outside world *into* Plaid, and an arrow from Plaid *into* the event bus
   labelled "—". Both renderers now draw the request leaving, and only draw a bus
   edge for an adapter that actually emits. Every pre-existing adapter emits at
   least one event, so no other diagram row changed.

5. **`npm run lint` and `npx tsc --noEmit` do not exist here.** `CLAUDE.md` §6
   requires both. `package.json` has `migrate`, `artifact`, `diagrams`,
   `diagrams:check` and `test` — no lint script, no TypeScript, no tsconfig. Not
   run, because there is nothing to run.

6. **`node_modules` was absent when this session started.** `npm test` reported
   122 failures that were purely missing `pg` and `inngest`. After `npm ci` the
   clean-`main` baseline is 0 failures. Anyone diffing test totals against an
   earlier note should check this first.

7. **No `/link/token/create`.** A client's browser needs a `link_token` before
   Plaid Link will open, and the brief scoped the adapter to exchange + balances
   only. Until that exists, a `public_token` has to come from somewhere else
   (Plaid's sandbox helper). This is the one thing standing between the endpoint
   and a real client linking a real bank.

8. **Two mutations initially survived**, and both were real test gaps rather than
   false alarms:
   - No test drove the endpoint with Plaid *configured*, so "mirror Plaid's HTTP
     status back to the caller" passed. A Plaid 401 would have told a signed-in
     employee they were logged out. Fixed — five tests added.
   - The `082` default mutation "survived" because editing an applied migration
     is a silent no-op in this repo. Re-run against a fresh database, it is
     caught.

### Compliance

**COMPLIANCE REVIEW REQUIRED — consent capture, and SOC 2.**

- **Consent capture.** Linking a bank is a consent event. `consent_expires_at`
  holds Plaid's expiry when Plaid supplies one; `NULL` means *Plaid did not say*,
  and must never be read as "never expires". Nothing currently warns anyone when
  a consent window closes — `bank.consent_expiring` is proposed in
  `src/banking/PROPOSED-EVENTS.md` and not built.
- **SOC 2.** Handling live bank credentials brings this platform into scope for
  controls it has not been assessed against: key management and rotation for
  `BANK_TOKEN_ENC_KEY`, access review over `plaid_sync_audit`, and a documented
  retention period for bank data. The encryption and the audit trail are built;
  the *programme* around them is not, and that is a human decision.
- **No credential scraping, ever.** Plaid Link only. There is no field in the
  schema and no argument in the adapter that could carry a bank username or
  password, deliberately.

### Files touched

| File | Change |
|---|---|
| `db/migrations/080_plaid_items.sql` | new — `plaid_items` (ciphertext-only token column) + `plaid_sync_audit` (append-only) |
| `db/migrations/081_bank_accounts.sql` | new — one row per account; balances as `bigint` `_cents`; no derived columns; no account numbers |
| `db/migrations/082_bank_account_entity_kind.sql` | new — `entity_kind` personal\|business\|unknown (default `unknown`), `business_id`, classification attribution + 5 CHECK constraints |
| `src/adapters/plaid.mjs` | new — the only outbound Plaid call. Two operations. Refuses when unconfigured, scrubs every secret, injects `fetchImpl` |
| `src/adapters/plaid.test.mjs` | new — 45 tests, network stubbed at the module boundary |
| `src/banking/index.mjs` | new — encrypt-at-rest (AES-256-GCM, client id as AAD), item/account store, audit writer, classification |
| `src/banking/index.test.mjs` | new — 24 tests, no database |
| `src/banking/PROPOSED-EVENTS.md` | new — 4 proposed events. `src/events/canonical.mjs` NOT edited |
| `api/banking/plaid.mjs` | new — GET read, POST link/sync/classify. Role-gated + org-scoped |
| `src/http/banking.pg.test.mjs` | new — 44 tests against real Postgres |
| `netlify/functions/api.mjs` | `banking/plaid` added to `ROUTES` (+ import) |
| `src/http/read-api.mjs` | `redact()`'s forbidden-key net widened: `access_token`, `refresh_token`, `token_enc` |
| `scripts/diagrams/extract.mjs` | `outbound` detection now also matches `globalThis.fetch` |
| `scripts/diagrams/render.mjs` | outbound-only adapters draw the request leaving; only emitting adapters get a bus edge |
| `scripts/diagrams/generate.test.mjs` | adapter count 8 → 9; five assertions added pinning Plaid as outbound-only and emitting nothing |
| `docs/diagrams/{README,event-flow,adapter-boundary}.md` | regenerated |

### Exports added

`src/adapters/plaid.mjs` — `plaidConfig`, `isPlaidConfigured`,
`exchangePublicToken`, `fetchAccounts`, `normalizeAccount`, `normalizeItem`,
`centsOrNull`, `scrub`, `PlaidNotConfiguredError`, `PlaidApiError`. A test pins
this list exactly: an added export is a widened outbound surface and should be a
decision, not a drift.

`src/banking/index.mjs` — `encryptAccessToken`, `decryptAccessToken`, `linkItem`,
`syncItem`, `classifyAccount`, `listItems`, `listAccounts`, `syncHistory`,
`writeSyncAudit`, `ENTITY_KINDS`, `BankingError`.

### Secrets this expects

| Variable | Purpose | Absent means |
|---|---|---|
| `PLAID_CLIENT_ID` | Plaid API client id | bank linking disabled, endpoint answers 503 |
| `PLAID_SECRET` | Plaid API secret | same |
| `PLAID_ENV` | `sandbox` or `production` | same. Any other value also refuses |
| `BANK_TOKEN_ENC_KEY` | 32 bytes, base64. Encrypts the access token at rest | linking refuses **before** the exchange, so no credential is created that cannot be stored |
| `PLAID_TIMEOUT_MS` | optional, default 10000 | default applies; a bad value falls back rather than disabling the timeout |

### What W6 / W7 / W8 need from this

- `plaid_items.id` is the item key. `bank_accounts.plaid_item_id` points at it.
- `bank_accounts.id` is the account key; `bank_accounts.account_id` is Plaid's.
- **Do not add columns to `bank_accounts` for transactions or liabilities.** W6
  and W7 own their own tables keyed on `bank_accounts.id`.
- **Do not write `entity_kind` from anything but `classifyAccount()`.** A sync
  that touches it erases a person's answer.
- The access token is reachable only through `src/banking/index.mjs`. If a later
  workflow needs a Plaid call, add it to `src/adapters/plaid.mjs` — that is where
  the config gate, the timeout and the scrubbing already live.
- Nothing here emits a canonical event. See `src/banking/PROPOSED-EVENTS.md`.

### Verification

```
npm ci                                            (node_modules was absent at session start)
npm test, no DATABASE_URL     1761 pass · 0 fail · 195 skipped   (baseline 1692 · 0 · 195)
npm test, real Postgres       2416 pass · 4 suites failing       (baseline: same 4 suites)
                              failing NAMES diffed, not totals — zero new
migrations                    53 apply clean to an empty DB; re-run applies 0
                              080/081/082 also re-apply as raw SQL with no error
mutation checks               12 run · 12 killed
                              (2 survived on the first pass; both were real gaps, both fixed)
live Plaid calls in tests     0 — every test injects fetchImpl or stubs globalThis.fetch
```

The 4 pre-existing failing suites are `creative generation`, `creative read
endpoints`, `module invariants`, `social, onboarding and metering`. They fail
identically on clean `main`.
