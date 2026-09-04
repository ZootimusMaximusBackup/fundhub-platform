# Simulated credit report — Sim Five-Academy

**This is fake data.** Written by scripts/sim/push-credit.mjs, profile `academy`, on 2026-09-03. No bureau was called.
crs_results id `c159f8e3-4205-4306-b8f3-07652a04b87e` · outcome tier `FULL_FUNDING` · created 2026-09-04T01:29:39.280Z

## Scores
| Bureau | Score |
|---|---|
| eq | 770 |
| ex | 762 |
| tu | 758 |

## Accounts (tradelines)
4 accounts in the top-level list.

| Creditor | Type | Limit | Balance | Status | Opened | Bureau(s) |
|---|---|---|---|---|---|---|
| Chase Sapphire Preferred | Revolving |  | 2100 | AsAgreed | 2019-04-12 | EX |
| American Express Blue Business Cash | Revolving |  | 4800 | AsAgreed | 2020-08-01 | EQ |
| Capital One Spark | Revolving |  | 950 | AsAgreed | 2021-01-20 | TU |
| Toyota Motor Credit | Installment |  | 14200 | AsAgreed | 2022-06-15 | EX |

## Inquiries
None.

## Public records
None.

## Engine outcome
- outcome: `FULL_FUNDING`
- reason codes: `[]`
- preapprovals: `{"business": {"base": 0, "final": 0, "eligible": false, "capReason": "not_applicable", "modifiers": {"outcome": 1, "bizUtilization": 1}, "offerBand": "none", "multiplier": 0}, "customerSafe": true, "personalCard": {"base": 137500, "final": 123750, "eligible": true, "modifiers": {"outcome": 1, "thinFile": 1, "utilization": 0.9}, "offerBand": "strong"}, "personalLoan": {"base": 84000, "final": 75600`
- bureaus pulled: `['TU', 'EX', 'EQ']`
- simulated notice: SIMULATED — manual walkthrough 2026-09-03. Not a bureau pull.

## Per-bureau reports
- **EQ**: 4 accounts listed on this bureau's report
- **EX**: 4 accounts listed on this bureau's report
- **TU**: 4 accounts listed on this bureau's report

Raw JSON: sim-five-credit-report-raw.json (same folder).