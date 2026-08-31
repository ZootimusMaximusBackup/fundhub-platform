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

Run by a second thread against the live site. **Nothing here was written by hand: every box in
every picture comes from the browser's own measurement of that element, in the same browser
that took the shot.**

**Short version.** The clock itself works. It is on all fourteen screens that had none, at all
three window sizes, and it reads Arizona time. Four things are wrong, and one of them stops
this branch from shipping at all.

### The four problems, worst first

**1. This branch will not merge. `public/app/shell.js` conflicts with `main`.**
While this work sat on the branch, `main` added a staff photo button to the account bar — in
the exact same spot in the same file where the clock was added. Git cannot combine them on its
own. Somebody has to open the file and keep both. It is a small, mechanical fix (delete three
marker lines, add one closing bracket), but until it is done nothing here reaches the live
site. Two other files conflict as well: `docs/journeys/CHANGELOG.md` and
`src/workflows/index.test.mjs`.

*Because of that, everything below was measured twice: once on the branch as it stands, and
once on a merged copy — `main` plus this branch with that conflict resolved. The merged copy
is what would actually go live, so that is the one the results below report.*

**2. Two screens got a clock that this file says they did not get.**
The file says the client portal and the consent screen were left alone. They were not. The
rule in the code checks *who is looking*, not *which screen they are on*: it skips the clock
only when the viewer is a client. The consent screen is only ever opened by staff, so it
always gets a clock. The client portal gets one too whenever the owner opens it — which is a
documented thing owners do. Pictures 3 and 4.

*Not checked:* whether a real client signing into their own portal sees a clock. The code says
no. I could not prove it, because client accounts sign in by an emailed link, not a password,
so the test harness cannot log in as one (the sign-in call answers 401). Marked UNVERIFIED
rather than assumed.

**3. `org: fundhub` is still on six screens.** This file says it "was the only place it
appeared". That is wrong. What was removed was the grey strip along the bottom of three
screens. The chip in the **top bar**, right next to the clock, was not touched, and neither
were three more bottom strips. Still showing it today: **calendar, messaging, client control
panel, ops & admin, workflows (automations), specialist (inquiry remover)**. The two galaxy
screens also paint `ORG: fundhub` into the picture they draw, which no text search finds.
Pictures 5 and 6.

**4. The clock takes the room the account bar needed, and the account bar drops on top of the
page.** The clock does *not* cover the Search box, the LIVE pill or the account bar — measured
overlap is **zero pixels on all 81 shots, at every width**. But the top bar is one row that
wraps. Adding ~200px of clock to it pushes the account bar — the one with **Sign out** in it —
onto a second line, and that second line falls outside the bar's own box, onto whatever the
page drew underneath.

On a 1440px laptop this is new on five screens:

| screen | what the account bar now sits on top of |
|---|---|
| contracts (Contract templates) | the "How this works" card header |
| affiliate | the "Your referral link" card header |
| brand-studio | the "BS-00 / domain — not connected" status row |
| company-brain | the chat header — "New chat", "owner", "Documents" |
| consent-capture | "← Back to Client Control Panel" |

Pictures 10a, 10b, 11. At 1024px the bar already landed on page content before this change, so
that part is not new — but **Products & Commissions grows from two lines to three, 131px to
189px**, which pushes the whole screen down. Pictures 9a, 9b. Lenders grows from one line to
two at 1440 (75px to 111px).

### What passed

* **All fourteen screens that had no clock now have one** — at 1920, 1440 and 1024. Affiliate,
  agent editor, brand studio, campaigns, company brain, content, contract templates, creative
  factory, documents, finance OS, hiring, products & commissions, social studio, staff & teams.
* **Every clock reads MST.** No screen anywhere showed EDT or EST after the change. Before the
  change, the pipeline's hidden clock read `Fri, Aug 28, 7:10:53 PM EDT`; after, the same
  element reads `Fri, Aug 28, 4:10:29 PM MST`. Pictures 1 and 2.
* **Exactly one clock per screen.** The eleven screens that already had their own kept theirs;
  the shell did not add a second anywhere. Counted on all 81 shots.
* **The owner's own complaint is fixed.** Pipeline on a 1440px laptop showed no time at all.
  It now shows the time. Picture 2.
* **Zero overlap.** The clock never sits on top of Search, the LIVE pill or the account bar, at
  any width, on any screen.
* **Narrow windows drop the date and keep the time**, as intended: at 1024 the shell's own
  clock reads `4:16:07 PM MST`. Picture 7.
* **The clock and `main`'s new staff photo button fit in the same bar** once the conflict is
  resolved. Picture 8.

### One thing that is NOT this change's fault

On the branch as it stands — without merging `main` — the account bar runs off the right edge
of the screen on nineteen of the twenty-seven screens, by up to 886px, taking **Sign out**
with it. That is not the clock. `main` added a CSS rule that makes a top bar holding the account bar wrap instead of
overflow, and this branch is older than that rule. Merge `main` in and it goes away. It is
recorded here only so nobody chases it as a clock bug.

### How this was checked

The change is not deployed, so it could not simply be opened on fundhub.ai. Playwright served
every `/app/` file from the branch while every `/api/` call still went to the live backend —
the same "prove a fix before deploying" pattern as
`docs/workflows/e2e-round-2026-08-27-evidence/hole-18/_prove.mjs`.

* Signed in once as `owner@fundhub.ai`. Password read by the harness from the gitignored
  `.env`; never printed.
* **Read-only.** Every non-GET `/api/**` request was intercepted and answered 599. One write
  was attempted just by opening a screen — `POST /api/messages-outbound`, first seen on ops &
  admin — and it was blocked. Nothing reached the live database.
* 216 screenshots: 81 on the branch tree, 81 on the merged tree, 54 on the live site as it is
  today, at 1920×1080, 1440×900 and 1024×768.
* Two screens are opened with the test client id from the audit brief: client control panel and
  consent capture.

### Screen by screen — merged tree (`main` + this branch)

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
"top bar rows" compares against the live site today.

### Where the pictures are

Marked-up evidence (red boxes, numbered, with a caption legend on each image):

`docs/workflows/arizona-clock-2026-08-28-evidence/shots/`

| file | what it shows |
|---|---|
| `01-pipeline-1440-BEFORE.png` | the owner's complaint: no time on a laptop |
| `02-pipeline-1440-AFTER.png` | the same laptop, clock present, reads MST |
| `03-consent-capture-1440-FAIL.png` | a clock on the consent screen, which was meant to be left alone |
| `04-client-portal-1440-FAIL.png` | a clock on the client portal when the owner opens it |
| `05-calendar-1440-org-still-there.png` | `ORG: FUNDHUB` still in the calendar top bar |
| `06-ops-admin-1440-org-still-there.png` | the same on ops & admin |
| `07-finance-os-1024-narrow.png` | the narrow face: time only, no date, nothing overlapping |
| `08-merged-1440-pipeline.png` | the clock and `main`'s new photo button in one bar |
| `09a` / `09b-products-1024` | top bar grows from two lines to three |
| `10a` / `10b-contracts-1440` | the account bar drops on top of the page |
| `11-affiliate-1440-covered.png` | the same on the affiliate screen |

Raw unmarked shots and the measurement JSON for every one of them are in `shots/_raw/`.
The harness is `_prove.mjs`, the marker is `_apply-marks.py`, the tables come from
`_report.mjs`. The folder is gitignored (`.gitignore:30`), so the images do not travel with
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
