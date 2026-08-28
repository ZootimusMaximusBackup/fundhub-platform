# Five-sim sample flaw map — 2026-08-25

**Door:** flaw-map only. No fixes.  
**CRS:** sample / sandbox fixtures only. No live bureau pull. No card charge. No PostGrid.  
**COMPLIANCE REVIEW REQUIRED** — consent, repair letters, fee talk.

**How this was proved:** five new plus-tag people through the live homepage survey on `https://fundhub.ai`. Sample credit files were attached from repo fixtures (not invented). Business samples used the same shape as the soft-pull form. Live staff APIs on dash / Present / UnderwriteIQ were read. Letters were generated after a staff consent (no mail). Gmail was searched anywhere. Twilio was listed on the agent number. Chris was not asked to check mail or texts.

**Evidence:** `docs/workflows/five-sim-sample-2026-08-25-evidence/VERDICT.json` and `letters-followup.json`.

**Agent phone:** `+16616054248` only.  
**Plus-tags:** `stanbridgejchris+sim-{fund|repair|combo|inquiry|course}-20260825b@gmail.com`

## The five people

| Lane | Name | client_id | Survey said | Survey sent them |
|---|---|---|---|---|
| Funding | Sim Fund Sample | `9dd655fb-104f-4521-b9f0-e4f349bace5c` | 750+, has business | **MANUAL_REVIEW** → thank-you |
| Repair | Sim Repair Sample | `0184cd98-3350-427c-adc5-849f3eadff62` | 580–649 | **DOWNSELL** → thank-you |
| Combo | Sim Combo Sample | `8a4ac427-4cf3-4aac-8da9-286708f3f810` | 700–749 | **MANUAL_REVIEW** → thank-you |
| Inquiry | Sim Inquiry Sample | `201a585f-35bf-48d3-a4aa-7d440de6b1fb` | 750+ | **MANUAL_REVIEW** → thank-you |
| Course | Sim Course Sample | `dca22173-8fcf-4e1c-afad-78f215552186` | Not sure | **DOWNSELL** → thank-you |

## What sample files we reused (none invented)

| Source | What it is |
|---|---|
| `vendor/underwriteiq-full/api/lite/crs/sandbox/exp.json` | Experian **630**, has negatives |
| `vendor/underwriteiq-full/api/lite/crs/sandbox/efx.json` | Equifax **636**, has negatives |
| `vendor/underwriteiq-full/api/lite/crs/sandbox/tu.json` | TransUnion **725**, clean |
| `src/demo/simulate-client.mjs` | Clean file **718 / 724 / 731**, 7 hard inquiries |

**There is no 750+ clean sample in the repo.** Funding and Inquiry used the 718–731 demo file. That is a gap, not a made-up bureau file.

A true `environment: sandbox` stamp is **hidden** on dash and UnderwriteIQ (the screen skips it). These five were stamped `simulated` so the screens could be read. That is how the demo seed already works.

## Scorecard

| File | Dash | Suggestions | UnderwriteIQ | Letters | Extra businesses vs pre-approval |
|---|---|---|---|---|---|
| Funding | **PASS** 718 / 724 / 731 | **PASS** 2 lines | **PASS** $939,500 (age 30 mo) | **PASS** clean → 0 letters | **FAIL** 2→3 biz, dollar stayed $939,500 |
| Repair | **PASS** 630 / 636 | **PASS** 5 lines | **PASS** $0, not fundable | **PASS** 2 letters | **FAIL** 1→2 biz, dollar stayed $0 |
| Combo | **PASS** 630 / 636 / 725 | **PASS** 3 lines | **PASS** $231,000 but **not fundable** | **PASS** 2 letters | **FAIL** 2→3 biz, dollar stayed $231,000 |
| Inquiry | **PASS** 718 / 724 / 731 | **PASS** 2 lines | **PASS** $939,500 | **PASS** clean → 0 letters | **FAIL** 1→2 biz, dollar stayed $939,500 |
| Course | **PASS** 718 / 724 / 731 | **PASS** 2 lines | **PASS** $733,250 (age 8 mo) | **PASS** clean → 0 letters | **FAIL** 1→2 biz, dollar stayed $733,250 |

Live APIs (staff signed in): dash / Present / UnderwriteIQ all **200** and showed the right name.

## Worst flaws (plain words)

1. **Adding more businesses does not raise the pre-approval.** You wanted it to go up. Right now it does not. The money number only cares about one hidden “business age in months” field. The business list on the file is ignored. Soft-pull **price** does go up ($10 each). The funding number does not. Repair suggestions even said “you don’t have an LLC” while a business was already on the file.

2. **Present and UnderwriteIQ do not show the same money.** On Funding / Inquiry / Course, Present showed **$125,000** (a canned number inside the demo sample). UnderwriteIQ showed **$939,500**. Repair Present showed scores but **no** money number.

3. **There is no 750+ clean sample.** The closest real fixture is 718–731. We did not invent a 750 file.

4. **A real sandbox stamp hides the file.** If the stored credit file says `environment: sandbox`, dash and UnderwriteIQ skip it and look empty. Letters can still read it. That is why a sandbox pull can look blank on Present.

5. **The homepage still will not book a 750+ person.** Funding and Inquiry said 750+ and still got **MANUAL_REVIEW** → thank-you. The “any negatives?” question is still missing. Course “Not sure” and Repair 580–649 go **DOWNSELL** → thank-you, not a mastery / repair book path.

6. **Combo still quotes $231,000 while it says not fundable.** Staff can see a big number and a “no” at the same time.

## Mail and texts

| Check | Result | What happened |
|---|---|---|
| Welcome written | queued | All five got EMAIL-S00-WELCOME + SMS-S00-WELCOME |
| Gmail anywhere | **FAIL** (not there yet) | 0 hits on the plus-tags. Still queued, not sent |
| Twilio lane | **PASS** | List 200 on `+16616054248`. These five texts were not accepted yet |
| Asking Chris to check | not done | |

## What live / code does now (extra businesses)

- Soft-pull checkout: **$32 + $10 per business**. That part works.
- UnderwriteIQ: uses `clients.custom_fields.business_age_months` only. **Count of businesses is not read.**
- Adding a second or third business **did not change** the combined number on any of the five files.
- Older business age **does** change the number (Course 8 months = $733,250; Funding 30 months = $939,500 on the same clean sample).
- Another worker may be coding an increase. **This is what it does tonight.**

## What I did not do

- No live credit pull. No card charge. No paper mail.
- Did not mint five copies of one person.
- Did not fix anything.

## Next

Stop. Name what you want fixed.
