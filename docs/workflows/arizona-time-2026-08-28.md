# Arizona time — 2026-08-28

**Owner ask:** "Make the time inside the CRM Arizona time — it's 3:03 right now, not Eastern."
Plus, on a second look at the screenshots: "make sure each page also has the top part."
Plus: "remove org: FUNDHUB, sounds dumb."

**Status: done in one session.** The split below was proposed; Chris said finish it all here,
so all three workflows were run by this thread rather than handed out.

---

## What Arizona time means here

Arizona is `America/Phoenix`. It is 3 hours behind Eastern in summer and 2 hours behind in
winter, because **Arizona does not change its clocks for daylight saving and the East Coast
does**. That second fact is why several things in here got *simpler*, not just shifted: a
window pinned to Arizona sits still all year, where the old Eastern one moved twice.

Every clock now reads e.g. `Fri, Aug 28, 3:05:43 PM MST`.

---

## Task list

| # | Unit | Owner | Status |
|---|------|-------|--------|
| W1 | Clocks and timestamps on CRM screens | this thread | done |
| W1b | A clock in the top bar of every staff screen | this thread | done |
| W2 | Which day a sale counts on | this thread | done |
| W3 | Text-message quiet hours | this thread | done — **COMPLIANCE REVIEW REQUIRED** |
| W4 | Remove the `org: fundhub` chip | this thread | done |

---

## W1 — Screens

11 files, 21 places, all display-only: `pipeline`, `calendar`, `galaxy`, `partner-galaxy`,
`client-control-panel`, `messaging`, `ops-admin`, `closer-dashboard`, `lenders`,
`automations`, `inquiry-remover`.

## W1b — The missing top bar

Two separate faults, both fixed in `public/app/shell.js`:

1. **Fourteen screens never had a clock at all.** Nothing was hiding it — there was none in
   the markup. Affiliate, agent editor, brand studio, campaign manager, company brain,
   content admin, contracts, creative factory, documents, finance OS, hiring, products &
   commissions, social studio, staff teams.
2. **The screens that had one hid it on a laptop.** Pipeline hid it under 1600px wide,
   the client control panel under 1560px. That is why the pipeline screenshot showed no
   time whatsoever — the clock was there, the window was just too narrow for it.

The shell now mounts a clock where a page has none, and un-hides the ones a page hides. On a
narrow bar it drops the date and keeps the time rather than vanishing. It disappears only
below 900px, where the bar genuinely has no room.

Deliberately **not** touched: the client portal and the consent-capture page. Those are the
customer's screens, not staff screens.

## W2 — The sales day

`src/sales/metrics.mjs`. "Today" on the sales floor ran midnight-to-midnight **Eastern**,
which put every call logged after 9pm Arizona onto the next day's board. It is Arizona's day
now. `nyDateString` was renamed `localDateString` — a function called "ny" returning a
Phoenix date is the kind of name that gets trusted and then misread.

**Numbers move.** Anything logged between 9pm and midnight Arizona used to land on tomorrow
and now lands on today. Yesterday's board may not match a screenshot taken before this change.

## W3 — Quiet hours — COMPLIANCE REVIEW REQUIRED

`src/messaging/gate.mjs`. This is the "don't text people in the middle of the night" rule.

The old setting said **23:00–11:00 Eastern**. Read from Phoenix in summer that is exactly
8pm–8am — so the rule was already *meant* to be Arizona's 8-to-8, written in the wrong zone.
It now says what it means: **20:00–08:00 America/Phoenix**.

* **Summer behaviour is identical.** Every existing test instant lands on the same side of
  the boundary. Nothing about when a text goes out changes between March and November.
* **Winter gets slightly tighter.** The old pair widened to 9am–9pm Arizona once Eastern fell
  back. It is 8am–8pm year-round now.
* **The staff-facing wording changed** on the messaging screen and in the block reason:
  "Texting hours: 8:00am to 8:00pm Arizona time."

### The finding underneath it — not fixed, and not part of the ask

Quiet hours are measured in **one fixed company zone for every recipient**, whoever they are
and wherever they live. `gate()` and `nextQuietHoursEnd()` both accept a `timeZone` argument,
but `src/messaging/dispatch.mjs` never passes the contact's own — it always passes the fixed
constant. So a customer in Maine and a customer in Hawaii are held to Arizona's clock.

8pm Arizona is 11pm on the East Coast.

That was equally true before this change (Eastern was the fixed zone instead). It is recorded
here because it is the thing a reader of this file will want to know, and it is a separate
piece of work: it needs the recipient's timezone on the contact record, which is not there.

