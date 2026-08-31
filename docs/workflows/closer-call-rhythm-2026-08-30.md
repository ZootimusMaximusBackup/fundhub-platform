# Closer Dashboard — move with the call, 2026-08-30

One screen: `public/app/closer-dashboard.html`, its wiring `public/app/closer-call.js`,
and the payload behind it `src/sales/cockpit.mjs`.

Owner frame: *"they should be solidified based on the routine of the employee."*
The closer's routine is one call at a time, back to back, script in a second tab.
So the screen has to answer **who am I on with, am I on time, and where is the
money button** — and it has to be telling the truth when it does.

Evidence: `docs/workflows/closer-call-rhythm-2026-08-30-evidence/` (gitignored,
shots handed over separately). Shot tool: `_shots.mjs` in that folder — read-only,
every `/api/**` call is answered by the harness, so a shot run can never write.

---

## The headline number, and where it comes from

**The headline is the NAME of the person on the call, at 32px, top-left, with the
time of that call beside it.** Not a dollar figure and not the closer's own name.

It was already honest and it is still honest:

| | |
|---|---|
| the name | `clients.first_name` / `last_name` / `email` → `src/sales/cockpit.mjs:277` → `api/read/closer-call.mjs` → routed at `netlify/functions/api.mjs:494` → painted at `closer-call.js` `text($(".who h1"), client.name)` |
| the time | `tasks.due_at`, now carried as its own field `current_call {due_at, task_id, title}` — **new** |

Two things about it changed:

* **The fallback used to be the word "Client".** In a 32px heading that reads as a
  real answer. It says **"Name not on file"** now, so the closer knows to ask.
* **The time used to be an inference.** The payload had no field meaning "the time
  of THIS call", so the screen took the head of `up_next[]` and hoped. On a deep
  link to a client with no booked task that is the *next person's* appointment,
  printed beside this client's name. `current_call` is `null` in that case and the
  screen says "no booked time".

---

## The four numbers that were lying, and what they say now

### 1. Two of the three money bands printed **$0** when the truth was "we don't know"

This is the one that mattered most, and it was live.

`src/underwrite/vendor/underwriter.cjs:353-357` and
`src/underwrite/business-funding.mjs:81` return `total_personal_funding` and
`total_combined_funding` as the **number 0** — never `null` — when the engine has
nothing to work with. `closer-call.js`'s `money()` treats 0 as a real figure.

So a client with no credit pull showed:

> Conservative **—** · Realistic **$0** · After optimization **$0**

A closer reads that as *"this person can get nothing."* It means *"nobody has
pulled their credit."* `CLAUDE.md §12`: NULL means unknown and must survive.

Confirmed by running the engine, not by reading it, and pinned in
`src/sales/cockpit-honest-money.test.mjs`: an empty file really does return
`lite_banner_funding: null` and both totals as `0`.

Three states now, kept apart, and the third is said in **words** so it can never
be mistaken for the second:

| what is true | what the band shows |
|---|---|
| no credit pull on file | **—** · "No credit pull on file yet" |
| pull on file, engine returned no figure | **—** · "Not in the UnderwriteIQ answer" |
| pull on file, engine computed nothing fundable | **None yet** · "Pull is on file — the report finds nothing fundable" |
| a real figure | the money |

The closer is also no longer shown the sentence **"No crs_results row for this
client yet"** in the money bands. That is a database table name in a sentence
meant for a salesperson; the band says "No credit pull on file yet" instead. (The
same string still appears in the WHERE THEY STAND panel, which comes from the API's
own `credit.reason` — see *Found, not fixed*.)

### 2. The third band was labelled as something it is not

"After optimization" was painted from `totals.total_combined_funding`, which is
personal funding **plus business stacking** (`src/underwrite/business-funding.mjs:78-82`).
It is not the engine's own `optimization` block — a separate key this screen never
reads. A wrong label on a real number is worse than a missing number.

It reads **"Personal + business stacked"** now, which is the arithmetic.

There was also a dead fallback (`closer-call.js:506-508` on `main`) that would have
printed the *realistic* figure under the optimization label — the same number
twice, one of them wrong. Gone.

### 3. Save · next call could book the wrong money — **this one wrote to the database**

`src/sales/cockpit.mjs:148-155` pulls the client's most recent paid transaction
with **no time bound at all**. The browser stored that id and posted it as
`transaction_id`. `src/sales/call-outcomes.mjs:56-71` sees an explicit
`transaction_id` and uses it directly, **bypassing the 48-hour window at :73-81**
that exists precisely to mean "money from this call."

