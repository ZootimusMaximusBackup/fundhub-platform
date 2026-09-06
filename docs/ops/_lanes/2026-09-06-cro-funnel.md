# The funnel chain - from an ad click to money

Read-only trace. Written 2026-09-06 from the code in this repo. No database was
touched. Where I could not tell from code alone, I wrote UNVERIFIED and said
what would settle it.

---

## The one-sentence answer

**Today Chris can ask "which ad produced booked calls" and get a real answer.
He cannot ask "which ad produced paying clients" — not because a link is
missing, but because nobody has written the query. The keys are all there.**

The money tables and the ad table both hang off the same `client_id`. Nothing
in the code joins them. That is the whole gap. It is a report that does not
exist, not a hole in the data.

---

## The chain, hop by hop

| # | Hop | Verdict |
|---|---|---|
| 1 | Ad click -> landing page | **BROKEN** - no click is recorded anywhere |
| 2 | Landing page -> form submit | **JOINED** - five UTM tags ride along in hidden fields |
| 3 | Form -> client record | **JOINED** on `client_ad_attribution.client_id` |
| 4 | Client -> booked call | **JOINED** on `bookings.client_id` |
| 5 | Booked call -> call result | **JOINED** on `call_outcomes.client_id` |
| 6 | Client -> money paid | **JOINED** on `transactions.client_id` |

Hops 3 through 6 all use the same key. Any two of them can be joined.

---

## 1. The ad click

**Nothing is recorded.** There is no clicks table, no page-view table, no
visitor table. The first time this system hears about a person is when they
submit a form.

The only click table in the whole database is `affiliate_link_clicks`
(`db/migrations/235_affiliate_link_clicks.sql`), and that counts affiliate
referral links, not ad clicks.

So click counts, cost per click and cost per lead have to come from Meta's own
reporting. This system cannot produce them.

## 2. The landing page and the tags

The ad URL carries five tags. The owner set the format on 2026-09-03:

- `utm_source` = fb
- `utm_medium` = paid
- `utm_campaign` = the lane (funding600, premium, sorting, uwiq, wl)
- `utm_content` = the ad id, as a number-slug like `42-ringlights`
- `utm_term` = the variant (sun, nosun, sedona)

A small script pasted into the ClickFunnels page reads those tags off the URL,
keeps them for the rest of that browser tab, and copies them into hidden boxes
on every form. File: `clickfunnels-fragments/06-utm-hidden-fields.html`.
First touch wins - a later page with no tags does not overwrite them.

Two things must be true in ClickFunnels itself for this to work, and neither
can be checked from the code:

- the script is actually pasted onto the live apply page
- five custom attributes named `utm_source` … `utm_term` exist in the
  ClickFunnels workspace

Both are **UNVERIFIED**. What would settle it: one real form submit, then look
at `client_ad_attribution` for that person's row.

## 3. The form becomes a client, and the ad is stored

ClickFunnels posts to the webhook. `src/adapters/clickfunnels.mjs` checks the
signature, then pulls the tags out of the payload. It looks in three places, in
this order of trust: an explicit `attribution` block, then the hidden form
fields, then ClickFunnels' own first-visit record. It emits `entry.captured`.

`src/handlers/client-lifecycle.mjs` `onEntryCaptured` then does two writes:

1. the raw tags into `clients.custom_fields` (a free-form blob, in place since
   2026-08-16)
2. one row in `client_ad_attribution` (the typed table, live since 2026-09-03)

The typed table is `db/migrations/286_client_ad_attribution.sql`. One row per
client, keyed on `client_id`. It stores the raw tags. The database itself works
out three extra columns and the app is not allowed to write them:

- `lane` - a real list of allowed values. Anything unrecognised becomes
  `unknown`, never blank.
- `ad_id` - the leading digits of `utm_content`. `42-ringlights` becomes `42`.
  Anything that is not a number-slug becomes blank on purpose, rather than a
  guess.
