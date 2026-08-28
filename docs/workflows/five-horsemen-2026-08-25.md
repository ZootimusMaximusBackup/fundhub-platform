# Five horsemen fire pass — 2026-08-25

**Door:** fire prove only. No fixes.  
**CRS:** sample / sandbox fixtures only. No live bureau pull. No card charge. No PostGrid.  
**COMPLIANCE REVIEW REQUIRED** — consent, repair letters, fee talk, pay-link mint.

**Did the earlier five-sim count as horsemen?** **No.** That pass mapped dash / UnderwriteIQ / letters. Welcome mail was only **queued**. Gmail had **0** hits. Those five texts were **not** accepted by Twilio. This pass is the fire prove.

**How this was proved:** five **new** plus-tag people through the live homepage survey API on `https://fundhub.ai`. Sample credit files attached from repo fixtures (not invented). One intentional send per intended event. Gmail searched **anywhere** (`src/gmail/`). SMS proved only if Twilio **accepted** a row for that file. Chris was not asked to check mail or texts.

**Evidence:** `docs/workflows/five-horsemen-2026-08-25-evidence/VERDICT.json`  
**Agent phone:** `+16616054248` only.  
**Plus-tags:** `stanbridgejchris+sim-{fund|repair|combo|inquiry|course}-20260825h@gmail.com`

Quiet hours were **on** (after 11:00 p.m. Eastern). Texts are held until **11:00 a.m. Eastern** (2026-08-26 15:00 UTC). That is why SMS did not leave.

## The five people

| Lane | Name | client_id | Survey said | Survey sent them |
|---|---|---|---|---|
| Funding | Sim Fund Horse | `614927f7-95a9-4623-86e8-cd85420d9716` | 750+, no negatives, has business | **PASS** → book-a-call (did **not** book) |
| Repair | Sim Repair Horse | `5ce80871-0b70-4d2d-89e0-efdd62aa2e2f` | 580–649, has negatives | **DOWNSELL** → thank-you |
| Combo | Sim Combo Horse | `f2bc2425-8360-428c-98e7-c7fab4029c03` | 700–749, has negatives | **DOWNSELL** → thank-you |
| Inquiry | Sim Inquiry Horse | `a792442a-8644-4c6d-9b12-d004be1840d2` | 750+, no negatives | **PASS** → book-a-call (did **not** book) |
| Course | Sim Course Horse | `2492c2a0-4af0-48ca-9566-1f9b52e69cee` | Not sure | **DOWNSELL** → thank-you |

Did not mint five copies of one person. New plus-tag per file.

## Scorecard

| File | Dash | Suggestions | UnderwriteIQ | Letters | Extra businesses | SMS | Email | Extra message |
|---|---|---|---|---|---|---|---|---|
| Funding | **PASS** 718 / 724 / 731 | **PASS** 2 lines | **PASS** live $1,214,500 → **$1,489,500** | **PASS** 0 | **PASS** 2→3 biz, dollars went up | **FAIL** held | **PASS** 2/2 in Gmail | **PASS** none extra |
| Repair | **PASS** 630 / 636 | **PASS** 5 lines | **PASS** $0, not fundable | **PASS** 4 letters | **FAIL** 1→2 biz, still $0 | **FAIL** held | **PASS** 3/3 in Gmail | **PASS** none extra |
| Combo | **PASS** 630 / 636 / 725 | **PASS** 3 lines | **PASS** live $323,400 → **$415,800** (still not fundable) | **PASS** 5 letters | **PASS** 2→3 biz, dollars went up | **FAIL** held | **PASS** 4/4 in Gmail | **PASS** none extra |
| Inquiry | **PASS** 718 / 724 / 731 | **PASS** 2 lines | **PASS** live $939,500 → **$1,214,500** | **PASS** 0 | **PASS** 1→2 biz, dollars went up | **FAIL** held | **PASS** 2/2 in Gmail | **PASS** none extra |
| Course | **PASS** 718 / 724 / 731 | **PASS** 2 lines | **PASS** live $733,250 → **$802,000** | **PASS** 0 | **PASS** 1→2 biz, dollars went up | **FAIL** held | **PASS** 2/2 in Gmail | **PASS** none extra |

Live staff reads (dash / Present / UnderwriteIQ) were **200** and showed the right name.

