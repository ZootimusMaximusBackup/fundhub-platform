# What already reports, and what the repo says about Paul

Read-only pass. 2026-09-06. Nothing was built, changed, or deployed.

Everything below was read out of the code and the migration files. Where I could
not tell from code alone, I wrote **UNVERIFIED** and said what would settle it.

---

## The one-paragraph answer

A lot more is built than you would guess. There is a screen that shows Meta ad
numbers. There is an endpoint that already counts leads and booked calls **per
ad**. There is a rule engine that already says "refresh this ad." There is a
company scorecard that already divides ad spend by funded clients.

The gap is not screens. The gap is that **almost nothing is pulling the numbers
in on a schedule**, and **nothing joins an ad to money**. The chain stops at the
booked call.

---

## 1. What already reports on ads, campaigns and conversion

### The screens

| Screen | What it shows | Where the numbers come from |
|---|---|---|
| `campaign-manager.html` (Marketing → Campaigns) | Campaign list, spend against a daily ceiling, "needs attention", a fatigue table (ad, spend, impressions), an action log, and a per-ad daily drill-down with Spend / Impressions / Clicks / Conversions / Frequency / CTR / CPA / ROAS | Nine `api/campaigns/*` endpoints, all reading our own copy of Meta's data |
| `ops-admin.html` (Watch → Ops & Admin) | Company scorecard: cash collected, funded count, close rate, show rate, **cost per funded client** | `GET /api/dashboard/kpis` → `src/dashboard/kpis.mjs` |
| `galaxy.html` | Who is doing what right now. A presence feed | `api/read/company-activity`. **No ad numbers at all** |
| `creative-factory.html` | Makes creative. Approvals, jobs, library | `api/creative/*`. It is a factory, not a report |
| `content-admin.html` | Content tiles and uploads | `api/content/*`. No ad numbers |
| `partner-galaxy.html` | Partner home tiles | Partner tiles. No ad numbers |

There is no `command-center.html` in the app any more. It was deleted
(`docs/workflows/archive/delete-command-center-2026-08-17.md`). A wireframe file
still exists at `wireframes/command-center.html`; it is a drawing, not a screen.

### The endpoints that already answer conversion questions

- **`GET /api/read/ad-books`** — this is the closest thing to what you asked for.
  It counts **leads and booked calls grouped by ad**. You can group by lane, ad
  id, variant, gate, entry, primary offer or secondary offer, over any date
  window. Code: `api/read/ad-books.mjs`, SQL in `src/ads/store.mjs`.
  **No screen calls it.** I grepped all of `public/`. It is a live route with
  zero buttons pointing at it. You can only see it by typing the URL.
- **`GET /api/read/ad-attribution?client_id=`** — for one person: which ad
  brought them and what that ad promised. This one *is* wired: the closer sees
  four lines on `closer-dashboard.html`.
- **`GET /api/campaigns/fatigue`** — see section 3. It already gives advice.
- **`GET /api/campaigns/spend`** — today's spend against a ceiling you set.
- **`GET /api/read/ops-pulse`** — see section 3.

### Would they have rows today?

This is the honest part.

- **Leads and booked calls: yes.** `bookings` had 40 rows and `events` 790 rows
  when they were last counted (`docs/workflows/ads-revenue-model-2026-08-24-evidence/metrics.json`,
  pulled 2026-08-24 from production).
- **Which ad brought them: probably some, and it starts on 2026-09-03.** The
  table `client_ad_attribution` landed on `main` in commit `bf6d7bef` on
  2026-09-03. Only people who came in after that get a row. The writer runs
  inside the ClickFunnels lead handler (`src/handlers/client-lifecycle.mjs`).
  It reads the ad tags from the form's hidden fields **or**, if those are not
  set up, from ClickFunnels' own `visits.first_visit` record
  (`src/adapters/clickfunnels.mjs`, `pickVisitAttribution`). So a row appears
  either way. **UNVERIFIED:** whether the ad links actually carry the agreed
  tag format. Settled by: run `GET /api/read/ad-books?group_by=ad_id` as owner
  and look at `unknown_ad_ids`. If everything lands in "(none)", the links are
  not tagged.