So: a repeat client who paid $500 four months ago closes today for $1,000. The
page loaded before today's payment posted, so it sent the four-month-old id, and
the outcome was written with `cash_collected_cents = 50000` attached to a payment
that has nothing to do with this call. The closer's cash is wrong, low, and
misattributed — and only for repeat payers, which is exactly the downsell and
second-round clients.

**The browser no longer sends `transaction_id` at all.** The server resolves the
payment inside its own 48-hour window, which is what "money from this call" means.
No server change was needed; the window was already there and was being skipped.

Pinned twice: in `src/sales/cockpit-honest-money.test.mjs` (the string must not
come back) and in `e2e/closer-call-rhythm.spec.mjs` (a real browser presses Save
and the posted body is read).

### 4. The success fee was a constant

`cockpit.mjs:255` set `success_fee_percent: 0.10` flat, so the screen printed
"10%" whatever the file said, on a row labelled **Success fee**.
`funding_closeout.fee_percent` is the real column (`db/migrations/139_funding_ops.sql:33-35`)
and **had no reader on any staff-facing screen** — the fee the work earned was
invisible to the person who earned it.

`buildCockpit` already selected the latest `funding_rounds.id` and threw it away.
That query now `LEFT JOIN`s the closeout, so:

* a closeout row → the real percent, and `success_fee_source: "closeout"`
* no closeout row → 10%, `success_fee_source: "default"`, and the screen prints
  **"10% · default"** with "House default — no closeout on this round yet."

A LEFT JOIN rather than a COALESCE on purpose: it is what makes "no closeout yet"
survive as NULL instead of quietly becoming 10.

The deal panel also gained a **Paid on** row. "Latest payment on file: $500" with
no date is how a four-month-old payment reads as today's.

---

## The shape, and why

**Zone 1, above the fold, nothing above it.** The client's name top-left with the
call time beside it; **one** action directly under it; the money answer under that.

**Zone 2, below the action.** Credit standing, the deal, pre-call context — the
things they get asked about. Reference goes below the action (§12 rule 3).

**Zone 3.** The Payment Calculator, still one collapsed section, still closed by
default. Unchanged, and the merge spec pins it that way.

### What moved

* **The staff band is gone.** `.stat-head` printed the signed-in closer's own name
  in a white band directly above the client's — §12 rule 1 names this exactly
  ("never their own name"). The identity is in the topbar right now.
* **And it is named exactly once.** `shell.js` mounts its own account chip
  (`#fh-shell-chip`) into the same `.topbar-right` carrying the same name and role.
  The page keeps its own `#whoName` for the case where the shell mounts no chip,
  and stands it down when the shell's is there:
  `.topbar-right:has(#fh-shell-chip) .who-chip{display:none}`. Measured at 1440,
  two identities plus a rewritten subtitle squeezed the screen's own name down to
  "Clo…".
* **The topbar subtitle is no longer rewritten with the client's name.** It
  duplicated the 32px heading four inches below it and had no truncation.
* **One filled button, and never a disabled one.** Three buttons used to sit at
  equal weight and the only filled one was **Join call**, which is disabled
  whenever the appointment carries no meeting link — so the loudest element on the
  screen was a dead control. `setPrimary()` moves the fill as the call moves:
  Join (if there is a link) → Send pay link → Save · next call once the money lands.
* **Send pay link is on the screen.** Taking money used to mean switching tabs and
  paging to slide 23 of 24. Same write the deck does — `POST /api/closer-deck
  {action:"send_pay_link"}` — **no new endpoint and no second send path**. The
  offer list rides on the one fixed `closer-call` read (`offersForClient()` is pure
  config and issues no query), so the merge spec's one-data-path rule holds.
* **The rail order is swapped.** "Before you close" — the five compliance
  disclosures — sits above "Up next". On a 900px laptop the things a closer must
  not miss were falling below the fold under a list of calls that have not started.
  `closer-call.js` finds Up next by `data-fh-up-next` now, not by index, so the
  order can move again without painting calls into the checklist.

### And the thing that makes it move with the call

After the pay link is sent, the screen starts watching for the payment and says so
**where the closer is already looking** — right under the money button. When it
lands: "Payment posted · $1,000 · Deposit", and the one primary button becomes
**Save · next call**.

It re-reads the **same fixed read** (`GET /api/read/closer-call`), so no second
client read is introduced. Bounded on purpose: every 20 seconds, at most 5 minutes,
and it stops the moment a payment that was not there before appears. Before this,
`closer-call.js` read once in `boot()` and the only `setInterval` on the page was
the clock — the closer sent the link and then stared at a page that had stopped
listening.

---

## §12 frame debt cleared while in the file

