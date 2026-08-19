# T10-04 — Unit A, affiliate counting

Branch `fix/T10-affiliate-partner`, worktree `/tmp/wt-T10`, based on `origin/main c860b8c`.

## What a user saw before

An affiliate opened their page and REFERRED, CLICKS, CONVERTED and PAID were all
dashes. The funnel card said clicks, sign-ups and funded deals were "not
connected to this page". OWED showed $0.

## What a user sees now

Real numbers, and where a number still cannot be known, the tile says so.

Screenshot: `affiliate-tiles-and-funnel-after.png` — the page rendered against a
fixture that returns one affiliate row (12 referred, 3 of them untracked, 4
converted, 2 of those unrated, 0 clicks, 0 settled payout runs).

| Tile | Shows | Caption |
|---|---|---|
| REFERRED | `12` | lifetime leads attributed to your code |
| CONVERTED | `4` | 44% of 9 tracked · 3 more not tracked here · 2 with no rate set |
| OWED | `$0.00` | accrued, not yet paid · 2 conversions have no rate set, so nothing accrued for them |
| PAID | `$0.00` | no payout run has settled yet |
| CLICKS 30D | `—` | not recorded yet |

The funnel card now renders CLICKS → REFERRED → CONVERTED, with the clicks bar
at a dash and "not recorded yet" underneath.

## The three honesty rules this unit had to hold

1. **An unrated conversion counts as converted and its money stays NULL.**
   `affiliate_commission_rules` ships empty and AF-04 is undecided, so "converted
   but no rate in force" is the normal case. `converted_count` counts it;
   `unrated_converted_count` carries the NULL to the screen. There is no
   `COALESCE(commission_due, 0)` anywhere in this change. Asserted in
   `src/http/affiliate-stats.pg.test.mjs`.

2. **Referrals are counted from BOTH sources.** `src/workflows/af-02-referral-ownership-capture.mjs`
   writes `clients.custom_fields.affiliate_tier1_owner` and has never written an
   `affiliate_referrals` row. 033's backfill ran once. Counting only the table
   would report a number that stopped growing when that migration finished.
   The read counts both and de-duplicates by client; `referred_untracked` names
   how many exist only on the client record.

3. **Zero clicks means "nothing records clicks", not "nobody clicked".** Until
   `public/start.html` calls the new endpoint, the CLICKS tile keeps its dash.

## Board requests (files this unit does not own)

### 1. `public/start.html` — fire the click before the redirect

Nothing calls `/api/public/affiliate-click` yet. The seam is built; this one
line closes it. Insert immediately before `if (ref) location.replace(dest);`:

```js
if (ref) { try { navigator.sendBeacon("/api/public/affiliate-click",
  new Blob([JSON.stringify({ ref: ref, source: "start-page" })],
           { type: "application/json" })); } catch (e) {} }
```

`sendBeacon` is used because the page redirects immediately afterwards and a
normal `fetch` would be cancelled mid-flight. It is fire-and-forget: it cannot
delay or block the redirect, and a failure is silent by design — a visitor must
never be held up by our counting.

Until this lands, `affiliate_link_clicks` stays empty and the CLICKS tile keeps
its honest empty state.

### 2. `src/workflows/af-02-referral-ownership-capture.mjs` — the real blocker

**The referral pipeline is structurally broken upstream of this screen.** af-02
records first-touch ownership by patching `clients.custom_fields` and never
writes an `affiliate_referrals` row. `src/affiliates/economics.mjs` `attribute()`
and `convert()` are imported by nothing outside their own tests. So:

* no referral ever reaches `status = 'converted'`,
* `commission_due` is never calculated for anybody,
* `affiliates.balance_due` is trigger-derived from `affiliate_referrals` and is
  therefore structurally 0 for every affiliate on the platform.

This unit works around it for COUNTING (both sources are read), but it cannot fix
CONVERSION: a client with no referral row has no conversion state at all, which
is exactly what `referred_untracked` reports.

The change: after af-02 writes `affiliate_tier1_owner`, call
`attribute(db, { orgId, affiliateId, clientId, tier: 'direct', trackingIdUsed,
source: 'af-02', sourceEvent })` — resolving `affiliateId` from the tracking id
the same case-insensitive way 033's backfill does. `attribute()` is already
idempotent and non-stealing (`ON CONFLICT (client_id, tier) DO NOTHING`), so it
is safe on replay. That file belongs to another thread.

### 3. `docs/journeys/affiliate-actual.md` + `docs/journeys/CHANGELOG.md`

Not owned by this unit and deliberately not touched (shared files, 18 parallel
threads). The affiliate journey gains one reachable endpoint:

* `POST /api/public/affiliate-click` — unauthenticated, called by `/start`
  before the redirect (once board request 1 lands), writes one
  `affiliate_link_clicks` row.

And `GET /api/read/affiliates` — already listed as reachable by an affiliate at
`affiliate-actual.md:76` — now returns the counting columns. No new route is
opened to any role and nothing about who can reach what changed.

Suggested changelog line:

```
2026-08-19 | affiliate | Referral link clicks recorded; affiliate KPIs painted from /api/read/affiliates | T10-04: four tiles were dashes because no endpoint returned the numbers | <commit>
```

### 4. `CLICK_HASH_SALT` (Netlify env var) — optional, and safe while absent

`api/public/affiliate-click.mjs` writes `ip_hash` **only** when this is set.
An unsalted sha256 of an IPv4 address is reversible by brute force, so it would
be the address; with no salt the column stays NULL, meaning "not recorded". That
is the safe default and nothing breaks without it. This unit may not run any
netlify command, so it is not set.

## Tests