- **Meta spend numbers: almost certainly zero rows.** See section 2.

---

## 2. The Meta numbers: what the tables hold, and whether anything fills them

`db/migrations/046_ad_platforms.sql` creates the whole shelf: connected ad
accounts, a copy of campaigns / ad sets / ads, a daily numbers table, an
append-only log of every automatic action, and spend ceilings.

### The daily numbers table — `ad_metrics_daily`

One row per ad per day. These are the exact columns a suggestion could be built
from:

- `spend_cents` — money spent (whole cents)
- `impressions` — how many times it was shown
- `reach` — how many different people
- `frequency` — average times per person
- `clicks`
- `ctr` — click-through rate
- `conversions` — purchases, leads and registrations added together
- `cpa_cents` — cost per one of those
- `roas` — return on ad spend
- plus `date`, `ad_id`, `partner_id`, `org_id`, `synced_at`

### What the sync actually stores — and what it throws away

`api/campaigns/sync.mjs` asks Meta for
`spend, impressions, clicks, ctr, actions, purchase_roas, date_start`.

It then writes **only five** of the nine numbers:
`spend_cents`, `impressions`, `clicks`, `ctr`, `roas`.

**`reach`, `frequency`, `conversions` and `cpa_cents` are never written.** The
translation function `normalizeInsight` in `src/adplatforms/meta.mjs` computes
all four correctly. The INSERT in `sync.mjs` just does not list them, and the
Meta request does not even ask for `reach` or `frequency`.

Why that matters, plainly: the Campaigns screen has columns for Conversions,
Frequency and CPA. Those columns will read blank or zero forever, no matter how
many times you sync. And the "refresh this ad, people have seen it too many
times" rule keys on `frequency` — so it can never fire. Only the click-rate rule
can. This is a small, contained bug, not a rebuild.

### Nothing runs the sync on a schedule

`api/campaigns/sync.mjs` is a POST. A person or a script has to call it. I
grepped `src/workflows/` — there is no cron job that syncs Meta. There is also
no scheduled run of the daily optimiser: `runDailyOptimization` in
`src/optimize/run.mjs` is called only by its own test file.

### Has it ever run for real?

Yes, once, by hand, and it worked.

On 2026-08-24 a script connected FundHub's own Meta ad account
(`act_982103620742368`, portfolio `1475597360226485`) to the CRM as a partner
called **Fundhub Direct**. The recorded output
(`docs/workflows/ads-affiliate-stack-2026-08-24-evidence/wire-meta-crm.jsonl`)
shows a live Supabase connection, an active row with a stored token, and Meta
returning **1 campaign, named `oSched: VSL: Funding`**.

A second script in the same folder (`_sync-own-meta.mjs`) pulls campaigns, ad
sets, ads and daily numbers into the tables. **UNVERIFIED: I found no recorded
output for it, so I cannot say it was ever run.** Settled by: open Campaigns,
pick partner "Fundhub Direct", and see whether the table has anything in it.

The last hard count is older and says zero: on 2026-08-18 an audit recorded
`ad_metrics_daily 0`, `campaigns 0`, `ads 0`, `ad_platform_connections 0`
(`docs/workflows/audit-crm-whole-2026-08-18-evidence/w11/row_counts.json`).
That count is from **before** the 08-24 wiring, so it does not settle today.

One more thing worth knowing: the Campaigns screen is **partner-scoped**. You
have to pick a partner from a dropdown before any number appears. FundHub's own
ads live under the partner "Fundhub Direct". Partners cannot reach the screen at
all (`public/app/shell.js` blocks it).

---

## 3. What already generates advice

Three things exist. Two of them run.