* **Nine dead px font sizes deleted.** Everything on this page is inside
  `div.app`, so `fundhub-brand.css:184-186` was throwing all nine away. Checked by
  DOM ancestry, not by class name. `src/ui/screen-standard.test.mjs` listed nine
  `closer-dashboard.html` offenders on `main` and lists **zero** now.
* **Plus five dead inline sizes** in the contract panel markup and two more in
  `closer-call.js`'s generated blank fields, which the guard does not even catch —
  an `!important` author rule beats a normal inline style too.
* **`.calc-panel` and `.big-tile` both set `border:0` while the brand file was
  still giving them a shadow** — a floating shadow with no edge. §12.4 names them
  as the example. Both take `box-shadow:none` in the same rule, which is the one
  legal way to un-panel something **and keeps the owner's 2026-08-27 zero-border
  decision intact**. The guard lists neither now.
* **`#fh-contract-panel` lost its box.** It was the only bordered thing on a screen
  that reports zero. Both send panels share one `.sendpanel` shape: one hairline
  above, no outline.
* **The topbar contract (§12.8):** `.brand{min-width:0;flex:0 1 auto}`, the screen
  name truncates with an ellipsis, `.topbar-right{flex:0 0 auto}`. **No clock rule
  was added** — `shell.js` already owns `.clock` app-wide and hides it under 900px,
  and `.clock` is not this screen's to size.
* **Still exactly one escape hatch**, still only screen-owned class names. `.stat-sub`
  came off it with the band it named; `.who-role` moved under `.who-chip`.
* **The stale banner.** "not sourced yet: today's pipeline, the shift stats, …"
  named two tiles that were cut on 2026-08-17 and that
  `src/http/closer-ui-honest.test.mjs` now forbids from coming back. Both halves
  removed — the page's copy and `src/http/closer-dashboard-view.mjs`, which is the
  module the page's copy is checked against.
* **The loading state stopped showing a developer instruction.**
  `Open with ?client_id=<uuid>` → "Finding the next booked call…".
* **The error state stopped leaking a machine word.** `"Could not load cockpit (nodb)"`
  → `FHData.explain()`, the house error copy written once in `public/app/data.js:579`
  for every screen in the app.
* **Three tables got their own horizontal scroll box** (`.fh-scroll-x`, defined once
  in `crm-sidebar.css`). §11. **Honest note:** measured with 40 tradelines at 390px,
  page overflow was **0px before and 0px after** — this screen was not sliding
  sideways, so this is a guard rather than a fix. Recorded rather than claimed as a
  win.

---

## Refused, and why

**The borders were not reversed.** `pipeline.html` is the §12 reference and uses
bordered cards; this screen carries **zero** bordered containers by an owner
decision recorded on 2026-08-27, because eight boxes at once produced no hierarchy.
Reversing a written owner decision is not an agent's call.

If the two are ever reconciled, the cost is: eleven containers get
`border:1px solid var(--line)` back plus the token shadow, the 8/16/24/32 spacing
that replaced them can stay as it is, and the `border:0;box-shadow:none` pairs
added here come back out — roughly an hour, one screen, no data change. My
recommendation if asked: **leave it**. The reference screen is a board of many
small equal cards, where a border is what separates one card from the next. This
screen is one long reading column with a rail; its groups are already separated by
48px of space, and putting outlines back would restore exactly the "eight boxes and
no hierarchy" the owner removed.

**No new page, screen, tab or menu row was added.** Everything landed on surfaces
that already existed.

---

## Found, not fixed

1. **"No crs_results row for this client yet" still reaches the closer** in the
   WHERE THEY STAND panel. It comes from the API's `credit.reason` and is used by
   other readers, so rewording it is a change to the payload, not to this screen.
   The money bands no longer repeat it.
2. **`api/read/closer-deck` and `api/read/closer-call` compute UnderwriteIQ twice**
   from the same three inputs, in two files, and can disagree. Not touched.
3. **`docs/journeys/role-closer-intended.md` is route-level only** and says nothing
   about this screen's shape, so it neither blessed nor blocked this work. That is a
   gap, not permission.
4. **`src/pulse/registry.test.mjs` fails on `main`** for two handlers
   (`campaigns/meta-agency`, `staff/avatar`) that are routed and unlisted. Unrelated
   and untouched.

---

## Gates

* `npm run lint` — clean, 1612 files and inline scripts.
* `npx tsc --noEmit` — **a no-op in this repo.** `tsconfig.json` exists but there
  are no TypeScript sources; recorded as run, not as passed.
