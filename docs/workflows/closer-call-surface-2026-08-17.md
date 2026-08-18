# Closer call surface — simplify 2026-08-17

**Owner ask (Chris):** Closer Dashboard has too much information and is overwhelming on a live
call. Keep the calculators. On a sales call the closer runs the presentation on one screen and
needs ONE working surface on the other. Closer Dashboard and Call cockpit overlap and compete.
Cut what isn't needed during a call. **Tell Chris what was cut and why BEFORE deploying.**

**Skill:** fundhub-fixer. Owner-scope minimal diff. Nothing is cut until Chris approves the list.

## Task list

| # | Task | Owner | Status |
|---|---|---|---|
| W1 | Closer Dashboard inventory | main thread | done |
| W2 | Call cockpit inventory | agent | done |
| W3 | Test + journey blast radius | agent | done |
| W4 | Live "before" capture as closer | agent | done |
| S1 | Synthesis → cut list for Chris | main thread | done |
| S2 | The cut (after Chris approves) | main thread | done — committed inside a41f2fe |
| S3 | Prove: lint, tests, live capture, deploy | main thread | blocked — not pushed, owner call |

## Shared context brief

- Screens: `public/app/closer-dashboard.html`, `public/app/closer-call.html` + `closer-call.js`
- Backing: `src/http/closer-dashboard-view.mjs`, `src/sales/cockpit.mjs`, `src/sales/closer-now.mjs`
- Journey: `docs/journeys/role-closer-intended.md` (source of truth, agents never edit) and
  `role-closer-actual.md` (agents maintain)
- Live app: https://fundhub.ai — closer test account is `closer@fundhub.ai`
- **Calculators stay.** Owner-set, not up for discussion.

## W1 dashboard inventory

Source: `public/app/closer-dashboard.html` (1327 lines), `src/http/closer-dashboard-view.mjs`,
`public/app/shell.js`.

| # | Block | What a person sees | Data source | Live or decoration |
|---|---|---|---|---|
| 1 | Left sidebar | 9 groups, 34 links (Home, Sales, Funding, Client ops, Watch, Automation, Marketing, Admin, Portals) | **`shell.js` `SIDEBAR_HTML` — SHARED by every screen**, filtered at runtime by `gateLinks()` | Live nav. Closer is given the FULL staff surface on purpose (shell.js:210-232) |
| 2 | Topbar | "Fundhub / Closer Dashboard", "Org: Fundhub" pill, clock, green LIVE pill | clock = `tickClock()` local time; org pill + LIVE pill hardcoded | Clock live; two pills are decoration |
| 3 | Who strip | avatar + name + role | `GET /api/auth/session` | Live |
| 4 | Shift stat tiles — Calls Today / Kept / Collected / Pace | **nothing — `hidden` attribute on the markup** | none | Dead markup, already invisible (line 290) |
| 5 | Today's Pipeline table | max 2 rows: the call you are on + the next one. Columns Client / Stage / Next / When | `GET /api/read/closer-now` -> `src/sales/closer-now.mjs` (LIMIT 2) | **Live.** Stage column always renders "—" (line 1274) |
| 6 | Deal Funding Calculator | Total Available Credit, Lender matches, Requested draw + Guardrail inputs, draw slider, utilization line, guardrail alert | `GET /api/read/tradelines` -> `src/calculators/deal-funding.mjs` | Live with `?client_id=`; sample fallback without. **KEEP — owner-set** |
| 7 | Deal Math Calculator | Deposit / Success fee % / Debts / Min payment % inputs -> Net Cash to Client, Monthly Obligation, cliff alert | typed inputs + drawn amount from the file | Live (computed client-side). **KEEP — owner-set** |
| 8 | "Show breakdown" `<details>` | Collapsed by default. Inside: per-lender waterfall, payback comparison 12/24/36, D-03b net-cash derivation, D-04 per-card minimums | tradelines | Waterfall live. D-04's minimum column has **no API source** and renders blank on purpose (line 1050) |
| 9 | Footer statusbar | 6 items: "fundhub-closer · v1", "org: fundhub", who, "these numbers are estimates...", "systems nominal · fundhub.ai" | static + session | Mostly decoration. The estimates line is a real disclaimer |

### W1 findings that change what we can cut

1. **The sidebar is not this screen's to cut.** It lives in `shell.js` and is injected into
   every screen. Removing groups there changes the whole app, not the Closer Dashboard.
   shell.js:210-232 records a deliberate decision to give every staff role the full sidebar,
   with the reasoning that narrowing it "bought no security" and cost navigation.
   **This is the single biggest source of on-screen clutter and it is OUT of the named scope.
   Must ask Chris.**
