# The funding panel — close the split (2026-08-30)

Branch `fix/funding-panel-close-the-split`, off `main` at `6e14b85c`.
Screen: `public/app/client-control-panel.html`.

Screenshots live at `docs/workflows/ccp-close-the-split-2026-08-30-evidence/shots/`.
That folder is gitignored (`.gitignore:29`), so the pictures are on disk, not in
the repo. Three of them, each with red boxes, numbers, and one caption per mark:
`before-1440.png`, `after-1440.png`, `after-read-failed-1440.png`.

---

## What a person can now do that they could not before

**See what is waiting on them the moment the file opens.** The top-left of the
screen is now one number: how many banks have said yes on this client and still
have not told us how much. Next to it, the money we have actually confirmed.

**Move a round without leaving the screen.** Mark round submitted, Mark funded,
Close round. Before this, every stage move happened on the Pipeline board and
every dollar amount was typed on this panel, so finishing one round meant
bouncing between two screens four or more times.

**See how long a round has been sitting.** The round card had no date on it at
all, so one open since June looked exactly like one opened this morning.

**Know when the screen could not check.** A failed read now says so out loud
instead of leaving the last sentence in place, which read as an all-clear.

---

## The three things that were not true, fixed before anything was designed

### 1. The board ignored the button that shipped the same day

`api/dashboard/pipeline.mjs` asked only for an approval with a NULL amount. It
never asked whether somebody had already recorded that the approval does not
count — the "Doesn't count" button, with a name, a time and a typed reason
behind it (`db/migrations/272_approval_excluded.sql`), merged the same day.

So a card kept saying **Amount needed** forever after the question had been
answered, on the board the fulfillment team actually watches.

It also asked for NULL only, while the guard on the Funded move refuses on
`NULL OR <= 0`. A recorded zero was therefore clean on the board and refused at
the move: a wall with no warning in front of it.

### 2. One fact, three definitions

"Is this bank yes worth anything yet?" was written out three times — in the
biller, in the board, and in the screen — and the three already disagreed. There
is now one string, `unpricedApprovalConditions()` in `src/funding/success-fee.mjs`,
used by both database callers. A screen cannot import a module, so the panel's
copy is proved against that exact string, row by row, in
`src/http/client-panel-screen.test.mjs`.

### 3. The tile labelled "Total Approved" showed neither

It printed the **funded** amount. When that was missing it printed the
analyzer's **pre-approval guess** — which is the number in the tile immediately
to its left. It never once showed an approved amount, and since the fee decision
of 2026-08-30 (we bill a percent of *confirmed approvals*) it also contradicted
the invoice.

It now reads **Approved · confirmed** and is summed from the application rows:
bank yeses that carry a recorded amount and that nobody has marked as not
counting. Nothing confirmed reads "not recorded". A failed read reads
"could not check". Never a zero, never the guess.

The test that pinned the old wiring byte for byte was **re-pointed, not
deleted**, with the owner decision written above it. The funded amount it used
to carry is still on the screen — on the Funded line in System Facts, where it
is what it says it is.

---

## What the count can and cannot say

It counts **bank answers we have been told about**. It cannot count applications
that are still out with a bank, because nothing anywhere records that an
application was sent: `src/proxy/launch.mjs` writes a proxy-session row and
nothing else, and the application row is only created when the *answer* is
logged, days later.

That sentence is printed under the number on the screen, not buried in a
comment. Calling these "applications waiting" would be a claim the data cannot
support.

---

## Four states, all written out

| State | What it says |
|---|---|
| Some waiting | **3** · bank answers need a dollar amount |
| None waiting | Nothing waiting on this file. |
| Read failed | Could not check what is waiting. |
| No client picked | Pick a client to see what is waiting on you. |

A real zero is said in words. It is never painted as a bare `0` in a box,
because that is how a zero standing in for unknown gets believed.

---

## Verification

| Check | Result |
|---|---|
| `npm run lint` | clean, 1611 files |
| `npm test` (unit) | **7321 tests, 7308 pass, 10 fail, 3 skipped** — all 10 pre-existing |
| Database phase, scratch Postgres 16.14, 219 migrations, run serially | **1922 tests, 1893 pass, 28 fail, 1 skipped** — all 28 the partner-isolation / affiliate-economics suites CLAUDE.md §12 documents |
| `src/http/pipeline.pg.test.mjs` (incl. new exclusion + zero cases) | 13 / 13 |
| Playwright, new spec `e2e/ccp-headline.spec.mjs` | 20 / 20 |
| Playwright, existing panel + board + smoke specs | 121 tests, 119 pass, 2 fail — both pre-existing |
| `npm run journeys:check` | docs/journeys up to date |

**The 10 unit failures are not this change.** Seven of them live in seven files
that do not read or import a single file this branch touches — verified by grep,
and by running those seven files on their own (94 tests, 87 pass, 7 fail). The
other three are `src/ui/screen-standard.test.mjs` naming `closer-dashboard.html`
and `ops-admin.html`. That test named `client-control-panel.html` before this
branch and does not name it now.

**The two Playwright failures are not this change either.** Both click
`[data-open="credit"]` and `[data-open="bank"]`, and `git show HEAD~1` proves
neither attribute was on this screen before this branch.

### A trap worth writing down

