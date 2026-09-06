# What can actually be tested and improved

Read-only look at every page a stranger touches before they book a call, and what
the system writes down about it. Nothing was changed. Everything below was read
out of the code, not out of a summary.

**The one-line answer.** You can already see *which ad brought a lead and whether
that lead booked a call*. You cannot see anything that happens **on** a page — no
page views, no drop-off, no step-by-step. And nothing joins the ad to the money.
There is no way to run two versions of a page against each other today.

---

## 1. The surfaces — where people actually land

There are **two** funnels, and only one of them is in this repo.

### Funnel A — ClickFunnels (apply.fundhub.ai). NOT in this repo.

This is the paid-traffic funnel. Meta ads point here. The pages themselves live
inside the ClickFunnels account. This repo only holds look-and-feel snippets that
somebody pasted into those pages by hand.

| Page | What a visitor does | Snippet in this repo |
|---|---|---|
| `/watch` | Watches the video | `clickfunnels-fragments/01-vsl.html` |
| `/apply` | Fills the application form | `02a-apply-top.html`, `02b-apply-bottom.html` |
| `/book` | Picks a call time | `04a-book-top.html`, `04b-book-bottom.html` |
| `/thank-you` | Confirmation, add to calendar | `05-thank-you.html` |

There is also `clickfunnels-fragments/06-utm-hidden-fields.html`. That one is not
decoration — it is the piece that carries the ad tag from the ad click into the
form. **It only works if it is actually pasted into the live ClickFunnels apply
page.** I cannot check that from here. See "Could not verify" at the bottom.

### Funnel B — fundhub.ai. Everything below IS in this repo.

| Page | File | What a visitor does |
|---|---|---|
| Homepage | `public/index.html` + `public/js/homepage-survey.js` | 8-step survey, then name/email/phone |
| Referral bounce | `public/start.html` | Lands from an affiliate link, gets pushed to `/watch` |
| Credit report page | `public/optimize.html` | Sends them to SmartCredit, or sells an "Assessment" |
| Education | `public/education/index.html` + `/enroll/` | Reads, then enrolls |
| Partners | `public/affiliates/index.html` | Reads, then applies to be an affiliate |
| White-label | `public/partner/index.html`, `/menu/`, `/trial/`, `/board/` | Reads prices, then buys |

Two more, off the money path: `public/careers.html` (job applications) and
`public/contract.html` (signing, after they are already a customer).

**One broken door.** `netlify.toml` line 187 sends `/lender-climate` to
`/climate/`. `public/climate/` on `main` holds exactly one file, and it is a map
data file — `us-states-paths.json`. There is no page there. The lending-climate
lead magnet has a working API (`api/climate.mjs`) and **no visitor-facing page in
this repo**. Anyone following that link today gets nothing.

---

## 2. What each surface writes down

Here is the honest version, surface by surface.

**The homepage survey records the finish and nothing else.**
`public/js/homepage-survey.js` draws all 8 steps in the browser. It makes exactly
**one** network call in the whole file, and it is the final submit to
`/api/public/survey-submit`. There is no "started", no "reached step 4", no
"abandoned". If someone quits on step 6, the system never knew they existed.

**The homepage survey also throws away the ad tag.** The submit body sends name,
email, phone, business, answers, and the page address — it does **not** send the
five ad tags (`utm_*`). And `api/public/survey-submit.mjs` never reads them. So a
lead from the homepage has **no ad attached to it**, ever. Only the ClickFunnels
form carries the ad tag through.

**The ClickFunnels pages record page views inside ClickFunnels, not here.** Our
database first hears about a person when ClickFunnels sends the webhook — that
is at form submit and at booking. Everything before that (who saw the video, who
started the form, who dropped off) is in the ClickFunnels account only.

**One tiny pixel exists.** `clickfunnels-fragments/05-thank-you.html` fires two
Facebook custom events, `AddToCalendar` and `OpenInboxConfirm` (lines 181 and
268). That is the **only** tracking pixel call anywhere in `public/` or the
fragments. There is no Facebook pixel, no Google Analytics, and no tag manager on
any page in this repo.

**`/optimize` records nothing at all.** `api/public/optimize.mjs` has zero
database imports and emits zero events. Somebody can land there, click through to
SmartCredit, and leave, and there is no record it happened.

**`/start` is the one page that records a visit.** It posts to
`/api/public/affiliate-click`, which writes a row to `affiliate_link_clicks`
(migration 235): the affiliate code, the time, the source, and hashed browser
details. No raw address is stored. Note the handler's own comment says "nothing
calls this yet" — **that comment is out of date.** `public/start.html` on `main`
calls it twice (beacon, then fetch fallback). The wiring is live.

