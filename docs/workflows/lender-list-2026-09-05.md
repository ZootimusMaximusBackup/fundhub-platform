# The bank list: which bureau each bank checks

Written 2026-09-05 by `scripts/lenders-extract-bureaus.mjs`. Nothing here was typed by hand.

## Why this was needed

When a client applies for a card, the bank checks their credit at one of three
credit bureaus: Experian, Equifax or TransUnion. Every check leaves a mark, and
too many marks at one bureau gets the next application turned down. The funding
advisor's screen is meant to hand out a list that spreads those checks around.

It could not. Out of 313 banks in the book, only 3 said which bureau they check
and none said how good a bank it is. With nothing to sort on, the "rotation plan"
came out in plain A-to-Z order by bank name. It was doing nothing at all.

## What changed

| | Before | After |
|---|---|---|
| Banks that say which bureau they check | 3 | 46 |
| Banks with a good/fair/poor ranking | 0 | 37 |
| Banks with a minimum deposit written down | 0 | 35 |
| Banks that say whether you must open an account | 41 | 59 |
| Banks with an application link | 215 | 215 |

Ranking means 1 for the banks Alec's notes mark HOT, 2 for FAIR, 3 for COLD.
That is the column the advisor's list sorts on first.

## The three rows that already had a bureau were not touched

American Express (Experian), Citizens Bank (Equifax) and Goldman Sachs (TransUnion)
were filled in before this run. This script never overwrites a cell that already has
something in it, so all three are exactly as they were.

Where a source disagreed with one of those existing values, it was left alone and noted here:

| Row | Keeps | A source says |
|---|---|---|
| American Express | EX | EX/TU |

## Banks where the sources disagree — left blank on purpose

A wrong bureau is worse than a blank one: it sends the client to the exact bureau
they were protecting. So when two solid sources say different things, the script
writes nothing and puts the bank here for you to settle.

| Bank | What each source says |
|---|---|
| Fifth Third Bank | **EX** — Active bank list<br>**TU** — Inquiries we have seen (TU 10 (100%)) |
| First Citizens Bank | **EQ** — Active bank list<br>**EX/EQ** — Inquiries we have seen (EQ 7 (58%), EX 5 (42%)) |
| Flagstar Bank | **EQ** — November datapoint drop<br>**EX** — Aged corp details |

## Banks held back because two companies share the name

The book has two unrelated banks called First National Bank, two called First Bank,
and two called First American Bank. A Notion page names a bureau for "First National
Bank" without saying which one it means. Filling that in would be a coin flip, and half
the rows would get the wrong bureau. So these are left blank until you say which is which.

| Bank | Rows | Which rows | A source says |
|---|---|---|---|
| First National Bank | 2 | InBranchBizCC (MD, NC, PA); OnlineBizCC (IL) | EQ/TU |
| First American Bank | 2 | InBranchBizCC (FL, IL, NM); OnlineBizCC (WI) | nothing |
| First Bank | 2 | InBranchBizCC (KS); OnlineBizCC (TN, WY) | EX |
| First Bank & Trust | 1 | InBranchBizCC (SD) | nothing |
| Peoples Bank | 1 | InBranchBizCC (MD) | nothing |
| The People’s Bank | 1 | OnlineBizCC (MS) | nothing |
| The Peoples Bank | 1 | OnlineBizCC (KY) | nothing |
| Union Bank | 1 | OnlineBizCC (CA, VT) | nothing |
| Union Bank & Trust | 1 | InBranchBizCC (NE) | nothing |
| FNBO Evergreen | 1 | OnlineBizCC (TX) | nothing |
| First Citizens National | 1 | InBranchBizCC (TN) | nothing |

## Smaller disagreements — filled in, but worth a look

Here the solid sources agreed, so the bank got filled in. A written-up Notion page
mentions a bureau on top of that. Not enough to block anything, but you should see it.

| Bank | Written in | The page says | Which page |
|---|---|---|---|
| Citizens Bank | EQ | EX | Aged corp details |
| M&T Bank | TU | EX | November datapoint drop |
| PNC Bank | EX/EQ | EX/TU | November datapoint drop |
| US Bank | EQ/TU | EX | Aged corp details |
| US Bank | EQ/TU | EX | Crafting the Perfect Funding Sequence |

## Banks that the book lists more than once

The book calls the same bank by several different names, so one bank can be spread
over several rows. Every row in a group below now carries the same bureau and the
same ranking. The rows were not merged — that is a separate decision for you — but
they are no longer treated as different banks.

