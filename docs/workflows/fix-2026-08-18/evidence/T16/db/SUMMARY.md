# T16 Lane A — what the live database actually says

Read-only check against the live production database on 2026-08-18.
Nobody wrote anything. No names, emails, Social Security numbers, phone numbers or addresses were read or saved anywhere.

We connected the same way the app does — as the limited `fundhub_app` login — so what we saw is what the app sees.

## The short version

| # | What we checked | Answer | What we found |
|---|---|---|---|
| A1 | Who the app logs in as | CONFIRMED | The app logs in as a limited user. It cannot see past the per-row locks. Good — that means every number below is the app's real view. |
| A2 | The locks on all 175 tables | CONFIRMED | The board was right to the number: 147 wide open, 21 locked by partner, 6 shut completely, 1 read-only. |
| A3 | The 6 credit-dispute tables | CONFIRMED BROKEN | All 6 are shut. The app has permission to read them but a lock with no key attached blocks every row. The app sees 6 empty tables. The credit-dispute feature reads and writes nothing. |
| A4 | The `marketing` tables | CONFIRMED | 4 tables exist. The app cannot open the cupboard they are in, let alone read them. |
| A5 | The sign-in and file-storage tables | CONFIRMED SAFE | 31 tables exist there. The app is refused at the door on every one. Nothing is leaking. |
| A6 | Bank transactions with missing links | CORRECTED | Not a bug. The links were emptied by the database itself when demo clients were deleted. A backup link column survived on all 18 rows, exactly as designed. |
| A7 | Do deleted demo clients really leave? | CORRECTED | 2 of 3 deletes were completely clean. The third never deleted anything at all — that client is still sitting there with 13 pieces of its data. |
| A8 | Why deleting a client is slow or fails | CONFIRMED | 67 tables point at a client. 28 of them have no shortcut, so the database has to read them end to end. 7 of those also refuse to let the delete happen. |
| A9 | Do the database update files match? | CORRECTED | 162 updates applied, not 176. 176 is the highest file number, not a count. 2 are recorded with no file. |
| A10 | Rows pointing at things that no longer exist | CONFIRMED CLEAN | All 483 links checked. Not one broken. Nothing timed out. |
| A11 | Custom fields | CONFIRMED WORSE | 305 custom fields exist. Only 11 have ever been filled in. That is 3.6%. |
| A12 | Demo work not labelled as demo | CORRECTED | The one row the board named does not exist. But the wider problem is real: 61 rows belong to demo clients and are not marked as demo. |
| A13 | Eleven tables nobody seems to use | CONFIRMED | 9 of the 11 have no live code using them. 6 are both empty and unused. |

## The three things worth acting on first

**1. The credit-dispute feature is switched off and nobody noticed.**
Six tables have a lock on with no key attached. In this database that means "refuse everyone". The app has full permission on those tables — the permission is not the problem. The result is that the whole credit-dispute part of the product silently reads and writes nothing.

Someone already wrote the fix today: `db/migrations/200_dispute_rls_policies.sql`. It has not been applied yet.

**2. Deleting a demo client can fail silently and leave the client behind.**
One demo client (`cb6f5839...`) was supposed to be gone. It is not. The client record is still there, plus 13 pieces of its data across 6 tables. Four of those tables actively refuse to let the delete happen: contracts, contract signers, documents, and events.

The good news: a delete run through the product's own button minutes ago worked perfectly and left nothing behind. So the delete path is not broken everywhere — it is broken when those four tables hold rows.

**3. Deleting a client makes the database read whole tables.**
28 of the 67 links to a client have no shortcut index. The biggest is the events table with 878 rows and no shortcut. That is the likely reason a delete timed out.

## Things nobody had written down

* The two fix files (`200_dispute_rls_policies.sql`, `201_no_bare_rls_sweep.sql`) exist but have never been applied. Written today by another lane, so this is pending work, not old rot.
* There are two separate custom-field systems running side by side: a 305-column table used at 3.6%, and a free-form bag on the client record with 84 different keys used by 40 of 46 clients.
* The custom-field table has a column for Social Security numbers. It is empty today. Nobody flagged that it exists.
* The `marketing`, `auth` and `storage` cupboards are locked at the door, not per-row. That is a stronger and better protection than the per-row locks used everywhere else.

## One caveat on A10

The "all 483 links are clean" result was measured as the app user. The app user sees no rows at all in the six shut tables, so those six could not be genuinely checked. That number is a floor, not a ceiling.

## Where the detail lives

| File | Item |
|---|---|
| `current_identity.json` | A1 |
| `rls_kinds_now.json` | A2 |
| `dispute_tables.json` | A3 |
| `marketing_schema.json` | A4 |
| `other_schemas.json` | A5 |
| `bank_transactions.json` | A6 |
| `sim_client_orphans.json` | A7 |
| `client_fk_indexes.json` | A8 |
| `migrations_state.json` | A9 |
| `fk_orphans.json` | A10 |
| `custom_fields.json` | A11 |
| `demo_flag_rows.json` | A12 |
| `runtime_unused.json` | A13 |