## W4 — `org: fundhub`

Removed from the status bar on calendar, messaging and pipeline. It was the only place it
appeared.

---

## Change manifest

**Screens** — `public/app/`: `automations.html`, `calendar.html`, `client-control-panel.html`,
`closer-dashboard.html`, `galaxy.html`, `inquiry-remover.html`, `lenders.html`,
`messaging.html`, `ops-admin.html`, `partner-galaxy.html`, `pipeline.html`, `shell.js`.

**Server** — `src/messaging/gate.mjs` (zone + hours + block wording; `easternHour` →
`hourInZone`), `src/messaging/dispatch.mjs` (comments), `src/messaging/compose.mjs`
(comment), `src/sales/metrics.mjs` (`nyDateString` → `localDateString`, SQL day boundaries),
`src/workflows/ai-set-01-josh-setter.mjs` (comment), `api/messages.mjs` (comment),
`netlify/functions/staff-message-sweeper.mjs` (comment).

**Tests** — `src/http/crm-html.test.mjs` (+5 new), `src/http/messaging-screen.test.mjs`,
`src/messaging/gate.test.mjs`, `src/messaging/dispatch.test.mjs`,
`src/messaging/dispatch-fence.test.mjs`, `src/messaging/compose.pg.test.mjs`,
`src/messaging/cutover-acceptance.pg.test.mjs`, `src/messaging/staff-sweeper.pg.test.mjs`,
`src/sales/metrics.test.mjs` (+2 new), `src/agents/runtime.test.mjs`,
`src/workflows/ai-set-01-josh-setter.test.mjs`,
`src/workflows/message-dispatch-sweeper.test.mjs`.

No routes added. No gates changed. No migrations. No journey rewritten.

## Test result

Measured on this branch, against a scratch Postgres 16 (`fh_az_scratch`) on this Mac, all
215 migrations applied to an empty database, connected as the database owner.

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| Before (HEAD, `d823820e`) | 6926 | 6913 | 13 | 0 |
| After | 6933 | 6921 | 12 | 0 |

Same failing files both times, minus one. **No failure was introduced.** The one that stopped
failing (`crm-html.test.mjs:82`) is another session's uncommitted copy edit to
`client-control-panel.html`, which rode along in this commit — not caused by this work.

One of the 12 is `superuser-guard.test.mjs`, which CLAUDE.md §12 documents as an artifact of
connecting as the owner rather than as `fundhub_app`.

---

## Visual proof — 2026-08-28

Run by a second thread. **This change went live while it was being measured**, so what follows
is measured on fundhub.ai itself, not on a stand-in. Nothing here was drawn by hand: every red
box in every picture comes from the browser's own measurement of that element, in the same
browser that took the shot.

**Short version.** The clock works. It is on all fourteen screens that had none, at 1920, 1440
and 1024, and it reads Arizona time. Three things are wrong, and all three are on the live site
right now.

### The three problems, worst first

**1. The account bar — the one with Sign out in it — now drops on top of the page.**

The clock does not cover the Search box, the LIVE pill or the account bar. Measured overlap is
**zero pixels, every screen, every width**. The problem is different: the top bar is a single
row that wraps when it runs out of room. Adding about 200px of clock to it pushes the account
bar onto a second line — and that second line falls *outside* the top bar's box, onto whatever
the page had drawn there.

| screen | width | account bar lands on (clock OFF) | account bar lands on (clock ON) | top bar height |
|---|---|---|---|---|
| affiliate | 1440 | nothing — still inside the top bar | div.lb "YOUR REFERRAL LINK" | 57px → 57px, bar on line 1 → 2 |
| agent-editor | 1920 | nothing — still inside the top bar | nothing — still inside the top bar | 75px → 133px, bar on line 1 → 2 |
| brand-studio | 1440 | nothing — still inside the top bar | div.stat "BS-00 / DOMAIN—not connected" | 57px → 57px, bar on line 1 → 2 |
| company-brain | 1440 | nothing — still inside the top bar | div.convo-hd "☰" | 57px → 57px, bar on line 1 → 2 |
| contracts | 1440 | nothing — still inside the top bar | div.card-hd "How this works" | 57px → 57px, bar on line 1 → 2 |
| creative-factory | 1920 | nothing — still inside the top bar | div.stat "JOBS IN FLIGHT00 running · 0 queued" | 57px → 57px, bar on line 1 → 2 |
| products-commissions | 1920 | nothing — still inside the top bar | nothing — still inside the top bar | 75px → 133px, bar on line 1 → 2 |
| products-commissions | 1024 | nothing — still inside the top bar | nothing — still inside the top bar | 131px → 189px, bar on line 2 → 3 |
| lenders | 1440 | nothing — still inside the top bar | nothing — still inside the top bar | 75px → 111px |
| consent-capture | 1440 | nothing — still inside the top bar | div.cc-wrap "← Back to Client Control Panel" | 57px → 57px, bar on line 1 → 2 |