Run against a private scratch database `fundhub_t10_a` (local Postgres, socket
`/tmp:5432`), serially. Never `fundhub_ci`, never production.

```
node --test src/http/affiliate-stats.pg.test.mjs     8 pass, 0 fail
node --test src/http/affiliate-click.pg.test.mjs    10 pass, 0 fail
node --test src/http/routes.test.mjs                15 pass, 0 fail
node --test src/http/affiliates-self-read.test.mjs   \
            src/http/read-org-scope.test.mjs         8 pass, 0 fail
node --test src/affiliates/economics.pg.test.mjs    28 pass, 0 fail
node --test src/http/principal-reads.pg.test.mjs    11 pass, 0 fail
```

No existing test was weakened, skipped or deleted. No existing test asserted the
broken behaviour, so none had to be changed.

## The bonus defect

`public/app/affiliate.html` had 102 opening `div` tags against 103 closing ones:
the funnel card was missing its opening `card-hd`, so the unmatched closing tag
closed the card early and `card-bd` became a sibling of the card instead of its
body. Restored to the same shape the PAYOUT HISTORY header uses. Counts are equal
again, and the browser check above confirms `#funnelBody`'s parent is the
`.card`.

The header label was also changed from `CLICK TO FUNDED` to `CLICK TO CONVERTED`:
a conversion here is the first qualifying paid product, which is a funded
engagement **or** a paid repair enrolment, so "funded" named only half of it.

---

# Second pass — the verifier's findings, fixed

Reviewed at `docs/workflows/fix-2026-08-18/evidence/T10/verify/A-affiliate-counting.json`.
Six points, all addressed. Scratch database for this pass: `fundhub_t10_ra`
(local Postgres, socket `/tmp`). Never `fundhub_ci`, never production.

## 1. CONVERTED no longer prints a zero it cannot stand behind

A referral is **tracked** when a referral record exists for it, so the system can
see whether that person ever paid. It is **untracked** when all that exists is a
code left on the client's record — nothing follows those people, so nobody knows
what happened to them.

If every referral is untracked, the count of conversions is 0 for one reason
only: nothing is watching. The tile used to print that `0`, which reads as
"nobody you sent has paid" — something this screen cannot know and which is
often simply false. It now shows a dash and says why, in words:

> **CONVERTED —**
> we cannot tell yet · none of your 5 referrals are being tracked, so nobody knows who paid

Rendered proof: `honesty-2-all-untracked.png`, exact text in
`honesty-render.json`.

A true zero is still a zero: an affiliate with no referrals at all sees
`CONVERTED 0 · no referrals yet`.

## 2. One conversion rate on the screen, not two

The tile divided conversions by tracked referrals; the funnel bar under it
divided by every referral. Same data, two different percentages, and no way for
a partner to tell which was true. Both now use the tracked count and both name
it, so the same fixture reads `44% of 9 tracked referrals` on the tile and
`44% of 9 tracked` on the bar. The funnel also shows a dash and
"none of these are tracked yet" in the case above, matching the tile.

Rendered proof: `honesty-1-normal-tracked.png` and `honesty-2-all-untracked.png`.

## 3. A missing count is unknown, not zero

Two `|| 0` fallbacks turned a missing untracked count into 0, which made every
untracked referral look tracked and quietly widened the denominator. Removed.
When the untracked count does not arrive, the screen shows the conversions it
does know about and says plainly that it cannot work out what share that is.

Rendered proof: `honesty-3-untracked-count-missing.png`.

## 4. One client, one owner

`affiliate_referrals` is unique per client for a direct referral and cannot be
re-pointed after the fact, so a client with a referral record has exactly one
owner. The old code on the client's record can disagree — a corrected
attribution leaves the stale code behind — and the count claimed that client for
**both** partners. The referral record now wins; the stale code only ever adds
clients nobody's referral record claims.

New test: "a client is never counted for two affiliates at once". Against the
old SQL it fails with `expected 0, actual 1` — the disputed client appearing on a
second partner's REFERRED tile.

## 5. The lookup is indexed

`db/migrations/237_affiliate_referral_lookup_index.sql` adds the expression index
the referral match needs. Measured on 20,000 client rows in the scratch database:

| | plan for the client lookup | time |
|---|---|---|
| before | `Seq Scan on clients` | 7.18 ms **per affiliate row** |
| after | `Index Scan using clients_affiliate_tier1_owner_idx` | 0.014 ms |

The staff roster returns up to 200 affiliates, so that was up to 200 full passes
over the client table in one page load. No number on any screen changes.

## 6. Every test stands on its own

Both suites shared fixtures across tests, so some assertions were true only
because of the order they happened to run in. Fixed by construction, not by
weakening anything:

* `affiliate-click.pg.test.mjs` — `newAffiliate()` and `deadCode()` give every
  test its own code. `rows.length === 1` is now a fact about rows that test wrote.
* `affiliate-stats.pg.test.mjs` — alpha and bravo are read-only. The payout test
  and the clicks test each build their own affiliate before writing anything.

## Tests, this pass

```
node --test src/http/affiliate-stats.pg.test.mjs     9 pass, 0 fail
node --test src/http/affiliate-click.pg.test.mjs    10 pass, 0 fail
node --test src/http/routes.test.mjs                15 pass, 0 fail
npm run lint                                        1325 files parse clean
```

Nothing was skipped, deleted or weakened. One suite added a test.

## Known, not mine, not fixed

`src/affiliates/economics.pg.test.mjs` is flaky on this branch — it passed 28/28
on three runs and failed one subtest on two others, always in the commission-rule
selection tests, which share accumulated rule rows between tests. That file was
not changed in this pass and nothing changed in this pass is used by it. Worth a
separate look.