`playwright.config.mjs` sets `reuseExistingServer: !process.env.CI`. A static
server left running by another worktree on the default port **serves that
worktree's files**, and the run reports the old screen as passing. Two suites
were run and believed before this was noticed. Use a private port:

```
E2E_PORT=43217 npx playwright test <spec>
```

### A real bug the browser caught

`.round-amount{display:flex}` beat the browser's own `[hidden]{display:none}`,
so the funded-amount box was visible from the moment the page painted. Nothing
in the markup, the lint or the unit tests could see it. `e2e/ccp-headline.spec.mjs`
failed on it, which is the whole reason a browser runs these screens.

### The sweep for it stopped two elements short — CORRECTED 2026-08-31

Having found that bug class and audited for it twice, this branch shipped with a
**third instance that was worse than the first**, and triaged a fourth away.
A verifier loaded the branch in Chromium and read the computed style; the
correction below was measured the same way, not reasoned about.

**`#ccp-consent-link` could never be hidden.** `.link-btn` is laid out with
`display:flex`, and an author `display` beats the UA `[hidden]{display:none}`.
Four branches of `checkConsent()` set `hidden = true` on that link and **all
four were dead**, so "Record consent for this client ↗" — a 665x40 box — sat on
screen in every state, carrying no information:

| state | what the code intends | what the screen did |
|---|---|---|
| consent already valid | hide it, nothing to collect | shown |
| consent **REVOKED** | hide it — the code's own comment says "Revoked means stop, so do not offer a shortcut to re-collect it" | shown |
| the consent read failed | hide it — "not a reason to offer a link off the back of an answer we did not get" | shown |
| the answer carried no status | hide it | shown |
| consent **expired** | show it | shown (the only one that worked) |

Fix: `.link-btn[hidden]{display:none;}`. One line, and four existing branches of
consent logic start working. Measured after: all four hide, and expired still
shows a real 665x40 box — so the rule is not one that paints nothing.

**The suggestion span, previously refused below, is fixed too.** It was refused
as harmless because it is empty when hidden, and that was true as far as it went.
But its `display:inline-flex` was an **inline style set in JS**, which no
stylesheet rule can beat — so unlike the other two this one could not be fixed by
a guard at all, and the row it sits in is a wrapping flex with `gap:6px`. An empty
child still eats a gap: measured **5 laid-out children where 4 were wanted**, on
every lender row. Layout moved to `.amount-suggest` in the screen's own `<style>`,
so `[hidden]` works. Behaviour when visible is unchanged; all 21 tests in
`e2e/bank-amount-suggestion.spec.mjs` and `src/http/bank-amount-suggestion.test.mjs`
still pass.

**The guard is now a sweep, not three named elements.** `e2e/ccp-headline.spec.mjs`
walks every `[hidden]` on the screen and fails if any has a computed `display`
other than `none` — 21 elements with no lender rows, 23 with them. It has **no
exemptions**, because writing an exemption in is how the first sweep stopped
short. Proven to exercise the gate: with the two CSS guards removed, 5 of the 6
new tests go red.

Why the existing tests never caught either: Playwright's `toBeHidden()` passes on
a zero-size element regardless of `display`, and `e2e/bank-amount-suggestion.spec.mjs`
already asserted `toBeHidden()` on the suggestion slot — and passed.

---

## Not done, and why

* **"My book" across every client.** The rhythm asks for "what is waiting on me,
  across my whole book", and this only answers it one file at a time. `clients`
  has **no assignee column** (`db/schema/001_init.sql:44-72`; only
  `tasks.assignee_staff_id` exists), so "my book" cannot mean one advisor's
  clients today — only the whole company's. Whether Chris means per-advisor is a
  schema question, and guessing it would be a schema change nobody asked for.
  The existing cross-client surface is the pipeline board's "Amount needed" chip,
  which fix (1) above makes correct.
* **`funding_closeout` still has no reader on any screen.** The fee the work
  earned is still invisible to the person who earned it. Out of scope here; it
  needs a decision about which surface shows it.
* **`read-signals.mjs:667` `ready: null` and `:671` `total_approved: null`** are
  still hardcoded, and the note `pipeline.html` prints for the second one — "No
  bank approval has ever been recorded" — is still out of date. `total_approved`
  is now sourceable (`sumConfirmedApprovals` exists), so this is a real and small
  piece of work, but it is the pipeline lens, not this screen.
* **`listClientApplications` does not filter `is_demo`.** `applications` carries
  that column (migration 148). On a demo-enabled org the count could include
  seeded rows. Written down, not fixed — it is a server-side read used by more
  than this screen.
* ~~**One suggestion span still starts `hidden` with an inline
  `display:inline-flex`**, which is the same class of bug as the funded-amount
  box. It is empty when hidden so nothing shows, and it belongs to the
  bank-email work that merged earlier today. Left alone.~~
  **DONE 2026-08-31 — this refusal was wrong.** "Empty so nothing shows" was
  true; "so it costs nothing" was not. See the corrected section above: the row
  is a wrapping flex with `gap:6px` and the empty child ate one, measured. It is
  also the one instance of the three that a CSS guard could never have fixed,
  because the `display` was inline. Fixed by moving the layout into
  `.amount-suggest`.

  **What this refusal got wrong is worth keeping.** It triaged on *visible
  output* ("nothing shows") when the bug class is about *layout participation*.
  That is the same reasoning that let `#ccp-consent-link` through — the sweep
  looked for elements that were legible, not for elements that were laid out.