One split is deliberate and was kept: a bank can have one row for the card you apply
for online and another for the card you have to walk into a branch for.

| Bank | Rows in the book | The row names |
|---|---|---|
| Elan Financial | 8 | Elan Financial; Elan Financial (0%; Elan Financial (0% for 20 Months; Elan Financial Banks (0% for 20 Months; Elan Financial Issued Cards (20 months 0%); Elan Financial Issuers; Elan Financial Network; Elan Financial Partner Banks |
| First Citizens Bank | 5 | First Citizens; First Citizens Bank; First Citizens Bank; First Citizens Bank (0% for 9 months); First Citizens Bank (Apply in-branch) |
| Chase | 2 | Chase; Chase Bank |
| Fifth Third Bank | 2 | Fifth Third; Fifth Third Bank |
| Comerica Bank | 2 | Comerica; Comerica Bank |
| WesBanco | 2 | WesBanco; WesBanco Bank |
| IBC Bank | 2 | IBC; IBC Bank |
| SouthState Bank | 3 | CenterState Bank (Now SouthState); South State Bank; SouthState Bank |
| Columbia Banking System | 2 | Columbia Bank; Columbia State Bank |
| Native American Bank | 4 | Native American Bank; Native American Bank; Native American Bank (0%; Native American Bank (via TCM) |
| People's United Bank | 4 | People’s United Bank; People’s United Bank; People’s United Bank (0% - Personal); People’s United Bank (Now M&T) |
| First National Bank Alaska | 2 | First Bank Alaska; First National Bank Alaska |
| Valley National Bank | 2 | Valley Bank; Valley National Bank |
| FNBO | 2 | First National Bank of Omaha (FNBO); FNBO |
| PNC Bank | 3 | PNC Bank; PNC Bank; PNC Bank (0% BT only) |

## Seven rows in the book that are not banks

These are stacking instructions — sentences telling the advisor how to apply — that
got read in as if they were bank names. Each is sitting on a state, and every one of
those states is already covered by an Elan Financial row. They should be deleted.
This script does not delete anything.

| State it is holding | The row's name |
|---|---|
| IL | Amex often approves a second 0% card if the first gets approved |
| LA | Apply at one Elan bank, then apply to a second with consistent info |
| ND | Apply to one bank first, then a second Elan bank with same data |
| KS | Apply to one Elan bank first, then submit to a second |
| IN | Apply to one first, then a second Elan bank once approved |
| MI | Apply with one bank first, then a second Elan partner |
| MD | Apply with one bank, then a second with matching data |

## Banks that still have no bureau, and why

267 of the 313 rows still have nothing. Grouped by the reason:

**238 rows — No bureau in any source we hold.**

1st Source Bank, Alpine Bank, Altabank, American Bank Center (Bravera), American National (0%, AmTrust / FNBO, AmTrust Bank (0% - FNBO), ANB Bank, Apple Creek Bank, Arizona Bank & Trust (0% - HTLF), Artisans’ Bank, Arvest Bank, Associated Bank, Atlantic Union Bank, BancFirst, BancorpSouth Bank, Bank Forward, Bank Iowa, Bank of Albuquerque, Bank of Blue Valley, Bank of Blue Valley (0%, Bank of Colorado, Bank of Hawaii, Bank of Hope, Bank of New Hampshire, Bank of New Hampshire, Bank of Oklahoma, Bank of Tennessee, Bank of the West, Bank of the West, BankNewport, BankPlus, BankWest, Banner Bank, BBVA, Berkshire Bank, Berkshire Bank, BOK Financial, Bremer Bank, Bryant Bank, and 198 more.

**14 rows — Two different banks share this name — filling it in would be a coin flip.**

First American Bank, First American Bank, First Bank, First Bank, First Bank & Trust, First Citizens National, First National Bank, First National Bank, FNBO Evergreen, Peoples Bank, The People’s Bank, The Peoples Bank, Union Bank, Union Bank & Trust

**8 rows — Sources disagree — needs Chris to rule.**

Fifth Third, Fifth Third Bank, First Citizens, First Citizens Bank, First Citizens Bank, First Citizens Bank (0% for 9 months), First Citizens Bank (Apply in-branch), Flagstar Bank

**7 rows — Bank name not recognised, so no source could be attached to it.**

Amex often approves a second 0% card if the first gets approved, Apply at one Elan bank, then apply to a second with consistent info, Apply to one bank first, then a second Elan bank with same data, Apply to one Elan bank first, then submit to a second, Apply to one first, then a second Elan bank once approved, Apply with one bank first, then a second Elan partner, Apply with one bank, then a second with matching data

Almost all of these are small local banks that appear on exactly one row and are
named in no other source we hold. There is no honest way to fill them in from what
we have. They would have to come from a real application or a call to the bank.

## Active banks with no row in the book at all

Alec's active bank list has 26 banks. Ten of them have no row in the book, so there
is nothing to attach their bureau to. That is the real ceiling on this job: 16 banks,
not 26.

| Bank | Ranking | Bureau in the note |
|---|---|---|
| Best Egg | HOT | none listed |
| Bankers Healthcare Group | HOT | TU |
| Doc2Doc Lending | HOT | none listed |
| First Horizon Bank | HOT | EX |
| Navy Federal Credit Union | HOT | none listed |
| SoFi | HOT | EX, TU |
| LightStream | FAIR | TU |
| Prosper | FAIR | TU |
| TCM Bank | COLD | none listed |
| Credit Unions | HOT | EQ, TU |

## Where the answers came from

Four kinds of source, ranked. Higher beats lower.

1. **Alec's active bank list** (`docs/legacy-strong/bank-datapoints-active-banks.md`).
   26 banks, with the bureau written in a labelled field. Trusted most.
   Read: 26 banks, 25 of them named properly.
2. **Credit checks we have actually seen** (`docs/legacy-strong/inquiry-master-database.csv`).
   5380 real credit checks off client reports. 2403 of them are on a bank we can name.
   A bank is only given a bureau here when we have seen at least 10 of its checks, and
   the bureau accounts for at least 30% of them and at least 5 checks. The full split is below.
3. **The written-up Notion pages** (four of them) and the state funding boards table.
   144 statements found. These can raise a question but never overrule the two above.

### What the credit checks we have seen actually show

Every bank we could name, and how its checks split across the three bureaus. The last
column is what this file alone would say. Where the active bank list also has an opinion,
that one wins, so the bureau written into the book can be wider than this column.

| Bank | Checks seen | How they split | What this file on its own concludes |
|---|---|---|---|
| Capital One | 424 | TU 158 (37%), EX 133 (31%), EQ 133 (31%) | EX/EQ/TU |
| Chase | 390 | EX 207 (53%), TU 113 (29%), EQ 70 (18%) | EX |
| Ally Financial | 167 | EX 77 (46%), TU 47 (28%), EQ 43 (26%) | EX |
| Bank of America | 148 | EX 73 (49%), TU 73 (49%), EQ 2 (1%) | EX/TU |
| American Express | 140 | EX 102 (73%), TU 37 (26%), EQ 1 (1%) | EX |
| Navy Federal Credit Union | 126 | TU 111 (88%), EX 15 (12%) | TU |
| Wells Fargo | 94 | EX 42 (45%), EQ 33 (35%), TU 19 (20%) | EX/EQ |
| Discover | 93 | EX 76 (82%), TU 9 (10%), EQ 8 (9%) | EX |
| Citi | 86 | EQ 58 (67%), EX 26 (30%), TU 2 (2%) | EX/EQ |
| US Bank | 67 | TU 52 (78%), EX 9 (13%), EQ 6 (9%) | TU |
| Truist | 60 | EQ 45 (75%), TU 15 (25%) | EQ |
| OneMain Financial | 56 | EX 25 (45%), TU 24 (43%), EQ 7 (13%) | EX/TU |
| Elan Financial | 51 | TU 41 (80%), EX 7 (14%), EQ 3 (6%) | TU |
| Barclays | 34 | TU 32 (94%), EX 2 (6%) | TU |
| Goldman Sachs | 34 | TU 33 (97%), EQ 1 (3%) | TU |
| Synchrony Bank | 33 | TU 30 (91%), EX 3 (9%) | TU |
| Credit One Bank | 27 | EX 19 (70%), TU 8 (30%) | EX |
| General Motors Financial | 21 | TU 13 (62%), EQ 8 (38%) | EQ/TU |
| PNC Bank | 19 | EX 19 (100%) | EX |
| LightStream | 17 | TU 17 (100%) | TU |
| Santander Bank | 16 | TU 11 (69%), EX 5 (31%) | EX/TU |
| FNBO | 15 | EX 14 (93%), EQ 1 (7%) | EX |
| Citizens Bank | 13 | EQ 9 (69%), TU 4 (31%) | EQ |
| Upgrade | 13 | TU 13 (100%) | TU |
| Prosper | 13 | TU 13 (100%) | TU |
| Huntington Bank | 13 | TU 8 (62%), EQ 5 (38%) | EQ/TU |
| First Citizens Bank | 12 | EQ 7 (58%), EX 5 (42%) | EX/EQ |
| BMO Harris | 11 | TU 11 (100%) | TU |
| Universal Credit | 11 | TU 11 (100%) | TU |
| Fifth Third Bank | 10 | TU 10 (100%) | TU |
| SoFi | 10 | EX 8 (80%), TU 2 (20%) | EX |
| M&T Bank | 10 | TU 6 (60%), EX 3 (30%), EQ 1 (10%) | TU |
| LendingClub Bank | 9 | TU 9 (100%) | too thin to use |
| Upstart | 9 | EQ 5 (56%), TU 4 (44%) | too thin to use |
| USAA | 8 | EX 8 (100%) | too thin to use |
| Axos Bank | 7 | EX 6 (86%), EQ 1 (14%) | too thin to use |
| Merrick Bank | 6 | TU 5 (83%), EX 1 (17%) | too thin to use |
| Lendmark Financial Services | 5 | EQ 5 (100%) | too thin to use |
| Stearns Bank | 4 | EQ 4 (100%) | too thin to use |
| LendingPoint | 4 | EX 4 (100%) | too thin to use |
| Valley National Bank | 4 | TU 4 (100%) | too thin to use |
| Mariner Finance | 4 | EQ 4 (100%) | too thin to use |
| Northwest Savings Bank | 4 | TU 4 (100%) | too thin to use |
| Pinnacle Bank | 4 | EQ 3 (75%), EX 1 (25%) | too thin to use |
| First PREMIER Bank | 4 | EQ 3 (75%), TU 1 (25%) | too thin to use |
| TD Bank | 4 | EX 4 (100%) | too thin to use |
| BNC National Bank | 4 | EX 4 (100%) | too thin to use |
| Bankers Healthcare Group | 3 | TU 3 (100%) | too thin to use |
| Best Egg | 3 | EX 2 (67%), TU 1 (33%) | too thin to use |
| TAB Bank | 3 | TU 3 (100%) | too thin to use |
| Fulton Bank | 3 | TU 3 (100%) | too thin to use |
| United Community Bank | 3 | EQ 3 (100%) | too thin to use |
| Independent Bank | 3 | EQ 3 (100%) | too thin to use |
| Regions Bank | 2 | TU 2 (100%) | too thin to use |
| Arvest Bank | 2 | TU 2 (100%) | too thin to use |
| Desert Financial Credit Union | 2 | TU 2 (100%) | too thin to use |
| Alerus Financial | 2 | EX 1 (50%), TU 1 (50%) | too thin to use |
| KeyBank | 2 | EQ 2 (100%) | too thin to use |
| Jenius Bank | 2 | TU 2 (100%) | too thin to use |
| First Horizon Bank | 2 | EQ 2 (100%) | too thin to use |
| Sallie Mae | 2 | TU 2 (100%) | too thin to use |
| Cadence Bank | 2 | TU 2 (100%) | too thin to use |
| NBT Bank | 2 | EX 2 (100%) | too thin to use |
| American National | 2 | EX 1 (50%), EQ 1 (50%) | too thin to use |
| CIT Bank | 2 | EX 2 (100%) | too thin to use |
| Zions Bank | 2 | EX 2 (100%) | too thin to use |
| Dollar Bank | 2 | TU 2 (100%) | too thin to use |
| Synovus Bank | 1 | EQ 1 (100%) | too thin to use |
| The Bank of Missouri | 1 | EQ 1 (100%) | too thin to use |
| Aven | 1 | EX 1 (100%) | too thin to use |
| MidFirst Bank | 1 | EX 1 (100%) | too thin to use |
| Klarna | 1 | EX 1 (100%) | too thin to use |
| ENT Credit Union | 1 | EX 1 (100%) | too thin to use |
| Mission Lane | 1 | TU 1 (100%) | too thin to use |
| Bank of Hawaii | 1 | EQ 1 (100%) | too thin to use |
| Happy Money | 1 | TU 1 (100%) | too thin to use |
| CorTrust Bank | 1 | TU 1 (100%) | too thin to use |
| Fundbox | 1 | EX 1 (100%) | too thin to use |
| Mechanics Bank | 1 | EQ 1 (100%) | too thin to use |
| TCM Bank | 1 | EX 1 (100%) | too thin to use |
| Oportun | 1 | TU 1 (100%) | too thin to use |
| Premier Bank | 1 | TU 1 (100%) | too thin to use |
| Simmons Bank | 1 | TU 1 (100%) | too thin to use |
| Bank of the West | 1 | EX 1 (100%) | too thin to use |
| Frost Bank | 1 | EQ 1 (100%) | too thin to use |

### Typos in the scanned reports that were read through

The credit checks file was read off scanned credit reports, so the bureau column has
misspellings in it. These were read as follows. Nothing else was guessed at.

| What the file says | Read as |
|---|---|
| Equilax | EQ |
| Equitax | EQ |
| Exocrian | EX |
| Exporian | EX |
| IransUnion | TU |
| TranaUnion | TU |
| TrangUnion | TU |
| TranáUnion | TU |

These bureau entries could not be read at all and were ignored:

- `Credit Bureau` — 2 rows
- `Experian Experian` — 1 row

## Application links: nothing could be filled

215 of the 313 rows have an application link and 98 do not.
The state funding boards table was the one source that offers links, and it could not
help: all 24 of its links were cut short when the page was copied out of Notion.
They read like `bmo.com/en-…tinum/` — the middle of the address is literally missing.
Writing one of those in would give the advisor a link that goes nowhere, so none were written.

To fix this properly, someone has to open the State Funding Boards page in Notion and
copy the full links out. There are about 8 different links behind those 29 rows.

## Names in the sources that could not be pinned to one bank

Left alone rather than guessed at.

- Chase Ink Unlimited (30k -> 40k) (Aged corp details) — mentioned 2 times
- AMEX Biz Gold (charge) / Personal (15k) (Aged corp details) — mentioned 2 times
- 5/3rd Bank (10K) (Aged corp details) — mentioned 2 times
- Independent Financial (Elan) (November datapoint drop) — mentioned 1 time
- First Financial Bank (November datapoint drop) — mentioned 1 time
- Calbank (November datapoint drop) — mentioned 1 time
- LA Financial (November datapoint drop) — mentioned 1 time
- Bank Rhode Island (November datapoint drop) — mentioned 1 time
- Evans Bank (November datapoint drop) — mentioned 1 time
- SalemFive Bank (Elan Financial) (November datapoint drop) — mentioned 1 time
- BMO Harris Bank (November datapoint drop) — mentioned 1 time
- Machias Savings Bank (November datapoint drop) — mentioned 1 time
- GM (Crafting the Perfect Funding Sequence) — mentioned 1 time

And from the name map, already known:

- **GM** — Could be the GM business card or the car finance arm. The card has changed issuer more than once. Not the same as GM FINANCIAL in the inquiry file, which is the car loan arm. Chris needs to say which one he means.
- **Local Banks** — An instruction, not a bank.
- **Credit Unions** — A category, not one institution. The book has only three named credit unions: Desert Financial CU (AZ), ENT Credit Union (CO), Greater Nevada Credit Union (NV). The datapoint cannot be applied to a named row.
- **ASSOCIATED B** — Could be Associated Bank, which is in the book, or Associated Credit Union, which is not.
- **First National Bank** — Almost certainly two different banks. Do not merge them.
- **First American Bank** — There are several unrelated banks called First American Bank. Do not merge.
- **First Bank** — Several unrelated banks share this name. Do not merge.
- **First Bank & Trust** — Different banks. The HTLF one is a Heartland Financial brand.
- **Peoples Bank / The People's Bank / The Peoples Bank** — Three separate community banks with near-identical names. Do not merge.
- **Union Bank vs Union Bank & Trust** — Different banks.
- **FNBO Evergreen** — Reads as an Evergreen Bank product issued through FNBO. Which of the two owns the row is not written down anywhere.
- **First Citizens National** — This is First Citizens National Bank of Tennessee, a different company from First-Citizens Bank & Trust. It is deliberately NOT in the First Citizens collapse group.

## Safety check

The new file has to be the whole book, all 45 columns. The importer hands every column
it sees straight into the database, and an empty cell counts as an instruction to clear
that field. A cut-down "just the bureaus" sheet would wipe every other column on those
rows. So the file written here carries every original value through untouched.

Checked and passed: same 45 columns in the same order, same number of rows, and no cell that already had a value was changed.

## What Chris needs to decide

1. The banks in the disagreement table above — which bureau is right.
2. Whether to delete the seven rows that are not banks.
3. Whether to merge the duplicate rows into one row per bank.
4. Whether someone should pull the full application links out of Notion.

