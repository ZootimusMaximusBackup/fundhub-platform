# T3 — step 1: re-walk every item on the live site before fixing anything

Walked https://fundhub.ai on 2026-08-18 as `owner@fundhub.ai` and `closer@fundhub.ai`.
Clients used: TEST `8556bedc-46e1-4d85-b0cd-a24adfee1521` and a **fresh** demo seed
`c4d47a8f-b279-44fe-aaea-370f9a1de4fa` created via `POST /api/demo/simulate` with tier
`FULL_FUNDING`. The live credit file `9af65808-…` was never opened — the walker refuses that id
outright (`guard()` in `scripts/.t3-live.mjs`). No bureau was ever actually contacted: every pull
attempt stopped at a Fundhub gate before the vendor call.

Raw records: `repro/walk1-owner.json`, `repro/walk2.json`, `repro/walk3.json` + screenshots.

## What still fails, what changed, what was already fixed

| Item | Verdict today | Proof |
|---|---|---|
| T3-09 bureau buttons refuse, no consent | **STILL BROKEN** — but only on a client nobody hand-recorded consent for. Fresh seed → `403 {"code":"consent_required"}`, exact live string "no soft-pull consent on file for this client — capture consent before requesting a pull" | `walk3.json` step `pull-fresh-sim-experian` |
| T3-10 signing the consent contract writes no consent row | **STILL BROKEN** | The only consent row on TEST is `capture_method:"typed"`, `granted_by_kind:"staff"`, `document_id:null`, granted `21:56:29` by the earlier audit's API call — not by a signature. A signed contract leaves `document_id` set; none exists. `walk3.json` step `consent-state-test` |
| T3-11 Experian 422 "no identity on file" | **STILL BROKEN — and worse than recorded.** It is not Experian only. With consent valid, **all three** bureaus return `422 {"code":"identity_required"}` | `walk1-owner.json` steps `pull-TransUnion` / `pull-Experian` / `pull-Equifax`, all three 422 |
| T3-12 buttons look identical with or without consent | **STILL BROKEN** | On both clients all three render `disabled:false`, `title:null`. Only the error text differs. `walk1` step `ccp-dom` |
| T3-01 / T3-14 / T3-X1 underwrite $0 on a funded seed | **STILL BROKEN**, reproduced on a seed made today | `/api/read/underwrite` → `score:0`, `available:[]`, `total_combined_funding:0`, every bureau `available:false`. `walk2.json` step `underwrite-fresh-sim` |
| CCP utilization box | **STILL MISSING** | No element on the page matches `utili[sz]ation` on either client. `walk1`/`walk2` `hasUtil:false` |
| CCP Bank Inbox / GHL Contact / Raw Report | **STILL DISABLED**, hardcoded | `walk1` step `ccp-dom` `disabledButtons` with their three title strings |
| T3-16 closer dashboard shows dashes | **STILL BROKEN** | `oNet/oMonthly/oFunded/oFees/oDebts` all `—`; the screen fires only 4 API calls (`session`,`session`,`health`,`org-brand`) and never asks for deal data. `walk2` step `closer-dashboard` |
| consent screen bounced you to Pipeline | **ALREADY FIXED by T0** (`a749196`) — do not re-fix | `/app/consent-capture.html?client_id=…` now stays put and renders its form. `walk1` step `consent-capture`, screenshot `03-consent-capture.png` |

## Two corrections to the finding list — recorded, not quietly dropped

**1. T3-09's headline is out of date.** The board says every bureau button returns 403. On the TEST
client today they return **422**, because the earlier audit left a hand-typed consent row behind. The
underlying defect is unchanged and reproduces on any client that has not had consent typed in by
hand — I proved it on a seed created today. But anyone re-checking T3-09 on the TEST client will see
422 and think it is fixed. It is not.

**2. The two gates are in series, and the finding list treats them as one item.** Order is:
consent (403) → identity (422). Fixing consent alone moves every client from 403 to 422 and changes
nothing a user can see. **Both have to land together or the button still cannot succeed.**

## What a pull would have cost

Nothing. Both gates sit in front of the vendor call, so no bureau was contacted and no soft-pull
request row was created. That is also T3-13's point: the *next* click after both gates pass is a
real bureau hit against a real person, and there is no practice mode.