**Partner apply, education enroll and partner checkout record the sale, not the
visit.** None of them capture the five ad tags. The white-label pages carry a
different set of codes (`track`, `a1`, `a2` in `public/partner/funnel.js`) for
affiliate credit — that is a separate system from the Meta ad tags.

### The one thing that IS joined, ad to booking

This part is real and it works.

1. Ad URL carries five tags. `utm_campaign` = the lane, `utm_content` = the ad
   number, `utm_term` = the variant (`sun`, `nosun`, `sedona`).
2. The pasted snippet copies them into hidden boxes on the ClickFunnels form.
3. ClickFunnels sends them in the webhook. `pickVisitAttribution` in
   `src/adapters/clickfunnels.mjs` reads them.
4. `onEntryCaptured` in `src/handlers/client-lifecycle.mjs` writes a row to
   `client_ad_attribution` (migration 286). The database itself works out the
   lane, the ad number and the variant — the app cannot disagree with it. First
   ad wins; a later visit never overwrites it.
5. `GET /api/read/ad-books` counts **leads and booked calls** per ad, per lane,
   per variant, per gate, per offer.

Migration 286 is on `origin/main`, so it is applied in production.

**But the report stops at the booking, and nobody can see it.**

- `src/ads/store.mjs` `adAttributionRollup` joins `client_ad_attribution` to
  `bookings` and to nothing else. It counts leads and books. It does **not**
  touch `sales`, `sale_payments`, or `funding_rounds`. So "which ad made money"
  is not answered.
