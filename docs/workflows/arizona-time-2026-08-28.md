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
