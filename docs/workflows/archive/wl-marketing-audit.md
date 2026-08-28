# WL marketing UI audit — 2026-08-17

**COMPLIANCE REVIEW REQUIRED** — this pass looked at generated page copy, social posts, and ad-factory write controls on the live site.

**What this is:** UI audit of three live screens against `docs/UI-STANDARDS.md` and `docs/journeys/white-label-intended.md` § Marketing suite (beta). Fixer closed the named CRITICAL rows on 2026-08-18.

**Where:** https://fundhub.ai · role **owner** (`owner@fundhub.ai`) · partner **TEST — White-Label Partner Role** (`9defaf28-47c5-43a0-8f5e-f41ef90f360a`)
**Evidence:** `docs/workflows/build-evidence/wl-marketing/live-audit/` (audit) · `docs/workflows/build-evidence/wl-marketing/live-prove/` (fix prove)
**How:** signed in as owner (password from gitignored `.env`, never printed). Did **not** sign in as `partner@fundhub.ai`.

**Counts after the fix pass:** **0 CRITICAL · 6 HIGH · 6 MEDIUM · 1 LOW · 2 OPEN-QUESTION** · 4 CRITICAL + 3 HIGH closed.

## Known notes — verified, not assumed

| Note | Verdict |
|---|---|
| Brand Studio: Write page copy succeeded | **Yes.** Copy history for Application funnel, stamps `2026-08-17 23:33`, sections hero / process / engine / options / cta. |
| Brand Studio: legal “Not a direct lender” stayed | **Yes.** Preview footer still has that line. Entity line still says “Your Entity LLC” (name fields were empty). |
| Brand Studio: wordmark button returned `not_found` | **Fixed 2026-08-18.** Live `POST /api/partner-marketing/generate-logo` → **200**. Line says “Wordmark saved from the brand name.” |
| Brand Studio: save bar can intercept Turn on | **Partial.** On 1440, Turn on sat above the sticky Save bar after scroll — click-steal not proven. On 390 the Save bar sits on the generation buttons. |
| Social Studio: Write 3 posts succeeded | **Yes.** `GET /api/social/posts` → **3** rows. |
| Social Studio: Connect Facebook / Instagram / LinkedIn visible for owner | **Yes.** All three show for owner. Click Facebook: honest “not set up yet” (start call **503**). |
| Social Studio: queued tiles still 0 after “Wrote 3 posts” | **Fixed 2026-08-18.** Queue tile **3**. Queue tab **3**. The three rows are still `draft`. |
| Creative Factory: Enqueue disabled at first paint | **Fixed 2026-08-18.** First paint: Enqueue is **off**. After the budget loads for TEST, Enqueue is on and the header chip says **Writes on**. |
| Creative Factory: picker vs banner can disagree | **Fixed 2026-08-18.** Change to DEMO Northlight: picker, banner, and id match at once. Enqueue is **off** until that partner’s budget loads. |

## Findings