- No screen anywhere calls `ad-books`. I searched all of `public/app/`. Only
  `ad-attribution` (one client at a time, on the closer's call screen) is drawn.
  The roll-up exists as a web address a developer can visit and nothing else.

### The second half of the funnel, which is a different system

`src/sales/metrics.mjs` already computes **show rate** and **close rate**
(booked → held → deposit → funded). Those feed the sales floor screen, the
closer's numbers, and the daily pulse.

The catch: "held" and "deposit" come from `call_outcomes` — a row a **closer
types in after the call**. If closers do not log, the second half of the funnel
is blank, and it will look like nobody bought.

So there are two working halves that never meet:

- ad → lead → booking (from `client_ad_attribution`)
- booking → held → deposit → funded (from `call_outcomes` and `sales`)

They share `client_id`. Joining them is a query nobody has written.

---

## 3. Split testing — is there any?

**No. Not one.**

I searched `src/`, `db/migrations/`, `public/` and `api/` for `ab_test`,
`abtest`, `split_test`, `experiment`, `variant_id` and `feature_flag`. Every hit
was something else — commission buckets, credit-bureau buckets, name variants on
a credit report. There is no code anywhere that shows one visitor version A and
another visitor version B.

**What about `sun` and `nosun`?**

Those are real, and they are worth understanding, because it is easy to think
they are more than they are.

- `docs/ads/registry.json` lists 24 ads. Most carry `"variants": ["sun","nosun"]`.
- The ad URL puts the variant in `utm_term`.
- Migration 286 turns `utm_term` into a `variant` column the database computes
  itself.
- `GET /api/read/ad-books?group_by=variant` counts leads and books per variant.

So `sun` vs `nosun` **is a real, countable test — of the ad, not of the page.**
It tells you which *creative* brought more booked calls. Both variants send
people to the exact same `/watch` page, the exact same `/apply` form, and the
exact same `/book` calendar. Nothing splits the page.

Put plainly: the label rides all the way through to a report. It just never
changes what the visitor sees after the click.

---

## 4. Speed — is anything measured against `docs/PERF-STANDARDS.md`?

**Not today, and not since 17 August 2026.**

There is no speed check in `package.json`, none in `.github/workflows/tests.yml`,
and no Lighthouse or web-vitals code anywhere in the repo.

There **was** a real measurement. `docs/workflows/archive/perf-audit-2026-08-17.md`
records a proper run: mobile, slow 4G, 4x slower processor, three runs each,
median reported. The raw reports are still on this machine at
`docs/workflows/perf-audit-evidence/`. That folder is excluded from git
(`.gitignore` line 30), so it is not in the repository and it is not on anyone
else's machine.

Here is what it found on the four ClickFunnels pages. The budget for a funnel
page is LCP under 2.0 seconds and a total page under 1.5 MB.

| Page | Load (LCP) | Page size | Verdict |
|---|---|---|---|
| `/watch` | 2.25s | 3.2 MB (2.6 MB video) | Over on both |
| `/apply` | 3.77s | 1.1 MB, 650 KB of it script | Nearly double the budget |
| `/book` | not measured | not measured | The tool returned nothing, 3 times |
| `/thank-you` | 2.29s | 590 KB, 386 KB script | Over on both |

The `/apply` number matters most. That is the page with the form. It took 3.77
seconds to show its main content on a phone. The standard's own note says every
extra second costs roughly 7-10% of conversions.

Three weeks have passed and some fixes were made in that window
(`perf-audit-evidence/funnel-watch/fix-2-vsl-autoplay/`), so **these numbers are
stale.** They are the last real measurement, not the current one.

---

## 5. What Chris could change tomorrow — and what he could not

### Could change tomorrow, and actually measure the result

**1. Which ad and which variant to spend on.**
Ask for `/api/read/ad-books?group_by=ad_id` and `?group_by=variant` for a date
window. You get leads and booked calls per ad. Paul can kill the losers on real
booked-call numbers instead of on Meta's own reporting. This works today with no
code change — it just needs somebody to fetch it, because there is no screen.

**2. Which lane and which offer to point traffic at.**
Same report, `group_by=lane`, `group_by=gate`, `group_by=primary_offer`. That
answers "does the 600-score gate book better than the open sorting hat".

**3. The ad creative itself.**
New ad, new number in `utm_content`, new row in `docs/ads/registry.json`. The
count shows up in the report on its own. This is the cheapest real test you have.

**4. Page speed on `/apply`.**
Re-run the Lighthouse harness that already exists, fix the slowest thing, re-run
it. It is a repeatable measurement and it is the one page where speed is worth
money. The three-week-old number said 3.77 seconds against a 2.0 second budget.

**5. Anything on the ClickFunnels pages, using ClickFunnels' own numbers.**
ClickFunnels knows its own page views. Our system does not. If the question is
"how many people saw the video and how many started the form", that answer is in
the ClickFunnels account today.

### Could NOT change and measure tomorrow

**1. Two versions of any page.** There is no mechanism. Nothing shows visitor A
one headline and visitor B another. Building one is real work, and it needs a
place to record which version each visitor saw.

**2. Drop-off inside the homepage survey.** The survey is 8 steps and reports
only the finish. "People quit on the money question" is not answerable. Nothing
records a step.

**3. Cost per booked call, or cost per sale, from inside this system.** There is
no Meta ad spend anywhere. `src/adplatforms/meta.mjs` has a `fetchInsights`
function that would pull spend, clicks and CPM — **and nothing in the entire
repository calls it.** The table it would fill, `ad_metrics_daily`, is built for
white-label *partners* running *their own* ad accounts, not for FundHub's. The
"$32-36 per booked call" figure in `docs/ads/CONTROLS.md` came from Meta Ads
Manager by hand, not from this system.

**4. Which ad produced revenue.** The chain from ad to sale is *possible* —
`client_ad_attribution.client_id` links to `clients`, which links to `sales` —
but no code walks it. The existing report stops at the booking.

**5. Anything about `/optimize`.** It records nothing. Not a visit, not a click
through to SmartCredit, not a purchase attempt.

**6. Whether the ad tags are arriving at all.** See below.

### The single most useful next step

Not a new screen. **Confirm the tags are arriving.** Every ad report above is
worth exactly zero if the hidden-fields snippet is not live on the ClickFunnels
apply page. That is one query against the production database:

```sql
SELECT lane, ad_id, variant, count(*)
  FROM client_ad_attribution
 GROUP BY 1,2,3 ORDER BY 4 DESC;
```

Rows with real ad numbers means it is working. An empty table, or every row
showing lane `unknown`, means the snippet never got pasted and the report has
been counting nothing. That takes a minute and it decides whether anything else
here is worth building.

---

## Manifest

**Files touched** — `docs/ops/_lanes/2026-09-06-cro-surfaces.md` (this file, new).
Nothing else was created, edited or deleted. No git commands beyond read-only
`log`, `ls-tree`, `show` and `cat-file`.

**Surprising** — (1) The homepage survey drops the ad tags on the floor; a
homepage lead can never be attributed to an ad. (2) `/api/read/ad-books` exists,
is routed, is tested against a real database, and no screen anywhere calls it.
(3) `/lender-climate` redirects to a folder with no page in it. (4) A working
Meta spend reader (`fetchInsights`) exists with zero callers. (5) The real
Lighthouse numbers are on this laptop but excluded from git, so they are
invisible to everyone else.

**Could not verify** — (a) Whether `06-utm-hidden-fields.html` is actually pasted
into the live ClickFunnels apply page. Settled by the SQL query above, or by
opening the ClickFunnels page editor. The project's own board already flags this:
`docs/workflows/ad-attribution.md`, last line under "Open". (b) Whether
`client_ad_attribution`, `affiliate_link_clicks` and `call_outcomes` hold any
rows at all — a table that exists is not data that is flowing, and I was told not
to touch the production database. Settled by one `count(*)` on each. (c) Current
page speed; the numbers quoted are from 2026-08-17 and fixes landed after them.
Settled by re-running `docs/workflows/perf-audit-evidence/_tools/lighthouse-audit.mjs`
against the four funnel pages.
