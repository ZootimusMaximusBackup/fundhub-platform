# Favicon + test-data scrub — 2026-08-27

Chris asked for two things in one thread:

1. A favicon — "just use the f. the f and then the dot. from my brand logo."
2. "Delete all the demo data… any sample data, messages, contracts sent…
   anything that is lingering we need to scrub after each test", pointing at
   https://fundhub.ai/app/documents.html

## Task list

| # | Owner | Task | Status |
|---|-------|------|--------|
| W1 | main thread | Brand favicon | done |
| W2 | main thread | Find where test data leaks from | done |
| W3 | main thread | Tool to list and clear test leftovers | done |
| W4 | main thread | Mark hand-made test clients so they self-clean | done |

---

## W1 — Favicon

The site had no favicon at all: no icon file at the web root, no
`<link rel="icon">` on any page. Browsers fell back to their default.

The mark is taken from the real logo rather than redrawn.
`public/aniso-face/logo-6k/logo.svg` holds the "fundhub." wordmark as eight
paths. Path 0 is the **f**, path 7 is the **dot**. Both are copied verbatim.
The gap between them is 15.53 units — the same gap the dot already has after
the **b** in the wordmark, so the pairing uses the logo's own spacing.

White on the brand black (`--ink #0A0A0A` / `--paper #FCFCFC`). The tile
carries its own background, so it looks the same on a light or a dark browser
theme, and it stays readable at 16px where a thin f on transparent would not.

| File | Why |
|---|---|
| `public/favicon.ico` | 16/32/48. Browsers find this at the root on their own, so it covers pages with no link tag |
| `public/favicon.svg` | sharp at any size on high-resolution screens |
| `public/apple-touch-icon.png` | 180×180, square corners — iOS applies its own rounding |

49 of 55 pages got explicit link tags. Six were skipped because another session
has edits open on them in this shared checkout: `agent-editor`,
`closer-dashboard`, `lenders`, `partner-galaxy`, `pipeline`,
`soft-pull-approve`. Those six still show the icon via the root `favicon.ico`.

Verified by serving `public/` and loading a page in a real browser: all three
files return 200 with the right content types, and the three link tags resolve.

---

## W2 — Where the test data actually comes from

Chris's theory was that a test tool is leaving rows behind. It is not. Every
automated path already cleans up after itself:

| Path | What it does | Leaves rows? |
|---|---|---|
| `src/demo/simulate-client.mjs` | marks every row `is_demo = true`; has its own teardown | no |
| `src/journeys/runner/synthetic.mjs` | wraps the whole run in a transaction and rolls it back | no |
| `src/verification/run-all.mjs` | wipes its clients in a `finally` block; also refuses to run against production | no |

**So the rows on the live site were made by hand.** Somebody clicked through the
real signup, upload and contract flow on fundhub.ai. Those rows come out of the
ordinary product code (`api/contracts.mjs`, `src/handlers/client-lifecycle.mjs`,
`src/contracts/upload.mjs`) and carry no marker of any kind.

This is the finding, and it is what shaped W3 and W4: **in the database a
hand-made test client and a real paying customer are the same shape.** There is
nothing to tell them apart after the fact. No code change can go back and mark
what already exists — which is why W3 refuses to delete an unmarked row and asks
a human instead, and why W4 marks the row at signup, the one moment the
difference is knowable.

The existing teardown at `POST /api/demo/simulate` only removes clients flagged
`is_demo = true`. That guard is the only thing standing between the teardown and
a real customer's file, so it is not something to loosen.

---

## W3 — `scripts/db/find-test-data.mjs`

Dry run is the default, matching `scripts/retention-purge.mjs`.

```bash
DATABASE_URL="..." node scripts/db/find-test-data.mjs
```

Prints which database it is talking to (host and name, never the password), then
two lists:

* **MARKED** — carries a marker only our own code sets (`is_demo`, the
  `e2e_verify` tag, `journey-runner`, the synthetic marker, `sim+` /
  `@demo.fundhub.local` emails). `--apply` deletes these.