- `variant` - `utm_term`, cleaned up.

**From an ad id you can reach:** every client field (name, email, phone, stage,
tags, survey answers), every booking, every call result, every payment, every
funding round. All of it hangs off `client_id`.

**From an ad id you cannot reach:** how many people saw the ad, how many
clicked, and what it cost. Those numbers only exist inside Meta.

### Three real gaps in step 3

- **Only one door writes the row.** `onEntryCaptured` is the only writer. If a
  person's first contact is an appointment webhook or a booking form, the code
  emits `booking.created` and never `entry.captured`, and the booking payload
  does not carry the tags at all. That person becomes a client with **no ad
  row**. How often that happens is UNVERIFIED - count clients that have a
  booking but no `client_ad_attribution` row.
- **No backfill.** Migration 286 creates the table and stops. Leads captured
  before 2026-09-03 have their raw tags in the `clients.custom_fields` blob and
  no typed row. A backfill from that blob is possible and has not been written.
- **Failure is silent by design.** If the row write fails it is logged and the
  lead is still created. Correct choice, but it means a missing row is not an
  alarm.

## 4. The booked call

Bookings come from ClickFunnels. The word "calcom" in this codebase is a wrong
label from an old hardcoded string; migration 225 says that on the live database
on 2026-08-18, 27 of 31 bookings came from ClickFunnels and **none** from
Cal.com.

The table is `bookings` (`db/migrations/225_bookings.sql`). It has `client_id`,
which the handler fills by looking the person up by email and creating them if
they are new (`src/handlers/comms.mjs` `onBookingCreated`).

**Yes, a booking can be traced back to its ad.** The join, in plain terms: take
the booking, follow `client_id`, land on the ad row.

```sql
FROM bookings b
JOIN client_ad_attribution a
  ON a.client_id = b.client_id AND a.org_id = b.org_id
```

That exact join is already written and shipped, in
`src/ads/store.mjs` `adAttributionRollup`, behind
`GET /api/read/ad-books?group_by=lane|ad_id|variant|gate|entry|primary_offer|secondary_offer`.
It counts leads and booked calls per ad, ignores cancelled bookings, and can be
windowed by date. It is routed in `netlify/functions/api.mjs`.

**It has no screen.** Nothing in `public/app/` calls it. Today it is an address
you would have to type by hand. The only ad thing on a screen is the four-line
"what this ad promised" block on the closer's call view.

## 5. The call result

`call_outcomes` (migration 147) has `client_id`, an `outcome`
(deposit, downsell, callback, no_show, not_a_fit), `cash_collected_cents`, and a
link to the payment row. Same `client_id` key, so it joins to the ad the same
way. **JOINED.** Nothing joins it today.

## 6. The money

Three places money is recorded, all reachable from `client_id`:

- `transactions` - every payment. Written by `onPaymentReceived` from the
  Commas payment webhook. The buyer is matched by the payment link we minted,
  then by checkout metadata, then by email. If none of those work the payment is
  stored with **no client** and stays unattributed - deliberately, so nobody
  guesses. `amount_paid` is dollars, not cents.
- `funding_rounds` - `funded_amount` and `approved_amount` per round, with
  `client_id`.
- `call_outcomes.cash_collected_cents` - cash the closer took on the call.

**Yes, revenue can be traced back to an ad.** The chain is:

```
client_ad_attribution.client_id  =  transactions.client_id
client_ad_attribution.client_id  =  funding_rounds.client_id
```

Nothing in the repo runs either join. I searched every file that mentions
`client_ad_attribution`; the only join it takes part in is the one to
`bookings`. There is no revenue-by-ad query, endpoint, or screen.

The one weak spot: a payment whose buyer could not be matched has no
`client_id`, so it cannot be credited to any ad. How many of those exist is
**UNVERIFIED** - count `transactions` rows with a null `client_id`.

---