* `npm test` — **7314 tests, 7301 pass, 10 fail, 3 skipped.**
  `main` at `6e14b85c`, measured the same way in a pristine tree: **7300 / 7287 /
  10 / 3.** Same ten failures, name for name, all pre-existing and all in files
  this branch does not touch. +14 tests, +14 passes, no new failure.
* **Postgres phase, measured properly rather than skipped.** Own scratch database
  (`fh_scratch_closer_rhythm`), Postgres 16.14 Homebrew on macOS, all 219 migrations
  applied to an empty database, run serially exactly as `scripts/run-suite.mjs` does:
  **1955 tests, 1926 pass, 28 fail, 1 skipped.** A second scratch database built the
  same way from pristine `main`: **1955 / 1926 / 28 / 1**, and the two failure sets
  are **identical line for line**. All 28 are the row-level-security isolation
  suites, which is the documented artifact of connecting as the database owner
  (`CLAUDE.md §12`). Both scratch databases dropped afterwards.
* **Playwright** — `e2e/closer-call-rhythm.spec.mjs`, 11 new browser tests covering
  full / empty / loading / error at 1440 and 390, plus the 9 existing
  `e2e/sales-dashboards.spec.mjs` tests, all passing. The full state is drawn
  against **40 tradelines**, not three.
  *Worth knowing:* the e2e static server is `reuseExistingServer`, and another
  worktree on this machine was holding port 43117 — my first run was silently
  served that tree's files and reported nine false failures. Run with `E2E_PORT=`
  set to something private when other agents are working.
* Journeys — `npm run journeys:check` says up to date. No route moved: closers
  could already reach `/api/closer-deck` and `/api/read/closer-call`. One
  CHANGELOG line appended, line count checked before and after.

## Manifest