* **NO MARKER** — recent clients with nothing to identify them. Shown with names,
  emails, dates and what is attached ("4 messages, 1 contract") so a person can
  recognise them. **Never deleted, even with `--apply`.** There is no flag that
  changes that.

To clear the ones Chris recognises from the second list:

```bash
DATABASE_URL="..." node scripts/db/find-test-data.mjs --client <id> --client <id> --apply
```

The file contains no `DELETE` statement. `--apply` stamps `is_demo = true` and
hands the row to `teardownSimulated()`, the delete path that already exists,
already walks every child table by foreign key, and re-checks the flag itself
before removing anything. One delete path instead of two that drift.

Seven tests in `scripts/db/find-test-data.test.mjs`, including the two that
matter: a dry run issues zero writes, and an unmarked client survives `--apply`.

---

## W4 — Marking hand-made tests

Chris was told the risk (below), asked for the tag string, and answered
"Finish it!" — so the tag was chosen here rather than left blocking.

**Put `+fhtest` in the email and the row is born disposable.**

    chris+fhtest@gmail.com       -> is_demo = true, self-cleans
    chris+fhtest-run4@gmail.com  -> is_demo = true, self-cleans
    chris@gmail.com              -> ordinary customer, untouched

A plus tag is invisible to mail delivery, so the tester still gets working
magic links and real emails in the same inbox — the row is just disposable.

`src/demo/test-identity.mjs` is the only place that decides. Two call sites read
it, and both compute the flag from the address rather than from anything a
caller sends, so no request can ask to be marked demo:

* `src/handlers/client-lifecycle.mjs` — lead and intake capture
* `api/contracts.mjs` — "Contact added" on the contracts screen

`src/contracts/upload.mjs` was deliberately **not** wired. Its client row is the
internal `[Contract Templates]` placeholder, not a person, and it has to persist.

### The risk, on the record

`is_demo = true` is not a label. It hides the client from every CRM list
(`src/demo/exclude-demo.mjs`) and makes the row eligible for deletion. A real
customer who signed up with the tag in their address would disappear from the
app. Three things prevent that:

1. The tag matches only inside the local part, only as a whole `+` segment.
   `someone@fhtest.com` and `notfhtest+x@a.com` do not match.
2. `fhtest` is a made-up word. No real address carries it by accident.
3. `TEST_EMAIL_TAG=""` switches the mechanism off completely, and any other
   value changes the tag — no code change needed.

Fourteen tests cover it, including every near-miss in the list above.

### Env var — not set, and it does not need to be

`TEST_EMAIL_TAG` is unset, and unset means `fhtest`. CLAUDE.md §11 says a new env
var is the agent's to set, but `api.netlify.com` is blocked from this
environment, so it could not be. Nothing is waiting on it. Set it only to change
the tag or to switch the mechanism off:

    netlify env:set TEST_EMAIL_TAG "fhtest" --context production --context deploy-preview --context branch-deploy

---

## Gates

| Gate | Result |
|---|---|
| `npm run lint` | clean, 1518 files |
| `npx tsc --noEmit` | not run — there is no tsconfig in this repo, so it checks nothing |
| New tests | 21 added, all passing (14 identity, 7 scrub tool) |
| Tests around the two edited files | 86 passing, 0 failing |
| Playwright | favicon verified in a real browser; no other UI changed |

**Pre-existing failures, not caused by this work.** `src/messaging/seed/parse.test.mjs`
fails 7 of 25 on its own, and `seed.test.mjs` fails too. Both are committed code
— `git status` shows nothing dirty anywhere under `src/messaging/seed/`, and
that test imports only its own siblings, so nothing changed here is reachable
from it. Worth knowing: the full-suite run reported **one** of those failures on
one run and **two** on the next with no source change in between, which matches
the warning in CLAUDE.md §12 that the suite's own count is not trustworthy.
Measure the file directly rather than reading the summary line.

## Journeys

No `-actual.md` was edited and no changelog line was added, on purpose.

The flag changes no step a person takes. A tester types the same address into
the same form and sees the same screens; the only difference is one column on
the row that comes out. If Chris would rather the client intake journey record
"a tagged email produces a disposable record", say so and it gets added — this
is being reported rather than decided quietly, per CLAUDE.md §4.