2. **The shift stat tiles are already hidden.** They contribute nothing on screen today.
   Removing the markup is a zero-visual-change cleanup.
3. **The main area is already fairly lean**: pipeline (2 rows), two calculators, one collapsed
   breakdown. The overwhelm is more likely the chrome around it plus the overlap with cockpit.
4. **Stale claim to note, not fix:** the `NOT_SOURCED` banner (line 851) still tells the closer
   "today's pipeline ... not sourced yet", but `paintToday()` does read `/api/read/closer-now`.
   The banner is out of date. Out of scope — reporting it, not touching it.


## W2 cockpit inventory

Source: `public/app/closer-call.html` + `closer-call.js`, payload from
`GET /api/read/closer-call` -> `buildCockpit()` in `src/sales/cockpit.mjs`.
Second call to `GET /api/read/underwrite`. Saves via `POST /api/call-outcomes`.

| Block | What a person sees | Source | Live or stub | Also on dashboard? |
|---|---|---|---|---|
| Sidebar | same nav | `shell.js` | live | **YES — identical** |
| "C-01 / Closer" + shift chip | on-shift time | `shifts` table | live | no |
| KPI · Cash today | money collected today | `todayCash()` | live | dashboard tile exists but is `hidden` |
| KPI · Calls held | count + no-shows | `call_outcomes` | live | dashboard tile `hidden` |
| KPI · Close rate | % | deposits/held | live | no |
| KPI · Commission MTD | always "—" | hard-coded `null` | **permanent placeholder** | no |
| KPI · Pace to target | always "—" | not in payload at all | **permanent placeholder** | dashboard tile `hidden` |
| KPI · Unlogged | count, red when >0 | `countUnlogged()` | live | no |
| Client identity | name · business · stage | `clients`/`businesses`/`cards` | live | dashboard calls the SAME endpoint just to print the name |
| Temperature chip | nothing — `hidden`, no JS refs it | none | **dead markup** | no |
| Join call | opens `tasks.meeting_url` | live | live | no |
| Present | opens `present.html` in a NEW TAB (code comment says: so the closer keeps the cockpit) | client id | live | no |
| Send contract panel | wording picker, Send, Copy link | `read/contracts` + `POST /api/contracts` | live | no |
| "What they can get" — 3 bands | Conservative / Realistic / After optimization | `read/underwrite` | **always "—"** — `buildReport()` returns no `funding`/`projections` key, so the empty branch fires every time | no |
| Band caption | "N lenders match this file" | `matchForClient()` | live | **YES — dashboard has the same count as a big tile** |
| "Where they stand" | credit scores, utilization, inquiries, derogs | `summarizeCrs()` | live when a pull exists | no |
| Credit note (blue) | "Credit facts load from the live file." | static | **stale — stays up after real scores paint** | no |
| "The deal" | latest payment, product, success fee 10% | `transactions`; 10% hard-coded | fee is a hard-coded default | **YES — dashboard's fee is an editable input that drives real math** |
| "The deal" static rows | Net cash to them, Monthly min, Downsell | static | **never carry a value here** | **YES — these are real computed outputs on the dashboard** |
| Month-14 cliff paragraph | fixed warning text | static | never data-driven | **YES — dashboard has a live cliff alert box** |
| Pre-call context | wants / for / guessed FICO / last message | `buildPrecall()` | live | no |
| Rail · Up next | up to 5 future calls | `upcomingCalls()` | live | **YES — dashboard "Today's Pipeline" is the same tasks, LIMIT 2, from start of today** |
| Rail · Gone quiet | stale deposits >7d | live | live | no |
| Rail · Before you close | 4 checkboxes + never-say line | static labels, posted on save | live on write | no |
| Logbar | 5 outcome buttons (hotkeys 1-5), 8 belief buttons, Save · next call | `POST /api/call-outcomes` | live write | no |

### Overlap — same fact on both screens