| file | what |
|---|---|
| `src/sales/cockpit.mjs` | `current_call`, real success fee from `funding_closeout`, `offers`, honest name fallback |
| `public/app/closer-call.js` | band honesty, no client-sent `transaction_id`, pay link, payment watch, `setPrimary`, `FHData.explain` |
| `public/app/closer-dashboard.html` | anchor, topbar, rail order, send panels, §12 frame debt, scroll boxes |
| `src/http/closer-dashboard-view.mjs` | banner sentence (the module half of the page's copy) |
| `src/sales/cockpit-honest-money.test.mjs` | **new** — 14 tests |
| `e2e/closer-call-rhythm.spec.mjs` | **new** — 11 browser tests |
| `src/http/closer-dashboard-view.test.mjs` | banner region list follows the screen |
| `docs/journeys/CHANGELOG.md` | one line |

No route added, no endpoint added, no migration, no env var touched, no new surface.


---

# CORRECTION PASS — 2026-08-31, worktree `wf_489b6cce-e68-4`

An adversarial verifier re-ran this branch rather than reading it. Most of the
account held up. One thing did not, and it was in the headline itself.

## What was wrong, and how it was measured

**1. "next 11:00 AM" could name a call that is BEFORE this one, or skip the real
next one entirely.**

`paintWhen()` took the first element of `up_next[]` that was not the current
task. `up_next` comes from `upcomingCalls()`, whose ORDER BY is

```
ORDER BY CASE WHEN t.client_id = $3 THEN 0 ELSE 1 END, t.due_at ASC
LIMIT 5
```

Every one of the OPEN client's tasks is forced to the front of that list
whatever the clock says, and the list is then cut at five rows.

Measured by seeding real rows into a scratch Postgres and running the real
query — not simulated:

| day | array order the query returned | screen said | truth |
|---|---|---|---|
| A. open client 3:00 PM, someone else 11:00 AM | 3:00 PM, 11:00 AM | next **11:00 AM** | nothing after this — 11:00 is four hours EARLIER |
| B. open client 10:00 AM and 4:00 PM, someone else 11:00 AM | 10:00, 4:00 PM, 11:00 | next **4:00 PM** | **11:00 AM** — six hours of runway on screen, one in life |
| C. open client 3:00 PM, others at 9, 10, 11, 12 **and 4:00 PM** | 3:00 PM, 9, 10, 11, 12 | — | the 4:00 PM is **cut by LIMIT 5** |

C is why the fix is a query and not a loop. Sorting the array by time fixes A
and B and still answers "nothing after this" in C, over a call that exists.

**Fix.** `nextCallAfter()` in `src/sales/cockpit.mjs` asks the table for one row,
strictly after this call's time, ordered by time, no client weighting, no
truncation. The payload carries it as `next_call` — always present, `null` only
when there genuinely is no later call. `paintWhen()` prints that field and a
guard test fails if it ever reads `up_next` again.

**2. A call on another day printed as a bare clock time.** `upcomingCalls` keeps
THIS client's tasks from `date_trunc('day', now())` onward, not today only, so a
deep link to somebody booked next Tuesday read `2:00 PM · in 100h 0m` with
nothing to say which day. `whenText()` puts the date in front when it is not
today.

**3. The `box-shadow:none` this branch added painted nothing.** Not a verifier
finding — found while checking its neighbour, and confirmed in Chromium.
`fundhub-brand.css:130-137` is `:is(.app,.app-shell) :is(…,.calc-panel,.big-tile,…)`,
which is **two classes**. This branch wrote `.calc-panel{box-shadow:none}`, which
is one, loses on specificity, and does nothing at all — while reading in the file
exactly like a fix. Computed box-shadow before: `rgba(10,10,10,.04) 0 1px 2px,
rgba(10,10,10,.06) 0 2px 8px`, with `border:0` — the floating grey smudge around
nothing that §12.4 forbids, live on the screen, with the file claiming otherwise.
`.app ` in front of both selectors ties the brand rule, and this stylesheet loads
after it, so order decides. Computed box-shadow now: `none`.

**4. "The closer is named ONCE" was overstated.** Counted in the browser by
walking every visible text node: the name is visible **twice** — the shell's
account chip in the topbar, and the `[data-fh-call-staff]` pill in the call
toolbar, which predates this branch. The topbar itself does hold one identity,
and that part was real. The spec now counts and pins **2**, so it cannot grow
quietly.

## Found, not fixed — deliberately

* `saveOutcome` (`public/app/closer-call.js`) still routes to
  `state.data.up_next[0]` after logging, which by the same ordering is the
  client just finished. **Pre-existing on `main`.** Out of scope here.
* The rail's "Up next" list renders `up_next` in that same non-chronological
  order. Also pre-existing.
* `src/ui/screen-standard.test.mjs` checks the §12.4 rule by **reading the CSS
  text**. It sees `box-shadow:none` and passes, whether or not the declaration
  ever reaches the element. That is how item 3 above got through. Fixing it for
  every screen is a shared-guard change and is not this branch's to make; the
  browser assertion added here covers this screen only.

## Verification, this pass

* `npm run lint` — clean, 1613 files.
* `npm test` — **the runner never reaches the database phase.**
  `scripts/run-suite.mjs` exits after the unit phase when it is red, and it is
  red on `main`, so `0 skipped` in that summary means "never ran", not "nothing
  to run". The two phases were measured separately.
  * **Unit phase: 7320 tests, 7309 pass, 11 fail, 0 skipped.** The same 11 by
    name with this branch's files reverted to `main`. None names this screen.
  * **Database phase, run by hand at concurrency 1 exactly as the runner would:**
    own scratch Postgres 16.14 (`fh_314fix`), built from zero, 219 migrations,
    **138 files, 1961 tests, 1931 pass, 29 fail, 1 skipped.** Every failure is a
    partner-isolation / row-level-security suite — the documented artifact of
    connecting as the database owner (CLAUDE.md §12) — and none of them reads
    this screen. Database dropped afterwards.
* **Playwright** — `e2e/closer-call-rhythm.spec.mjs`, **16 tests, 16 pass**.
  The 5 new assertions were run against the pre-correction code first and
  **4 of the headline ones failed and the frame one failed**, so each gate
  exercises its gate.
  *Repeat of the earlier warning, because it bit again:* the static server is
  `reuseExistingServer` on port 43117 and another worktree was holding it. A
  full run came back with sixteen failures that were really another tree's
  files. Run with `E2E_PORT` set to something private.
* Journeys — `npm run journeys:check` up to date. One CHANGELOG line appended,
  line count checked before and after (244 -> 245).

## Manifest — correction pass

| file | what |
|---|---|
| `src/sales/cockpit.mjs` | **new export `nextCallAfter()`**; `next_call` on the payload |
| `public/app/closer-call.js` | `paintWhen` reads `next_call`; `clockTime` -> date-aware `whenText` |
| `public/app/closer-dashboard.html` | `.app ` on `.calc-panel` and `.big-tile` so `box-shadow:none` applies; stale comment corrected |
| `src/sales/cockpit-honest-money.test.mjs` | +4 tests: `next_call` sourcing, always-present key, paint-path guards |
| `src/sales/cockpit-next-call.pg.test.mjs` | **new** — 6 tests, real SQL, the A/B/C days |
| `e2e/closer-call-rhythm.spec.mjs` | +5 browser tests; identity claim replaced with a measured count |
| `docs/journeys/CHANGELOG.md` | one line |

No route added, no endpoint added, no migration, no env var touched, no new
surface, `--fh-maxw` untouched, no user-visible empty-state wording changed.
