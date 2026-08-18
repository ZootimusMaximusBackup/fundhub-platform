# W-PAY findings (payment event path)

Ground truth for this machine is Chris’s 2026-08-18 board. Intended journeys do **not** name payment unlock. That gap is **MISSING**. Nothing here was invented to fill it.

Simulated client was **not** torn down. No card charge. No bureau call. Inngest was not sent.

## What ran

Local `registerAll` + `emit` for `payment.received` and `diagnostic.paid` on this file only. Two shapes: with `clientId`, and without `clientId` but with this email.

## Findings

1. **The event row only keeps a client if emit is told the id.** `emit()` writes `opts.clientId` or null. The live Commas path does not pass `clientId`. So live money events show `events.client_id` null. Same on this file when we omitted `clientId`. Evidence: `emits.json`, `events-fired.json`.

2. **Handlers can still find this file by email.** No `clientId` + this email still wrote two `$32` transactions on this client. No `clientId` and no email returns null. That last shape is the W10 “handlers do nothing” case. Evidence: `resolve-probes.json`, `after.json`.

3. **W10 was right about null `client_id`. W10 was wrong about “no email.”** The seven live payment rows we sampled all have an email key. Five match no client. Two match the forbidden live file (read only — we did not write there). The test file `8556…` has none of these events. Evidence: `live-payment-events.json`, `live-email-shape.json`.

4. **Paid flag was stamped.** `clients.custom_fields.crs_paid` went from empty to true. There is no `clients.crs_paid` column. The typed `client_custom_fields.crs_paid` column exists but has no row. Evidence: `before-after-delta.json`.

5. **The board card did not move.** It was already on Decision Rendered (step 6). Diagnostic Paid is step 5. The mover will not go backward. Evidence: `live-email-shape.json` (sort order), `before-after-delta.json`.

6. **Nothing unlocked.** Catalog is 5 items, all still locked (portal shows 6 tiles; one tile has no code). The product-to-unlock map (`product_entitlements`) is empty, so money cannot grant a tile. A sale row was written. No entitlement row. Evidence: `before.json`, `after.json`.

7. **Soft pull did not call a bureau.** This file has consent and no portal account. C-00 stopped at “no account.” Next call if an account existed: `requestSoftPull` then `runCrsPull`. We did not do that. Evidence: `soft-pull.json`, `c00.json`.

8. **Inngest C-00 was not sent.** The key name is present. This run skipped send. Local `handle()` returned `no_account_for_attribution`. If send were on, C-00 would-run.

## Score

| step | result |
|---|---|
| resolve path | PASS |
| before dump | PASS |
| live null client_id | PASS (null yes; W10 “no email” no) |
| emit both shapes | PASS |
| crs_paid stamp | PASS (json field only) |
| stage move | FAIL (stayed Decision Rendered) |
| entitlement 0/6 → n/6 | FAIL (still 0 held) |
| bureau refuse | PASS (stopped at no account) |
| c-00 | PASS (skip send; local no-account) |
| intended journey | MISSING |