1. Left nav — identical.
2. Who the closer is — cockpit chip vs dashboard who-strip AND dashboard footer. Three places, two sources.
3. Which client — dashboard fires the whole cockpit payload just to print the name.
4. Booked calls — cockpit "Up next" (<=5, future) vs dashboard "Today's Pipeline" (<=2, from today's start).
5. Lender match count — two endpoints computing the same number.
6. Success fee 10% — cockpit read-only row vs dashboard editable input that drives the math.
7. Month-14 cliff — cockpit fixed paragraph vs dashboard live alert box.
8. Shift stats — cockpit's 6 tiles vs dashboard's 4 tiles that are `hidden` and never shown.

### Genuinely call-time on the cockpit

Join call · Present · client identity · pre-call context · credit table · the deal panel ·
month-14 cliff line · before-you-close checklist · send contract · outcome + belief buttons + Save.

### NOT call-time on the cockpit

The 6 KPI tiles (shift self-scoring; two of them can never show a number) · shift chip ·
"Up next" (explicitly excludes the current client) · "Gone quiet" (follow-up work, unrelated
to whoever is on the line).


## W3 blast radius

**Two scope facts up front.**

1. `closer-dashboard.html` has **no `data-testid` attributes at all.** Every test hooks it by
   DOM id, CSS class, or literal text — so cuts break *static markup* assertions, not behaviour.
2. **No closer id appears in `docs/workflows/live-playwright-100.md`.** Verified by grep: zero
   hits for "closer". So the answer to "required live Playwright id?" is **no for every block**.
   Cutting from this screen cannot lower the 100/100 score.

| Dashboard block | Tests that assert on it | Required live id? | Intended journey requires it? |
|---|---|---|---|
| Sidebar | `e2e/integration-round.spec.mjs:112` (null-tolerant) | no | not mentioned |
| Topbar (org pill, clock, LIVE pill) | `closer-ui-honest.test.mjs:34`; `e2e/sales-dashboards.spec.mjs:228` (`.clock`) | no | not mentioned |
| Who chip | `closer-ui-honest.test.mjs:23`; `e2e/sales-dashboards.spec.mjs:222` | no | not mentioned |
| Stat tiles (already `hidden`) | `closer-ui-honest.test.mjs:26` pins `class="stat-tiles" hidden` | no | not mentioned |
| Today's Pipeline | `e2e/sales-dashboards.spec.mjs:223,253,254,255` | no | not mentioned |
| Calculator chrome | `closer-dashboard-view.test.mjs:414,460,461`; `closer-ui-honest:22,25,27`; `e2e/sales-dashboards:220,221` | no | **owner-protected** |
| Deal Funding Calculator | `closer-dashboard-view.test.mjs:444-452,416,464-467` | no | **owner-protected** |
| Lender matches tile | `e2e/lenders-inquiry-ops.spec.mjs:33,34`; `closer-ui-honest:38` | no | not mentioned |
| Deal Math Calculator | `closer-dashboard-view.test.mjs:444-452,457`; `closer-ui-honest:29` | no | **owner-protected** |
| Breakdown wrapper | none asserts `id="breakdown"` | no | not mentioned |
| - waterfall table | `closer-dashboard-view.test.mjs:415,445,453` | no | not mentioned |
| - payback comparison | `closer-dashboard-view.test.mjs:447,454,456` | no | not mentioned |
| - D-03b table | `closer-dashboard-view.test.mjs:459` | no | not mentioned |
| - D-04 table | `closer-dashboard-view.test.mjs:455,458` | no | not mentioned |
| Footer status bar | **NONE — zero references anywhere** | no | not mentioned |

### Safe with zero test changes

- **Footer status bar.** No test references it by hook or by text. `paintStaff` writes to it
  but both writes are null-guarded, so removal is silent.

### RUNTIME LANDMINE — reads as safe, is not

`closer-dashboard.html:610-613` binds input listeners **without a null guard**:

```js
$('iDraw').addEventListener('input', ...);
$('iDrawRange').addEventListener('input', ...);
['iGuard','iDeposit','iFee','iDebts','iMin'].forEach(function(id){ $(id).addEventListener('input',recompute); });
```

Removing ANY of those seven inputs throws a TypeError on page load. That trips `assertPageAlive`
in `e2e/harness.mjs:264-270`, which kills **every** closer-dashboard spec at once. Any cut that
touches a calculator input must strip these bindings in the same diff. (The live-data wiring at
:1302-1308 IS guarded — only this older fallback block is not.)

### Biggest blast radius

Deleting the breakdown `<details>` **with its tables** fails six assertions inside one test,
`closer-dashboard-view.test.mjs:438` ("every DOM hook the wiring writes into is still in the
markup"), plus `:415`. The wrapper element alone is free; the contents are not.

### Intended journey

**No block is required by `docs/journeys/role-closer-intended.md`.** That file is entirely
route-level — it names categories and counts ("The dashboard (4 routes)"), never a UI block,
screen region or DOM id. So CLAUDE.md §4 does not block any cut here, and equally cannot
authorize one. The file's own header admits it was generated from the same route data as
`-actual.md`, so it is not a UI-level source of truth.

Routes behind the blocks are all reachable for `closer` per `role-closer-actual.md:135,137,143,153,165`.
Removing a block does not remove a route — but if a cut deletes an `FHData.read(...)` call and
that route stops being exercised, `role-closer-actual.md` must be updated in the same commit.

### Does a cut require changing `src/http/closer-dashboard-view.mjs`?

**No.** The module is pure and DOM-free. Its test file, however, doubles as a markup-shape test
(`:406-468` read the HTML, not the module) — that is where static breakage lands.

**Do not touch anything between `/* FH-VIEW-BEGIN */` (line 635) and `/* FH-VIEW-END */`
(line 874).** That region is a verbatim twin of the module; the test slices it out and diffs
both against the same fixtures.

### Files in the brief with zero blast radius on this screen

`closer-deck-endpoints.test.mjs`, `closer-deck-present.test.mjs`, `closer-now.test.mjs`,
`closer-deck.test.mjs` — none reads `closer-dashboard.html`.


## W4 before capture

Done 2026-08-17. Live site only. Screenshots only — the audit harness ran with `--no-clicks`, so
nothing on either screen was clicked and nothing was written anywhere.

**URLs captured (signed in as `closer@fundhub.ai`, live):**

- https://fundhub.ai/app/closer-dashboard.html
- https://fundhub.ai/app/closer-call.html
- Sign-in through https://fundhub.ai/login.html (password read from the gitignored `.env` by the
  harness, never printed). Both loads returned 200, no bounce to login, 0 failed API calls,
  0 console errors.

**Saved pictures** (`docs/workflows/closer-call-surface-2026-08-17-evidence/before/`):

- `closer-dashboard-1440-fold.png` · `closer-dashboard-1440-full.png` ·
  `closer-dashboard-390-fold.png` · `closer-dashboard-390-full.png`
- `closer-call-1440-fold.png` · `closer-call-1440-full.png` ·
  `closer-call-390-fold.png` · `closer-call-390-full.png`
- Harness originals with the DOM read: `docs/workflows/ui-audit-evidence/closer-dashboard-before/`
  and `docs/workflows/ui-audit-evidence/closer-call-before/` (each has `audit.md` + `audit.json`).

### What the closer actually sees — Closer Dashboard (1440 wide)

Top to bottom, every box in order:

1. **Top bar.** "fundhub." logo, a collapse arrow, breadcrumb "Fundhub / Closer Dashboard",
   "Org: Fundhub", the live clock "Mon, Aug 17, 11:32:14 PM EDT", a green "LIVE" dot,
   a "Search ⌘K" box, then "TEST — Closer Role · closer · 13 tabs", a green "LIVE" badge,
   and "Sign out".
2. **Who-you-are strip.** A round avatar, "TEST — Closer Role", and the word "closer".
3. **Left sidebar.** Group "Sales" open with 5 rows: Pipeline, Closer Dashboard (highlighted,
   starred), Call cockpit, My numbers, Calendar. Below it three closed groups: Funding,
   Client ops, Automation. A small "fundhub" health dot sits at the bottom.
4. **"Today's pipeline".** A table header — Client · Stage · Next · When — and one line of text:
   "No booked calls for you right now."
5. **"Deal calculators"** — two cards side by side.
   - Left card **"Deal Funding Calculator"**, grey note on the right "how much they can access".
     Inside: a big "Total Available Credit" box showing a dash; a "Lender matches (live list)"
     box showing a dash and the words "Import lenders to see a real count"; two typed fields
     "Requested draw" (0) and "Guardrail threshold %" (30); a slider parked at the far left;
     and a pink strip at the bottom showing a dash.
   - Right card **"Deal Math Calculator"**, grey note "can they afford it every month".
     Inside: four typed fields — Deposit (0), Success fee % (10), Debts to clear (0),
     Min payment % (3); two result boxes "Net Cash to Client" and "Monthly Obligation", both
     showing a dash; the line "Net cash uses the numbers you type and the draw on this file.";
     and a pink strip showing a dash.
6. **"Show breakdown"** — one closed grey row with an arrow, labelled on the right
   "per-lender waterfall · payback comparison · per-card minimums".
7. **A large blank white area** — roughly the bottom third of the screen is empty.
8. **Floating "Chat" button**, bottom right, dark pill. It is the only filled button on the page.
9. **Footer strip.** "fundhub-closer · v1 · org: fundhub · test — closer role · these numbers are
   estimates — confirm the final terms with the lender" and, far right,
   "systems nominal · fundhub.ai".

Notes that matter for the cut:

- The whole page is 900px tall — it ends exactly at the fold. Nothing scrolls.
- **What you see is smaller than what the HTML holds.** The page's own read finds five tables —
  Client/Stage/Next/When, Lender/Limit/Balance/Headroom/Draw, Method/12mo/24mo/36mo, one unnamed,
  and Card/APR/Min. Payment — but only the first is on screen. The other four are folded away
  inside "Show breakdown".
- Everything numeric reads as a dash. The test closer has no booked calls and no lenders imported,
  so this is the empty version of the screen. With a real client loaded, the pipeline table and the
  calculator results fill in and the page gets taller. Judge the "too cluttered" complaint against
  that, not against these dashes.
- Only 4 text sizes in use; no error text, no fake sample data.

### What the closer actually sees — Call cockpit (1440 wide)

Top to bottom, every box in order:

1. **Thin header line.** "C-01 / Closer" with a small dash chip. The same
   "TEST — Closer Role · closer · 13 tabs · LIVE · Sign out" block floats over the top-right corner
   and overlaps the row of number tiles beneath it.
2. **A row of six number tiles**, all showing dashes: "Cash today" (highlighted peach),
   "Calls held", "Close rate", "Commission MTD" (with the note "see My numbers"),
   "Pace to target", "Unlogged" (with the note "clear before next call").
3. **Left sidebar** — identical to the dashboard, 5 Sales rows plus three closed groups,
   with "Call cockpit" highlighted.
4. **Main heading "No call right now"** with the line "No booked call right now.", and on the right
   a small status chip and a "Join call" button.
5. **"What they can get"** — three cards side by side, each showing a dash and the words
   "Waiting on UnderwriteIQ": "Conservative", "Realistic · round 1", "After optimization".
   Grey note on the right: "Pull status on file". Under them: "Live numbers only — no sample
   funding story."
6. **Two cards side by side.**
   - **"Where they stand"** — five labelled lines, each with a dash: Tri-merge, Utilization,
     Inquiries · 6mo, Derogatories, Chase 5/24. Blue strip at the bottom: "Credit facts load from
     the live file."
   - **"The deal"** — five labelled lines, each with a dash: Deposit today, Success fee · 10%,
     Net cash to them, Monthly min, Downsell. Pink strip at the bottom: "**Tell them about month
     14.** On minimum payments the balance starts growing. Skipping this is what causes refunds."
7. **"Pre-call context"** — the line "Loads from the live file when a client id is in the URL."
   then four empty labelled slots: Wants, For, Guessed FICO, Last message. Cream strip at the
   bottom: "No sample story. Live survey + pull only."
8. **Right-hand column** (runs the full height, separate from the main area):
   - "Up next" → "No upcoming booked calls" / "Calendar tasks show here"
   - "Gone quiet" → "None loaded"
   - "Before you close" → four unticked checkboxes: Call is recorded, Personal guarantee,
     Month-14 cliff, Bank decides, not us. Under them, small red text:
     "Never: guaranteed · won't affect credit · we have relationships · 0% forever".
9. **Floating "Chat" button**, bottom right. A "Search ⌘K" box sits in the bottom-left corner.
10. No footer strip on this screen.

Notes that matter for the cut:

- This page is 1059px tall — it runs past the fold, so the closer has to scroll during a call.
- The cockpit, not the dashboard, is the busier screen in this empty state: 19 controls across
  six stacked blocks plus a third column, and 12 different text sizes (the dashboard uses 4).
- Overlap with the dashboard is real and visible: both screens carry a deal-money block
  ("The deal" here vs. the two calculators there) and both carry a "what's next" list
  ("Up next" here vs. "Today's pipeline" there).
- On the phone-size shot, 24 pieces of text render smaller than 11px.
- Opened without a client id in the address, so every value is a dash. That is also what a closer
  sees if they open the cockpit from the menu instead of from a booked call.

## Owner decision (2026-08-17)

Asked which screen is the one working surface during a call. **Owner chose: the Call cockpit
is the call screen; the Closer Dashboard becomes the calculator screen.** Calculators stay —
owner-set, not revisitable.

Evidence that drove the question: the live capture showed the Closer Dashboard ends at the fold
with its bottom third empty (900px, no scroll), while the cockpit runs 1059px with 19 controls.
The owner's premise — "Closer Dashboard has too much information" — was the opposite way round.
The closer also sees 13 sidebar tabs live, not the 34 in the raw markup; `gateLinks()` narrows it.

## Change manifest

Committed inside `a41f2fe` (see the warning below — that is not this work's own commit).

| File | Change |
|---|---|
| `public/app/closer-dashboard.html` | −81 lines. Cut Today's Pipeline, the 4 hidden shift tiles, footer decoration (kept the estimates disclaimer), the org + LIVE topbar pills. Cut the JS they owned: `paintToday`, `whenText`, the `closer-now` read, the `paintStaff` footer writes. Cut 14 orphaned CSS rules and the `@keyframes livepulse` left behind. |
| `public/app/closer-call.html` | −41 lines. Cut the 6-tile KPI strip and the "Gone quiet" rail section. |
| `public/app/closer-call.js` | −42 lines. Cut the KPI painter, the unused `kpis` local, the "Gone quiet" painter (mandatory — the rail is addressed by index), and orphaned `pct()` / `humanNote()`. |
| `src/http/closer-ui-honest.test.mjs` | Stat-tiles assertion replaced with two STRICTER ones: the tiles and `#todayPipe` may not come back at all. |
| `e2e/sales-dashboards.spec.mjs` | Pipeline empty-text assertion → `toHaveCount(0)`. Removed the test that covered the deleted pipeline feature. |

**Not touched:** both calculators, the collapsed breakdown, the client name, `shell.js`, the shared
sidebar, `src/http/closer-dashboard-view.mjs`, and everything between `/* FH-VIEW-BEGIN */` and
`/* FH-VIEW-END */`.

**No journey file changed.** `scripts/journeys/extract.mjs` reads only `netlify/functions/api.mjs`,
`src/http/read-api.mjs`, `partner-read-api.mjs` and `dashboard-auth.mjs` — never screen HTML. A
UI-only cut is journey-neutral. `/api/read/closer-now` is still routed and still exercised by the
cockpit test at `e2e/sales-dashboards.spec.mjs:188`, so no route lost coverage. No CHANGELOG line.

## Proof

- `npm run lint` — clean, 1296 files.
- Closer unit + view tests — **77 pass, 0 fail** (`closer-ui-honest`, `closer-dashboard-view`,
  `closer-deck-present`, `closer-deck-endpoints`, `closer-now`, `closer-deck`).
- Baseline check: on a clean tree at `8659d5f`, `npm test` already failed 5 tests
  (org-filter, app-shell reachability, inline sidebars, journey extraction, journey staleness).
  These cuts add nothing to that list.
- Live "after" capture: **NOT DONE** — needs a deploy first, and the push is on hold.

## ⚠️ Blockers and open questions

**1. Concurrent session collision — the reason nothing is pushed.**
Another Claude session was working in this same checkout throughout. It committed repeatedly
(`8659d5f` → `a41f2fe`) and its final commit **swept this work into it**, so these closer cuts
live under the message "Update the journey maps for the Company Brain chat routes". The code is
correct; only the history is muddled. History was NOT rewritten — the other session is live.

`a41f2fe` is the single unpushed commit and it also carries that session's unfinished contracts,
sidebar, Finance OS and pipeline work. **Owner decided 2026-08-17: wait for the other session to
finish rather than push unverified work to the live site.**

**2. Agent error, recorded.** This session ran `git stash` to measure a clean test baseline. That
briefly removed the other session's uncommitted work from disk. It was restored; copies of the two
files it was actively editing are saved outside the repo. Do not use `git stash` in this checkout.

**3. Found, not fixed** (out of the named scope — owner has not asked for these):
- On the cockpit, the shell's "Sign out / 13 tabs" chip renders **on top of** the tiles beneath it.
  Visible in `before/closer-call-1440-full.png`. Removing the KPI strip moves what sits under it.
- The cockpit's "What they can get" bands can never show a number: `buildReport()` in
  `src/underwrite/report.mjs` returns no `funding` / `capacity` / `projections` key, so the empty
  branch in `closer-call.js` always fires. It will read "Waiting on UnderwriteIQ" forever.
- The dashboard fires the whole `read/closer-call` cockpit payload just to print the client's name.
- `closer-dashboard.html`'s `NOT_SOURCED` banner still claims "today's pipeline" is unsourced.
  That text is now doubly wrong: the pipeline is gone, and it had been live via `closer-now`.
- `closer-call.html` carries a `#fh-temp-chip` element that is `hidden` and referenced by no JS.