## The ad-spend trap

There **is** a spend table, `ad_metrics_daily`, and there **is** real Meta
insight-pulling code (`api/campaigns/sync.mjs` calls Meta's API). Do not get
excited yet. It is a different system.

- That table's `ad_id` points at a `partners`-owned `ads` row, created by
  syncing a connected Meta ad account. It is a long random id.
- `client_ad_attribution.ad_id` is Chris's own hand-numbered ad id from the URL
  tag - `16`, `42`, `26`.
- **The two never meet.** No column links them. Nothing in the code tries.

So even with spend flowing, "spend for ad 42" cannot be answered without a new
mapping between Chris's ad numbers and Meta's ad ids.

Also: that whole module is white-label partner machinery. It needs a partner
record and a connected ad account, and the auto-optimiser is off unless a
partner switches it on. Whether Chris's own Meta account is connected at all is
**UNVERIFIED** - would be settled by looking at `ad_platform_connections`.

One company-wide number does exist: `computeKpis` in `src/dashboard/kpis.mjs`
works out cost-per-funded from total spend divided by funded clients. It is
whole-company, not per ad, and it returns null with the reason
`ad_spend_unavailable` when no spend rows exist.

---

## What a person could actually learn today

Using only what is already built and reachable:

- Leads and booked calls per ad, per lane, per variant, over any date range -
  from `/api/read/ad-books`. This is the real one.
- Book rate per ad - books divided by leads, from the same answer.
- Which offer each ad promised, and whether it was a direct ad or a sorting ad -
  from `docs/ads/registry.json`.
- Which ads are running that nobody has filed - the same answer lists them under
  `unknown_ad_ids`.

What needs one new query, not new plumbing:

- Show rate, close rate and cash per ad - join `call_outcomes` on `client_id`.
- Revenue per ad - join `transactions` on `client_id`.
- Funded dollars per ad - join `funding_rounds` on `client_id`.

What cannot be answered inside this system at all:

- Clicks, impressions, cost per lead, cost per sale, ROAS for a named ad. Spend
  and Chris's ad numbers are not connected.

---

## For suggestions to Paul

The honest position. This system can tell Paul **what happened after the click**
per ad - leads, books, and (with one query) sales. Meta can tell him what
happened before the click and what it cost. Nothing today puts the two halves in
the same sentence, because the ad numbering used in the URL tag is not stored
against any Meta ad.

The cheapest fix, and it is not code: have Paul name every Meta ad so the name
contains the same number-slug that goes in `utm_content`. Then a spend export
and this system's numbers line up by hand on day one, and by code later.

---

## UNVERIFIED, and what would settle each

- Is the hidden-field script live on the ClickFunnels apply page, with the five
  custom attributes created? → One real form submit, then check for that
  person's `client_ad_attribution` row.
- Are rows actually landing? → `SELECT count(*), min(captured_at) FROM
  client_ad_attribution`. The table has existed since 2026-09-03 only.
- How many leads have no ad row (booking-first, or pre-2026-09-03)? → Count
  clients with a booking and no attribution row.
- How many payments have no client attached? → Count `transactions` with a null
  `client_id`.
- Is any Meta ad account connected? → Look at `ad_platform_connections`.
- Which ClickFunnels payload key the live workspace uses for the hidden fields
  (`custom_attributes` vs `custom_fields`). The adapter reads both, so this is
  low risk. Same single real submit settles it.

I did not connect to any database, so every one of these is open.

---

manifest
files touched: docs/ops/_lanes/2026-09-06-cro-funnel.md (created; no other file read or changed)
surprising: the ad-to-booking join is already written and shipped as /api/read/ad-books, with no screen calling it; and the spend table's "ad id" is a completely different thing from the ad id in the URL tag
could not verify: whether any attribution rows exist at all, whether the ClickFunnels page carries the script, and whether a Meta ad account is connected - all need a live database or one real form submit
