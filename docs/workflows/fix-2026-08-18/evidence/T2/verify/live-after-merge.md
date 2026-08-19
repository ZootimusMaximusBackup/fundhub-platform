# T2 live proof, AFTER merge and deploy

Merge `279eae8`. Checked against **https://fundhub.ai** (not localhost) on 2026-08-19,
after the production deploy ran `node db/migrate.mjs`. Test client
`8556bedc-46e1-4d85-b0cd-a24adfee1521`. **No card was charged.**

## The two headline defects are fixed on the live site

| Item | Before (recorded 2026-08-18) | After |
|---|---|---|
| **T2-04** create a $32 pay link, as owner | **503** `commas_not_configured` | **200** — real link created |
| **T2-20** same call, as **closer** | **403** "limited to owner, admin, sales_manager" | **200** — link created |
| pay links on the test client | **0** | **2** |

Before-state evidence: `../repro/live-before-payment-links.json`.

## A real checkout session was minted — not a fabricated link

```
link 6b837d0d | amount_cents 3200 | status created | purpose diagnostic
   checkout_url  https://www.fanbasis.com/agency-checkout/fundhub-1/2qxJM…
link a9a53baf | amount_cents 3200 | status created | purpose diagnostic
   checkout_url  https://www.fanbasis.com/agency-checkout/fundhub-1/1pW7Z…
```

`amount_cents = 3200` is $32 in integer cents. `provider` and `commas_session_id` are both
populated, so this went through the FanBasis checkout-session API — **not** the URL-building
fallback, and nothing was invented.

**This also closes a blocker that was named as unresolvable from an agent session:**
`FANBASIS_CHECKOUT_API_KEY` was recorded as "present locally, live site still says not
configured". It **is** set in the live Netlify environment — proven by the fact that a real
session minted. (Confirmed by name only; no secret value was read or printed.)

Both links are `status=created` and were never sent. They are payable, so if they are not
wanted on the test client they can be expired from the CRM.

## Migration 181 applied itself on the deploy

`netlify.toml [context.production]` runs `node db/migrate.mjs && npm run guard:db` with
Netlify's own `MIGRATION_DATABASE_URL`. Verified in the live database afterwards:

```
diagnostic          $32.00     FIXED
card-stacking-dfy   $3000.00   variable   fee 10%
consulting-package  $1000.00   variable
repair-bundle       $1000.00   variable      <- was $2,000
repair-trial        $200.00    variable      <- new
funding-mastery     $5000.00   variable      <- new
inquiry-removal     (none)     variable

unlock map, 6 rows:
  diagnostic         -> credit-analysis-report
  card-stacking-dfy  -> funding-snapshot
  consulting-package -> metro2-letter-pack
  repair-bundle      -> metro2-letter-pack
  repair-trial       -> metro2-letter-pack      (owner-set: same pack, one round)
  funding-mastery    -> funding-mastery-course
```

Exactly the owner's numbers. **So an agent could not apply a migration by hand, but it did
not need to — the deploy does it.**

## Still true after the merge

- The **$5,000 tile still cannot open**: `MAP.FUNDING_MASTERY` is `null` in
  `public/app/client-portal.html`. Product and unlock code both exist now; one line is left.
- **"One round only" is not enforced.** The trial's grant is identical to the full package's.
- **`bookings` is still locked shut** on the live database — row lock on, no policy, so the app
  reads zero rows silently. Not a T2 table. BLOCKERS #13.
