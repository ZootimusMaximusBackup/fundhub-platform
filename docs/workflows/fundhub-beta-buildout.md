# fundhub-beta-buildout

Shared board for the beta buildout batch. Each workflow claims its task here,
writes its manifest here when done, and reads this file before starting.

The UnderwriteIQ workflow created this file. Other workflows should append their
own `## <name>` heading below rather than editing anyone else's section.

## Task list

| # | Owner | Task | Status |
|---|---|---|---|
| UW | `claude/underwrite-iq-lite-integration-cjd5at` | Vendor UnderwriteIQ Lite, adapt fundhub data to it, expose a read endpoint, pin fixtures | **done** |
| F1 | `claude/underwrite-iq-lite-integration-cjd5at` | Close the cross-org read hole in `read/tradelines` and `read/finance-os` | **done** |
| F2 | — | Store the card opening date so funding figures stop defaulting to the $15,000 placeholder | pending |
| F3 | — | Create `docs/journeys/` with `-actual.md` files only, generated from code | pending |

---

## Owner decisions (standing)

Per the **Owner decisions are final** section of `CLAUDE.md`. Recorded as
owner-set, not re-raised.

| Date | Decision |
|---|---|
| 2026-07-31 | **The engine's wording ships as written, blank fields or not.** The "You're approved…" sentence is NOT gated or held back when a client's file is thin. The missing-fields list stays attached so the owner can see what is thin, but it does not suppress the sentence. All UnderwriteIQ wording is owner-approved as written. Beta; owner is the only user. |

`COMPLIANCE REVIEW REQUIRED` stays as a label on qualifying changes — the owner
asked for the marker. The advice attached to it does not.

---

## UW — UnderwriteIQ Lite integration

**Task:** bring in an outside credit-underwriting engine, feed it fundhub's own
stored data, and show an owner both its advice and the numbers behind that
advice. `status: done`

### What changed, in plain language

There is a new page-behind-the-scenes (an "endpoint") that takes one client and
answers: *what does an outside underwriting tool make of this person's credit,
and why?*

It gives back three things:

1. The tool's assessment — scores, utilization, funding figures.
2. The tool's own written advice, word for word. We do not reword it.
3. **The numbers behind each piece of advice**, so you can check the reasoning
   instead of taking a sentence on trust.

And a fourth thing that matters more than the other three:

4. **A list of everything nobody has typed in yet.** When a sentence is leaning
   on a blank field, it says which field is blank and what filling it in would
   change.

### The finding you need to know about

**A client with a credit score and nothing else comes out "approved".**

The outside tool treats a blank as a zero. So if nobody has entered how many
negative marks a client has, the tool reads that as *zero negative marks* — and
zero negative marks is one of the three things it requires to call somebody
approved. It will then print *"You're approved..."* about a person we know
almost nothing about.

We did not change the tool. Changing it would mean we could no longer take
updates from the people who wrote it. Instead the endpoint flags every sentence
that is standing on a blank field and names the field. The pinned test
`FIXTURE 2` locks this behaviour in place so it cannot change without us noticing.

**Second finding: nothing in fundhub records when a credit card was opened.**
The tool only counts a card toward funding if it is at least two years old. With
no opening date, no card ever counts. So every funding figure it produces comes
out as a floor — the least it could be — and for many clients it falls back to a
fixed $15,000 display number that is not a real figure at all. The endpoint says
so on every response. Fixing this needs a new database column, which this
workflow does not own.

### Files added

| File | What it is |
|---|---|
| `src/underwrite/vendor/underwriter.cjs` | Byte-for-byte copy of upstream `api/lite/underwriter.js`. Not edited. |
| `src/underwrite/vendor/suggestions.cjs` | Byte-for-byte copy of upstream `api/lite/suggestions.js`. Not edited. |
| `src/underwrite/engine.mjs` | **The boundary.** The only file that knows the vendored code exists. Records the upstream commit. A future refresh is: copy two files, change one line here, run the tests. |
| `src/underwrite/adapter.mjs` | Turns fundhub's stored cards and credit pulls into the shape the engine wants — and records every field it could not fill. Pure. |
| `src/underwrite/report.mjs` | Ties each sentence back to the numbers that produced it, and stamps every utilization line with the engine that said it. Pure. |
| `src/underwrite/fixtures.test.mjs` | The pinned fixtures — the early warning if the vendored engine ever drifts. 15 tests. |
| `src/underwrite/adapter.test.mjs` | 24 tests on the data mapping, mostly on the two places a factor of 100 could hide. |
| `api/read/underwrite.mjs` | The endpoint. All database reads happen here; everything below it is pure. |
| `src/http/underwrite-read.test.mjs` | 21 endpoint tests against a fake database, no Postgres needed. |

### Files changed

| File | Change |
|---|---|
| `netlify/functions/api.mjs` | Added `read/underwrite` to the hardcoded ROUTES map, with the reason. Without this the endpoint 404s. |

### Upstream provenance

| | |
|---|---|
| Repo | `https://github.com/darwin808/underwrite-iq-lite` |
| Commit | `71656f0fe1083429f52eeb0aa095cce076a6b33c` |
| Files taken | `api/lite/underwriter.js`, `api/lite/suggestions.js` |
| Verified | sha256 match at vendoring time; both files contain no `require`, no `fetch`, no `process.env` |

`parse-report`, `switchboard`, `ai-gatekeeper` and `google-ocr` were **not**
brought over. They need an OpenAI key and upload live PDFs. A test asserts the
two vendored files stay free of network calls.