Read the last column as "how tall the top bar is". Where it grows, everything below it moves
down. Where the bar drops to a new line, whatever is named in the fourth column is underneath
it. Eight screens; everything not listed here is pixel-identical with the clock on and off.

This is not guesswork about which element. Each one is whatever the browser reports directly
underneath the middle of the account bar. Pictures 10a, 10b, 11, 12.

**2. Two screens got a clock this file says they did not get.**

The file says the client portal and the consent screen were left alone. They were not. The rule
in the code checks *who is looking*, not *which screen they are on* — it skips the clock only
when the viewer is a client. The consent screen is only ever opened by staff, so it always gets
one. The client portal gets one whenever the owner opens it, which is a documented owner walk.
Pictures 3 and 4.

*Not checked:* whether a real client signing into their own portal sees a clock. The code says
no. It could not be proved, because client accounts sign in by an emailed link rather than a
password, so the harness cannot log in as one — the sign-in call answers 401. Marked
**UNVERIFIED** rather than assumed.

**3. `org: fundhub` is still on six screens.**

This file says it "was the only place it appeared". That is wrong. What was removed was the
grey strip along the bottom of three screens. The chip in the **top bar**, sitting right next
to the clock, was never touched, and neither were three more bottom strips. Still showing it on
the live site today: **calendar, messaging, client control panel, ops & admin, workflows
(automations), specialist (inquiry remover)**. The two galaxy screens also paint
`ORG: fundhub` into the picture they draw, where no text search finds it. Pictures 5 and 6.

### What passed

* **All fourteen screens that had no clock now have one** — at 1920, 1440 and 1024. Affiliate,
  agent editor, brand studio, campaigns, company brain, content, contract templates, creative
  factory, documents, finance OS, hiring, products & commissions, social studio, staff & teams.
* **Every clock reads MST.** No screen anywhere showed EDT or EST. Before the change the
  pipeline's hidden clock read `Fri, Aug 28, 7:10:53 PM EDT`; on the live site the same
  element now reads `Fri, Aug 28, 4:47:38 PM MST`. Pictures 1 and 2.
* **Exactly one clock per screen.** The eleven screens that already had their own kept theirs;
  the shell added a second nowhere. Counted on all 81 live shots.
* **The owner's own complaint is fixed.** Pipeline on a 1440px laptop showed no time at all.
  It now shows the time. Picture 2.
* **Zero overlap.** The clock never sits on top of Search, the LIVE pill or the account bar, at
  any width, on any screen.
* **Narrow windows drop the date and keep the time**, as designed: at 1024 the shell's clock
  reads `4:49:16 PM MST`. Picture 7.
* **The clock and the new staff photo button share the bar** without trouble. Picture 8.

### The merge conflict — real, and resolved correctly

While this work sat on its branch, separate work on `main` added a staff photo button to the
account bar, in the same place in `public/app/shell.js` that the clock went in. Git could not
combine them: `public/app/shell.js`, `docs/journeys/CHANGELOG.md` and
`src/workflows/index.test.mjs` all conflicted.

It was resolved before this report was finished, by keeping both blocks. **Checked, not
assumed:** the shell.js now on `main` is line-for-line identical in content to an independent
resolution made here — only the order of the two blocks differs, and both are function
definitions in the same wrapper, so the browser treats them the same. Both features are present
and both are called. Picture 8 shows them side by side on the live site.

### One thing that is NOT this change's fault

Measured on the branch on its own, before the merge, the account bar ran up to 886px off the
right edge of the screen on nineteen of the twenty-seven screens, taking **Sign out** with it.
That was not the clock: `main` had added a wrapping rule to `crm-sidebar.css` that the branch
predated. Merging removed it, and the live site does not have it. Recorded only so nobody
chases it as a clock bug.

### How this was checked

* **The live site, signed in once as `owner@fundhub.ai`.** Password read by the harness from
  the gitignored `.env`; never printed.