**A. Ad fatigue advice — built, routed, on screen.**
`api/campaigns/fatigue.mjs`. For each ad over the last N days it works out
frequency, click rate, spend and return, then stamps one of four words:
`refresh`, `queue`, `ok`, or `unconfigured`. The thresholds are not hard-coded —
they are read from a table called `optimization_rules`, so the screen and the
robot always agree. Seven rules are seeded by
`db/migrations/048_campaign_config.sql`: five are on, two are deliberately off
because nobody has chosen the number yet (the kill-switch spend floor, and the
refresh-cadence-by-spend-tier table). If a rule is off, the screen shows the
numbers and stays silent rather than inventing advice. That is good behaviour.
Caveat from section 2: the frequency half cannot fire, because frequency is
never stored.

**B. The daily robot — built, never scheduled.**
`src/optimize/run.mjs` can raise a winner's budget, cut a loser's, and step back
up when cost recovers. Every action is logged before it happens with an undo
attached. It is off by default per partner (`autopilot_enabled` defaults to
false) and **nothing calls it**, so it has never acted.

**C. The daily pulse and the two briefs — built, routed, plain-English.**
`GET /api/read/ops-pulse` returns a company pulse plus two written briefs
(`src/ops/briefs.mjs`). The ads part is deliberately thin. It says one of two
sentences: "Ad spend this window: $X. Read only." or "Ad spend is missing." And
it will open one "Look at ads spend" task a month, but only if a real spend
number is on file. `src/ops/meta-marketing.mjs` computes cost per booked call,
and refuses to give a number until there are enough booked calls and a real
spend figure — it returns `INSUFFICIENT` with the note "Do not invent a cost."

**D. Competitor ad intelligence — built, large, and not fed.**
`src/creative-intel/` is a full module: a classifier, ten derived signals, a
"Winner Score", and a saturation map of which angles are crowded. It is exposed
at `GET /api/adintel/board`. It works off **rented rows from vendors** — FundHub
never scrapes. The vendor list includes Apify and a `fixture` (fake data)
option. **UNVERIFIED: whether any real vendor is paid for and pulling.** Its own
header says the layer that joins FundHub's own ad numbers to real closes is
"NOT in this directory and is not built."

**What does not exist anywhere:** a written weekly ad brief for a person. No
file, no endpoint, no job produces one.

---

## 4. Paul Tancredi and DirectROAS

Every hit in the repo. Nothing else mentions them.

### Who he is, per the repo

Paul runs the ads. `docs/workflows/ads-revenue-model-2026-08-24-evidence/metrics.json`
records the ad account setup with `"operator": "Paul"`, campaign-level budget,
CBO on, pixel `2403674420141513`.

`docs/workflows/ads-affiliate-stack-2026-08-24.md` line 256 says it flatly:
**"Direct ROAS has full control on this ad account"** — and warns not to confuse
that partner with FundHub's own Conversions API system user. So Paul's agency
has hands-on access to the same Meta ad account the CRM reads.

### The numbers attached to his name

- 16 calls booked by 2026-08-15, at about **$33 per booked call**
  (`docs/workflows/archive/ads-revenue-model-2026-08-24.md`).
- Total Facebook spend $680; $322.89 through 2026-08-15
  (owner-provided, not pulled from Meta).
- `docs/workflows/ads-waterfall-projections-2026-08-26.md` uses **$33** as the
  live cost per booked call and notes it is already under the "good" line
  of $100.

### What he already receives, and in what format

Files and scripts, by hand. Not a dashboard.

- **Ad scripts.** `TODO.md` line 68, ticked: "Six Sedona ads to Paul (16, 6, 26,
  51, 42, 45)". Line 78, not ticked: "Film VSL, send to Paul."
- **Brand guidelines.** Two Google Drive documents made for him:
  "Fundhub Brand Guidelines (DirectROAS)" and
  `Fundhub_Brand_Guidelines_for_DirectROAS.pdf`
  (`docs/copy/Drive-Source-Index.md`).