### Boundaries this respected

* **No migrations.** This workflow owns none and wrote none.
* **`src/alerts/evaluate.mjs` is untouched.** It keeps its four rules and gained
  nothing. The rule was not to have two engines quietly competing, so instead of
  copying anything into it, the endpoint reports **both** utilization readings
  side by side, each labelled with which engine produced it. No new rule was
  added there, so no `079_upsell_triggers` row is needed.
* **The engine's sentences are returned word for word.** No approval claim was
  added on top. A test asserts every sentence in the response is one the engine
  itself produced.
* **Org scoping comes from the session and fails closed.** A session with no org
  is refused before any data query runs.

### Change manifest

* **Exports added:** `src/underwrite/engine.mjs` → `UPSTREAM`, `computeUnderwrite`,
  `normalizeBureau`, `getNumberField`, `buildSuggestions`.
  `src/underwrite/adapter.mjs` → `toBureaus`, `toEngineTradelines`,
  `clientUtilizationPct`, `BUREAUS`.
  `src/underwrite/report.mjs` → `buildReport`, `annotateSuggestions`,
  `SUGGESTION_CATALOGUE`, `DEPENDENCY_FIELDS`, `ENGINES`.
* **Routes added:** `GET /api/read/underwrite?client_id=<uuid>`, gated
  `ROLE_SETS.STAFF`.
* **Props/shape changes:** none to existing modules.
* **Journeys impacted:** none updated — `docs/journeys/` does not exist in this
  repo yet (see Open questions).
* **Reused rather than rebuilt:** `financeOsGrid` (utilization + its
  partial-data accounting), `triMerge` (bureau scores), `fromCents` (money),
  `evaluateUtilization` (fundhub's own reading), `requireAuth` + `requireRole` +
  `isUuid` + `ROLE_SETS` (gating).

### Blockers and open questions

* **`docs/journeys/` does not exist.** `CLAUDE.md` §4 requires updating
  `<name>-actual.md` and appending to `docs/journeys/CHANGELOG.md` in the same
  commit as a code change. Neither the directory nor the changelog is in the
  repo. Creating the whole journey system was outside this task, so nothing was
  written rather than inventing a format. **Needs a decision.**
* **An account-opened date needs storing.** Until then every funding figure this
  endpoint reports is a floor. Needs a migration, which this workflow does not own.
* ~~**Existing cross-org read gap, not fixed here.**~~ **Closed by F1 below.**

---

## F1 — Close the cross-org read hole

**Task:** two existing endpoints let a staff member from one company read another
company's client credit data. `status: done`

### What was wrong, in plain language

Two screens-behind-the-scenes — the card table and the Finance OS grid — checked
**who you are** but never checked **which company you belong to**.

Both asked "is this person staff?" and stopped there. Neither asked "does this
client belong to the same company as the person asking?" So anyone signed in as
staff at any company could pull up any client's credit limits, balances and
interest rates, as long as they knew that client's ID number.

The permission check was real. It was just checking the wrong thing.

This is the same kind of mistake as the `roles` bug already recorded in this
repo: a guard that reads like it is doing something and is not.

### The fix

The lookup that fetches a client's cards now **refuses to run** unless it is told
which company to limit itself to. It throws an error rather than quietly
returning everything.

That matters more than fixing the two callers. If it were just a parameter people
had to remember to pass, the next person would forget it and the hole would come
back. Now it cannot be forgotten — the code stops.

The company is read from the signed-in session, never from the web address. Both
endpoints also turn away any session with no company on it, rather than running
a lookup and hoping it matches nothing.

### Files changed

| File | Change |
|---|---|
| `src/tradelines/store.mjs` | `listTradelines()` now requires `orgId` and throws without it. Query filters on `org_id` as well as `client_id`. |
| `api/read/tradelines.mjs` | Reads `staff.org_id` from the session, refuses a session without one (403), passes it down. Added a `deps` seam so it is testable without Postgres. |
| `api/read/finance-os.mjs` | Same three changes. |
| `src/tradelines/store.pg.test.mjs` | Two call sites updated for the stricter signature. Not weakened — `orgId` was already in scope. |

### Files added

| File | What it is |
|---|---|
| `src/http/tradelines-org-scope.test.mjs` | 15 regression tests covering both endpoints and the store's refusal. |

### How I know the tests actually catch it

I removed the fix from `finance-os.mjs` on purpose and re-ran: **3 tests failed.**
Then I put it back and they passed. A test that passes both before and after a
fix proves nothing, so this was checked rather than assumed.

One test pair needed strengthening to make that true: asserting only "another
company gets nothing" would also pass if the endpoint returned nothing to
*everyone*. It now also asserts the client's own company still gets its data.

### Change manifest

* **Signature changed (breaking):** `listTradelines(db, { clientId, orgId, includeClosed })`
  — `orgId` is now required and throws when absent. All three call sites updated.
  Verified by grep that no other caller exists.
* **Handler signatures:** both endpoints gained an optional third `deps` argument,
  defaulting to the real pool. Netlify and Vercel both call `handler(req, res)`,
  so production behaviour is unchanged.
* **Status codes added:** `403` when a session carries no readable org.
* **Routes:** unchanged.
* **Journeys impacted:** none updated — `docs/journeys/` still does not exist (F3).

### Not done here

* No migration. This did not need one.
* Other endpoints were not audited for the same hole. This task named two files
  and fixed those two. **A repo-wide sweep for unscoped client reads is worth its
  own task** — the pattern is any query filtering on `client_id` with no `org_id`.