* **Read-only.** Every non-GET `/api/**` request was intercepted and answered 599. One write
  was attempted just by opening a screen — `POST /api/messages-outbound`, first seen on ops &
  admin — and it was blocked. Nothing this run did reached the live database.
* **Five passes, 378 screenshots**, at 1920×1080, 1440×900 and 1024×768:
  * `before` — the site as it was before the change shipped (54 shots). The historical baseline.
  * `after` — the branch's own files served in place of the deployed ones by Playwright, the
    pattern in `docs/workflows/e2e-round-2026-08-27-evidence/hole-18/_prove.mjs` (81 shots).
    Taken while the change was still unmerged.
  * `merged` — `main` plus the branch with the conflict resolved here (81 shots). Taken before
    the real merge landed; it turned out to match it.
  * `live` — the deployed site, nothing intercepted at all (81 shots).
  * `noclock` — **the control.** Today's live files with exactly one line switched off: the
    call that mounts the clock (81 shots). Same tree, same backend, same browser. Every
    difference between `live` and `noclock` is the clock and nothing else. That is where the
    table in problem 1 comes from.
* Two screens are opened with the test client id from the audit brief: client control panel and
  consent capture.

### Screen by screen — the live site

| screen | clock 1920 / 1440 / 1024 | zone | clocks on page | overlaps Search / LIVE / chip | account bar off the right edge | top bar rows (live → this) | org: fundhub |
|---|---|---|---|---|---|---|---|
| affiliate (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1440: 1→2 rows, 57→57px; 1440: account bar moved from line 1 to line 2 | gone |
| agent-editor (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1440: 2→2 rows, 133→131px; 1440: Search moved from line 1 to line 2 | gone |
| brand-studio (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1440: 1→2 rows, 57→57px; 1440: account bar moved from line 1 to line 2 | gone |
| campaign-manager (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1024: Search moved from line 2 to line 3 | gone |
| company-brain (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1440: 1→2 rows, 57→57px; 1440: account bar moved from line 1 to line 2 | gone |
| content-admin (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | gone |
| contracts (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1440: 1→2 rows, 57→57px; 1440: account bar moved from line 1 to line 2 | gone |
| creative-factory (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | gone |
| documents (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1024: 2→2 rows, 133→131px; 1024: Search moved from line 1 to line 2 | gone |
| finance-os (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | gone |
| hiring (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | gone |
| products-commissions (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1024: 2→3 rows, 131→189px; 1024: account bar moved from line 2 to line 3 | gone |
| social-studio (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1440: Search moved from line 1 to line 2 | gone |
| staff-teams (A) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1024: 2→2 rows, 133→131px; 1024: Search moved from line 1 to line 2 | gone |
| pipeline (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | gone |
| calendar (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | **still shown** |
| galaxy (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | gone |
| partner-galaxy (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | gone |
| client-control-panel (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | **1024: 408px past (also before)** | same | **still shown** |
| messaging (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | **still shown** |
| ops-admin (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | **still shown** |
| closer-dashboard (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | gone |
| lenders (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | 1440: 1→2 rows, 75→111px | gone |
| automations (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | **still shown** |
| inquiry-remover (B) | yes / yes / yes | MST | 1 / 1 / 1 | 0 / 0 / 0 | no | same | **still shown** |
| client-portal (C) | yes / yes / yes **<-** | MST | 1 / 1 / 1 **<-** | 0 / 0 / 0 | no | same | gone |
| consent-capture (C) | yes / yes / yes **<-** | MST | 1 / 1 / 1 **<-** | 0 / 0 / 0 | no | 1440: 1→2 rows, 57→57px; 1440: account bar moved from line 1 to line 2 | gone |

Group A = had no clock before. B = already had one. C = was supposed to have none.
"clocks on page" counts every visible clock; 1 at every width means no duplicate was added.
"top bar rows" compares against the site as it was before the change.

### Where the pictures are

Marked up with red boxes, numbered, with a caption legend on each image (CLAUDE.md §8):

`docs/workflows/arizona-clock-2026-08-28-evidence/shots/`

| file | what it shows |
|---|---|
| `01-pipeline-1440-BEFORE.png` | the owner's complaint: no time on a laptop |
| `02-pipeline-1440-AFTER.png` | the same laptop on the live site — clock present, reads MST |
| `03-consent-capture-1440-FAIL.png` | a clock on the consent screen, which was meant to be left alone |
| `04-client-portal-1440-FAIL.png` | a clock on the client portal when the owner opens it |
| `05-calendar-1440-org-still-there.png` | `ORG: FUNDHUB` still in the calendar top bar |
| `06-ops-admin-1440-org-still-there.png` | the same on ops & admin |
| `07-finance-os-1024-narrow.png` | the narrow face: time only, no date, nothing overlapping |
| `08-live-1440-pipeline.png` | the clock and the staff photo button in one bar |
| `09a` / `09b-products-1024` | top bar grows from two lines to three |
| `10a` / `10b-contracts-1440` | the account bar lands on top of the page |
| `11-affiliate-1440-covered.png` | the same on the affiliate screen |
| `12-creative-factory-1920-covered.png` | the same on a full 1920 monitor |

Raw unmarked shots and the per-element measurements behind every box are in `shots/_raw/`.
The harness is `_prove.mjs`, the marker is `_apply-marks.py`, the tables come from `_report.mjs`
and `_delta.mjs`. The folder is gitignored (`.gitignore:30`), so the images do not travel with
this file — they are on disk at the path above.

## Follow-up: the five the first sweep missed (same day)

The first pass swept for `America/New_York` and nothing else. That was the wrong
search, and it left five timestamps behind on staff screens:

| File | Was | What it shows |
|---|---|---|
| `pipeline.html` `fmtWhen` | `America/Los_Angeles` | date + time on a card |
| `inquiry-remover.html` ×2 | `America/Los_Angeles` | dates on inquiry rows |
| `messaging.html` `shortWhen` | `UTC` | which day a message arrived |
| `automations.html` | `UTC` | which day a run happened |

**Why nobody would have noticed until November.** Pacific is the same clock as
Arizona from March to November. Those three would have read correctly all
summer and then, on the day the rest of the country changes its clocks and
Arizona does not, started running an hour behind every other clock on the same
page.

**The two UTC ones were already wrong.** A message sent at 6pm Arizona is
tomorrow in UTC. So the one line whose whole job is saying *which day* something
happened was a day late every evening after 5pm.

**The guard is now positive, not a blocklist.** `crm-html.test.mjs` used to
assert "no `America/New_York`". It now reads every `timeZone:` on every staff
screen and fails on anything that is not `America/Phoenix`. A blocklist only
ever stops the zone somebody already thought of — this one caught
`automations.html` immediately, which a second hand-written grep had missed
because it used single quotes.

Found by checking the deployed site rather than the source tree: the live
`pipeline.html` was serving `America/Los_Angeles` next to `America/Phoenix` on
the same page.

## Three defects the visual proof found (same day)

Screenshotting the deployed site found three things the source diff did not.

**1. `org: fundhub` was still on six screens, in the top bar.** The first pass
removed three lowercase `<span>org: fundhub</span>` from *footer* strips and
recorded "it was the only place it appeared." That was wrong. A
`<div class="org-pill">Org: Fundhub</div>` sits inside `.topbar-right`,
immediately before the clock, on automations, calendar, client-control-panel,
inquiry-remover, messaging and ops-admin — which is the one the owner was
actually looking at when he asked for it to go. Removed, with its CSS rule.

**2. The clock landed on two customer screens.** `mountClock` gated on
`role === "client"` — who is LOOKING, not WHICH SCREEN. Consent capture is only
ever opened by a staff member, so the gate never fired and it got an office
clock. Now gated on the page as well, via `CUSTOMER_SCREENS`.

**3. The clock made three top bars wrap at 1024px.** Measured with the same page
loaded twice and only the `mountClock` call switched off:

| screen | 1920 | 1440 | 1024 |
|---|---|---|---|
| agent-editor | 0 | 0 | **+58px** |
| products-commissions | 0 | 0 | **+58px** |
| lenders | 0 | 0 | **+50px** |
| affiliate, brand-studio, company-brain, contracts, creative-factory | 0 | 0 | 0 |

Those three bars have already wrapped to two rows at 1024; the clock pushed them
to three and shoved the page down under them. The hide breakpoint moved from
900px to 1100px — where the bars start wrapping, not where the text stops
fitting. Re-measured after: zero delta on every screen at every width.

Worth recording honestly: the visual-proof run also reported content being
covered at 1440 and 1920 on affiliate, brand-studio, company-brain, contracts
and creative-factory. That did **not** reproduce in the measurement above, which
was run locally against a mocked session rather than signed in against the live
site. The 1024 growth reproduced exactly. The wider claims are neither confirmed
nor dismissed here — they were measured a different way, and the difference is
recorded rather than resolved.