| Screen | Role | Standard | Expected | Observed | Evidence | Severity |
|---|---|---|---|---|---|---|
| Brand Studio | owner | §5 Every control works · §6 Error is true | “Make a wordmark from the name” makes a mark, or the button is hidden. Fail text is in plain words. | **Fixed.** Click sent `POST /api/partner-marketing/generate-logo` and got **200**. Line says “Wordmark saved from the brand name.” | `live-prove/brand-studio-wordmark.png` · `live-prove/prove.json` `wordmark` | **FIXED** |
| Brand Studio | owner | §1 One job, one primary, job above the fold | One filled button. The write / turn-on work is doable on a 900px-tall screen. | **Partial.** Turn on is hidden while the chip says On (only Turn off shows). Create pages / Write page copy / Save & apply are still filled. Generation is still under the fold. | `live-prove/prove.json` `suiteOnBtnDisplay=none` | **HIGH** (Turn on lie closed) |
| Brand Studio | owner | §5 Action answers back | After copy is written, the preview the owner is looking at updates. | **Fixed.** Preview hero is “See what funding options may be available.” Legal line stayed. | `live-prove/prove.json` `pvH1` | **FIXED** |
| Brand Studio | owner | §11 Phone · §5 Big targets | One column. No sideways scroll. Save bar does not cover the next click. | 390: page is 623px wide. Rail still on the page. Sticky **Save & apply** + Chat sit on Submit / generation. | `live-audit/brand-studio-390.png` · `live-audit/brand-studio-390-full.png` | **HIGH** |
| Brand Studio | owner | §3 Type · leftover codes | 3–4 sizes. No panel codes in the page. | 5 sizes (11 / 13 / 14 / 18 / 28). Eyebrows still say `BS-00` … `BS-07`. | `live-audit/brand-studio-1440.png` · `audit.json` `dom1440` | **MEDIUM** |
| Brand Studio | owner | §5 Save bar vs Turn on (named note) | Turn on is clickable. Sticky save does not steal the click. | 1440: Turn on stayed above the bar; `elementFromPoint` at page-top was null (button off-screen). 390: bar sits on the generation row. Named desktop intercept **not proven**. | `live-audit/brand-studio-1440-wordmark.png` · `live-audit/brand-studio-390-full.png` | **MEDIUM** |
| Brand Studio | owner | Journey: locked legal | Locked “not a direct lender” never goes to the writer and never gets overwritten. | Preview footer still has “Not a direct lender.” | `live-audit/brand-studio-1440-legal.png` | *(pass — not a fail)* |
| Social Studio | owner | §6 Error is true | If a partner is picked, the page does not say none is picked. | **Fixed.** Picker = TEST. Blue bar = showing TEST. Connect help is the honest setup line. Queue help is empty. | `live-prove/social-studio-connect.png` · `live-prove/prove.json` `social` | **FIXED** |
| Social Studio | owner | §5 / §6 Full vs empty | After “Wrote 3 posts”, the owner sees those posts. | **Fixed.** API still has **3** `draft` captions. Queue tile **3**. Queue tab **3**. The table shows the three draft captions. | `live-prove/social-studio-queue.png` · `live-prove/prove.json` `social` | **FIXED** |
| Social Studio | owner | §11 Phone | One column. No sideways page scroll. Chip in the header. | 390: page is 574px wide. Name chip covers Search / Derivation. Rail still on the page. | `live-audit/social-studio-390.png` | **HIGH** |
| Social Studio | owner | Journey §4 Connect is for staff | Owner may see Connect. Partner must not. Buttons that cannot connect do not look live. | Owner sees Connect Facebook / Instagram / LinkedIn (allowed). Click Facebook: **503**, then honest “Facebook is not set up yet.” All three still look live after that. | `live-audit/social-studio-1440-connect-click.png` | **MEDIUM** |
| Social Studio | owner | §3 / slop: no SQL as body | Derivation is for builders, not the daily screen. | Open Derivation prints `count(social_channels WHERE partner_id = $1)` and `049_social.sql:43-44`. Connect help cites `docs/STILL-MISSING.md`. | `live-audit/social-studio-1440.png` · `live-audit/social-studio-1440-full.png` | **MEDIUM** |
| Social Studio | owner | §1 One primary | One filled button. | **Write 3 posts** and **Queue post** are both filled. | `live-audit/social-studio-1440-full.png` | **MEDIUM** |
| Social Studio | owner | §8 Familiar patterns | Placeholders do not look like real IDs. | LinkedIn org box shows `12345678` (placeholder) next to live Connect buttons. | `live-audit/social-studio-1440-connect-click.png` | **LOW** |
| Creative Factory | owner | §6 Error is true | After the budget loads, the line next to Enqueue matches the card. | **Fixed.** Usage: On? Yes · 1458 / 248542 / 250000. Enqueue line is empty. Header chip says **Writes on**. | `live-prove/creative-factory-settled.png` · `live-prove/prove.json` `creative.settled` | **FIXED** |
| Creative Factory | owner | §5 Control matches the partner on screen | Picker, banner, and Enqueue agree. A write button is off until the new partner’s budget is in. | **Fixed.** Change to DEMO Northlight: picker, banner, and id match at once. Enqueue is **off**. Header chip says **Read only**. | `live-prove/creative-factory-picker.png` · `live-prove/prove.json` `pickerImmediate` | **FIXED** |
| Creative Factory | owner | §5 / named first-paint note | Enqueue is off until a partner and budget are ready. | **Fixed.** First paint: Enqueue is **disabled**. Header chip says Read only until the budget loads. | `live-prove/creative-factory-first-paint.png` · `live-prove/prove.json` `firstPaint` | **FIXED** |
| Creative Factory | owner | §11 Phone | One column. No sideways page scroll. | 390: `scrollWidth` **1280**. Name chip covers Search and the first metric. Cards collide. | `live-audit/creative-factory-390.png` | **HIGH** |
| Creative Factory | owner | §4 Nav ≤7 · location | ≤7 top-level items. Current page obvious. | Owner chip: **33 tabs**. Eight groups. Creative Factory is marked on. Same owner-nav miss as the rest of the CRM. | `live-audit/creative-factory-1440.png` | **HIGH** |
| Creative Factory | owner | §1 / §9 Daily 20% | Default view is the day’s job (usage + generate), not the whole factory. | Fold is empty jobs + partner picker. Usage and Enqueue are far down a 6112px page. | `live-audit/creative-factory-1440.png` · `live-audit/creative-factory-1440-full.png` | **MEDIUM** |
| Brand Studio | owner | no rule — IA | — | Brand Studio lives under **Admin**. Social Studio and Creative Factory live under **Marketing**. Same suite, two homes. | `live-audit/brand-studio-1440.png` | **OPEN-QUESTION** |
| All three | owner | no rule — beta banner | — | Owner-only beta banner is on all three. Matches the earlier owner call. Not scored as a fail. | `live-audit/brand-studio-1440.png` | **OPEN-QUESTION** |

## Fix pass — 2026-08-18

Live Playwright **26/26 = 100/100**. Human click as owner on fundhub.ai. Prove folder: `docs/workflows/build-evidence/wl-marketing/live-prove/`.

Closed: wordmark 404, Social “no partner” lie, Queue hides drafts, Creative Factory stale Enqueue line, picker/banner race, first-paint Enqueue on, preview not updating, Turn on still showing when On.

Left: owner nav (33 tabs), phone overflow, type sizes, `BS-00` codes, Connect still looking live after 503, two homes for Brand Studio vs Marketing, remaining filled buttons under the fold. Partner role was **not** walked this pass.