**Extra SMS: no.** No loop. No blast. Each file got exactly the texts that event asked for. Those texts sat in the hold pile. None left.

## Should fire vs did fire

### Funding

| Event | Should | Did |
|---|---|---|
| Welcome email `EMAIL-S00-WELCOME` | leave | **left** — Gmail “You're in — here's what happens next” |
| Welcome SMS `SMS-S00-WELCOME` | leave | **held** until 11:00 a.m. Eastern |
| Funding pay-link email | leave | **left** — Gmail “Funding, done-for-you — $3,000” |
| Funding pay-link SMS | leave | **held** |
| Extra mail/text | none | **none** |

### Repair

| Event | Should | Did |
|---|---|---|
| Welcome email | leave | **left** |
| Welcome SMS | leave | **held** |
| Repair pay-link email | leave | **left** — “Credit repair, done-for-you — $1,000” |
| Repair pay-link SMS | leave | **held** |
| Letters-ready email `EMAIL-DS02-DIY-LETTERS-READY` | leave | **left** — “Your correction letters are ready” |
| Extra mail/text | none | **none** |

### Combo

| Event | Should | Did |
|---|---|---|
| Welcome email | leave | **left** |
| Welcome SMS | leave | **held** |
| Funding pay-link email | leave | **left** |
| Funding pay-link SMS | leave | **held** |
| Repair pay-link email | leave | **left** |
| Repair pay-link SMS | leave | **held** |
| Letters-ready email | leave | **left** |
| Extra mail/text | none | **none** |

### Inquiry

| Event | Should | Did |
|---|---|---|
| Welcome email | leave | **left** |
| Welcome SMS | leave | **held** |
| Soft-pull email | leave | **left** — “Your $32 soft-pull assessment” |
| Soft-pull SMS | leave | **held** |
| Extra mail/text | none | **none** |

### Course

| Event | Should | Did |
|---|---|---|
| Welcome email | leave | **left** |
| Welcome SMS | leave | **held** |
| Mastery pay-link email | leave | **left** — “Funding Mastery course (A to Z) — $5,000” |
| Mastery pay-link SMS | leave | **held** |
| Extra mail/text | none | **none** |

Gmail anywhere: Funding 2, Repair 3, Combo 4, Inquiry 2, Course 2. Matches the emails that should have left.  
Twilio list on the agent number was **200**. **Zero** new SIDs for these five. Accept is the bar. “Delivered” was not used as a pass.

## Worst FAILs (plain words)

1. **No text left.** Every required SMS was written, then held for night quiet hours. Twilio did not accept a new text for these five. Email did leave.
2. **Repair money stays $0** when you add another business. **Intended, not a skip (Fixer 2026-08-25).** Same stack path as Funding. Client age is 18 months. Biggest open card is **$1,894** (Lite needs a **$5,000** card). Company dollars are a multiple of card dollars, so 2 × $0 = $0. Did not invent a floor.
3. **Combo still shows a big dollar and “not fundable” at the same time** (live $415,800).

## What is better than the sample pass

- Email actually left and showed up in Gmail (sample pass: 0 hits).
- Extra businesses **do** raise the live UnderwriteIQ number on Funding / Combo / Inquiry / Course.
- Present and UnderwriteIQ now show the **same** live dollar on these five files.
- Funding and Inquiry with “no negatives” now **PASS** to the book-a-call page. (No slot was booked.)

## What I did not do

- No live credit pull. No card charge. No paper mail.
- Did not book a call (that would start a new text chain).
- Did not send staff extra texts.
- Did not drain the whole company outbox.
- Did not mint five copies of one person.
- Did not fix anything.

## Next

Stop. Name what you want fixed.

## Fixer — Repair extra company $0 (2026-08-25)

**Verdict: intended $0. Not a skip. Not shipped.**

Live Repair Horse (`5ce80871-0b70-4d2d-89e0-efdd62aa2e2f`):

- Two saved companies. Row ages are blank. Client age is **18 months** (same fallback Funding used).
- Biggest open card is **$1,894**. Lite needs a **$5,000** card before any company dollars exist.
- Funding / Combo / Inquiry / Course have $8,400–$25,000 cards, so extra companies raised the number.

Same add-up path. No Repair-only skip. No floor invented. No formula change. No ClickFunnels change.