- **He owes us something too.** `src/config/survey-qualification.mjs` says the
  survey field `cf_svy_has_negatives` is "pending from DirectROAS," and the
  qualification gate cannot fully work until it exists. The code handles the
  gap correctly — a missing answer goes to a human for review, never a silent
  pass or fail. A test locks that in.
- **Angles are outstanding.** `TODO.md` line 115: "The additional angles from
  Paul Tancredi", unticked.

### Does `docs/ads/CONTROLS.md` name a DirectROAS asset?

**Yes. One.** Line 14 lists `VSL_Script_DirectROAS_v1` among five assets marked
"Filmed and running." The file's first line is "LIVE — DO NOT EDIT" and it sets
the bar to beat: **$32–36 per booked call.**

An honest note on that: I can see the file says these five are running. I cannot
verify from this repo that they are running *right now* in the ad account.

---

## 5. If an agent had to write Paul a one-page brief tomorrow

### What it could honestly put in it

1. **How many leads and how many booked calls, per ad, for any date range.**
   Straight out of `GET /api/read/ad-books?group_by=ad_id`. Also groupable by
   lane, by variant (sun / nosun / sedona), and by the promise the ad made.
   This is real and it is joined — attribution to booking, cancelled bookings
   excluded, one lead counted once.
2. **Which ad ids we are seeing that we do not recognise.** The same call
   returns `unknown_ad_ids`. That alone is a useful line to Paul: "these links
   are not tagged the way we agreed."
3. **The company-wide funnel for the week:** new leads, booked, showed up,
   decision made, show rate, close rate. From `GET /api/dashboard/kpis`.
4. **Cost per funded client** — but only if ad spend rows exist. If they do not,
   the code returns the reason `ad_spend_unavailable` rather than a made-up
   number.
5. **The bar to beat: $32–36 per booked call**, and the five named ads that set
   it.

### What would be blank

- **Spend, impressions, clicks, cost per result.** Nothing pulls them on a
  schedule. Somebody has to POST the sync. Until then every money-per-ad line is
  empty. (One person, one call, and this fills in.)
- **Frequency, reach, conversions and CPA — blank even after a sync**, because
  the sync does not store them. This is the bug from section 2.
- **Revenue by ad. Completely missing.** This is the big one, and it is not a
  small bug. Nothing in the repo joins `client_ad_attribution` to
  `transactions` or `funding_rounds`. The chain runs
  ad → lead → booked call, and **stops**. So the brief can say "ad 42 booked 9
  calls." It cannot say "ad 42 made $X" or "ad 42's calls closed at Y%." A media
  buyer optimising to booked calls instead of to closes is optimising to the
  wrong end of the funnel — and right now booked calls is all we can give him.
- **Which competitor angles are crowded.** The module is built but I cannot show
  it has any rented rows in it.
- **Anything about the last few months.** Attribution rows only start
  2026-09-03. Before that, which ad brought a person is only in a loose text
  blob on the client record, not something you can group by.

### The shortest path to a real brief, in order

1. Call the sync once and see if numbers land. Costs nothing, proves the pipe.
2. Store the four dropped columns in `sync.mjs`. Small, contained.
3. Join attribution to money. This is the only real piece of new work, and it is
   the one that turns "booked calls per ad" into "dollars per ad."

I am not proposing any of these. Listing them because you asked what is blank.

---

## Manifest

- **Files touched:** `docs/ops/_lanes/2026-09-06-cro-reporting.md` only. No code, git, or database was changed.
- **Surprising:** `GET /api/read/ad-books` already counts leads and booked calls per ad and no screen in the whole app calls it; and `sync.mjs` correctly computes frequency, reach, conversions and CPA, then drops all four on the floor at the INSERT.
- **Could not verify:** whether `ad_metrics_daily` has any rows today, whether the live ad links carry the agreed UTM tag format, and whether any paid competitor-ad vendor is actually feeding `src/creative-intel/`.
