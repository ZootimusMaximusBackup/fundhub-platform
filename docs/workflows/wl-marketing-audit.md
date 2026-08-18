# WL marketing UI audit — 2026-08-17

**COMPLIANCE REVIEW REQUIRED** — this pass looked at generated page copy, social posts, and ad-factory write controls on the live site.

**What this is:** read-only UI audit of three live screens against `docs/UI-STANDARDS.md` and `docs/journeys/white-label-intended.md` § Marketing suite (beta). Findings only. Nothing was fixed.

**Where:** https://fundhub.ai · role **owner** (`owner@fundhub.ai`) · partner **TEST — White-Label Partner Role** (`9defaf28-47c5-43a0-8f5e-f41ef90f360a`)
**Evidence:** `docs/workflows/build-evidence/wl-marketing/live-audit/`
**How:** signed in as owner (password from gitignored `.env`, never printed). Did **not** sign in as `partner@fundhub.ai`. Walk + 1440 / 390 shots. Writes were blocked except the one wordmark click needed to prove the known miss. `audit.json` holds the raw counts.

**Counts this pass:** **4 CRITICAL · 8 HIGH · 6 MEDIUM · 1 LOW · 2 OPEN-QUESTION**

## Known notes — verified, not assumed

| Note | Verdict |
|---|---|
| Brand Studio: Write page copy succeeded | **Yes.** Copy history for Application funnel, stamps `2026-08-17 23:33`, sections hero / process / engine / options / cta. |
| Brand Studio: legal “Not a direct lender” stayed | **Yes.** Preview footer still has that line. Entity line still says “Your Entity LLC” (name fields were empty). |
| Brand Studio: wordmark button returned `not_found` | **Yes.** Live `POST /api/partner-marketing/generate-logo` → **404**. On-screen text is the raw code `not_found`. |
| Brand Studio: save bar can intercept Turn on | **Partial.** On 1440, Turn on sat above the sticky Save bar after scroll — click-steal not proven. On 390 the Save bar sits on the generation buttons. |
| Social Studio: Write 3 posts succeeded | **Yes.** `GET /api/social/posts` → **3** rows. |
| Social Studio: Connect Facebook / Instagram / LinkedIn visible for owner | **Yes.** All three show for owner. Click Facebook: honest “not set up yet” (start call **503**). |
| Social Studio: queued tiles still 0 after “Wrote 3 posts” | **Yes.** All 3 rows are `draft`. Queue tile and Queue tab both **0**. No Draft tab. |
| Creative Factory: Enqueue disabled at first paint | **No — opposite.** First paint: Enqueue was **on** while the budget still said “Loading…”. |
| Creative Factory: picker vs banner can disagree | **Yes.** Picker flipped to DEMO Northlight; banner and id stayed on TEST for a beat; Enqueue stayed on. |

## Findings

| Screen | Role | Standard | Expected | Observed | Evidence | Severity |
|---|---|---|---|---|---|---|
| Brand Studio | owner | §5 Every control works · §6 Error is true | “Make a wordmark from the name” makes a mark, or the button is hidden. Fail text is in plain words. | Click sent `POST /api/partner-marketing/generate-logo` and got **404**. The line under the buttons says `not_found`. | `live-audit/brand-studio-1440-wordmark.png` · `audit.json` `wordmark` | **CRITICAL** |
| Brand Studio | owner | §1 One job, one primary, job above the fold | One filled button. The write / turn-on work is doable on a 900px-tall screen. | Four filled buttons: Create pages, Turn on, Write page copy, Save & apply. Turn on still shows while the chip already says **On**. Generation sits at ~2447px — far under the fold. Above the fold is empty identity fields with Meridian placeholders. | `live-audit/brand-studio-1440.png` · `live-audit/brand-studio-1440-wordmark.png` | **HIGH** |
| Brand Studio | owner | §5 Action answers back | After copy is written, the preview the owner is looking at updates. | History has five blocks from 23:33. Preview still says “Your Brand” and the stock headline. Legal line stayed (good). | `live-audit/brand-studio-1440.png` · `live-audit/brand-studio-1440-full.png` | **HIGH** |
| Brand Studio | owner | §11 Phone · §5 Big targets | One column. No sideways scroll. Save bar does not cover the next click. | 390: page is 623px wide. Rail still on the page. Sticky **Save & apply** + Chat sit on Submit / generation. | `live-audit/brand-studio-390.png` · `live-audit/brand-studio-390-full.png` | **HIGH** |
| Brand Studio | owner | §3 Type · leftover codes | 3–4 sizes. No panel codes in the page. | 5 sizes (11 / 13 / 14 / 18 / 28). Eyebrows still say `BS-00` … `BS-07`. | `live-audit/brand-studio-1440.png` · `audit.json` `dom1440` | **MEDIUM** |
| Brand Studio | owner | §5 Save bar vs Turn on (named note) | Turn on is clickable. Sticky save does not steal the click. | 1440: Turn on stayed above the bar; `elementFromPoint` at page-top was null (button off-screen). 390: bar sits on the generation row. Named desktop intercept **not proven**. | `live-audit/brand-studio-1440-wordmark.png` · `live-audit/brand-studio-390-full.png` | **MEDIUM** |
| Brand Studio | owner | Journey: locked legal | Locked “not a direct lender” never goes to the writer and never gets overwritten. | Preview footer still has “Not a direct lender.” | `live-audit/brand-studio-1440-legal.png` | *(pass — not a fail)* |
| Social Studio | owner | §6 Error is true | If a partner is picked, the page does not say none is picked. | Partner picker = TEST. Blue bar = “Showing TEST — White-Label Partner Role.” Compose and Connect still said **“No partner is selected.”** Write 3 posts was live. | `live-audit/social-studio-1440-full.png` · `live-audit/social-studio-1440-connect.png` | **CRITICAL** |
| Social Studio | owner | §5 / §6 Full vs empty | After “Wrote 3 posts”, the owner sees those posts. | API has **3** `draft` captions. Queued tile **0**. Queue tab **0** (“Nothing queued”). Workbench also says “3 of 3 posts match.” No Draft tab. | `live-audit/social-studio-1440.png` · `live-audit/social-studio-1440-queue.png` · `audit.json` `postsApi` | **HIGH** |
| Social Studio | owner | §11 Phone | One column. No sideways page scroll. Chip in the header. | 390: page is 574px wide. Name chip covers Search / Derivation. Rail still on the page. | `live-audit/social-studio-390.png` | **HIGH** |
| Social Studio | owner | Journey §4 Connect is for staff | Owner may see Connect. Partner must not. Buttons that cannot connect do not look live. | Owner sees Connect Facebook / Instagram / LinkedIn (allowed). Click Facebook: **503**, then honest “Facebook is not set up yet.” All three still look live after that. | `live-audit/social-studio-1440-connect-click.png` | **MEDIUM** |
| Social Studio | owner | §3 / slop: no SQL as body | Derivation is for builders, not the daily screen. | Open Derivation prints `count(social_channels WHERE partner_id = $1)` and `049_social.sql:43-44`. Connect help cites `docs/STILL-MISSING.md`. | `live-audit/social-studio-1440.png` · `live-audit/social-studio-1440-full.png` | **MEDIUM** |
| Social Studio | owner | §1 One primary | One filled button. | **Write 3 posts** and **Queue post** are both filled. | `live-audit/social-studio-1440-full.png` | **MEDIUM** |
| Social Studio | owner | §8 Familiar patterns | Placeholders do not look like real IDs. | LinkedIn org box shows `12345678` (placeholder) next to live Connect buttons. | `live-audit/social-studio-1440-connect-click.png` | **LOW** |
| Creative Factory | owner | §6 Error is true | After the budget loads, the line next to Enqueue matches the card. | Usage card: On? **Yes** · used 1458 · left 248542 · cap 250000. Line next to Enqueue still says **“Writing tools stay off until the budget loads.”** Enqueue is on. Header chip also says **READ ONLY**. | `live-audit/creative-factory-1440.png` · `live-audit/creative-factory-1440-full.png` · `audit.json` `settled` | **CRITICAL** |
| Creative Factory | owner | §5 Control matches the partner on screen | Picker, banner, and Enqueue agree. A write button is off until the new partner’s budget is in. | On change to DEMO Northlight: picker = Northlight, banner + id still TEST, budget “Loading…”, Enqueue **still on**. After ~1.8s they agree and Enqueue goes off (that demo partner is Off). | `live-audit/creative-factory-1440-picker-disagree.png` · `audit.json` `pickerImmediate` | **CRITICAL** |
| Creative Factory | owner | §5 / named first-paint note | Enqueue is off until a partner and budget are ready. | First paint: picker empty, banner “one partner”, budget “Loading…”, Enqueue **enabled** (not disabled). Named “disabled at first paint” was **not** what live did. | `live-audit/creative-factory-1440-first-paint.png` · `audit.json` `firstPaint` | **HIGH** |
| Creative Factory | owner | §11 Phone | One column. No sideways page scroll. | 390: `scrollWidth` **1280**. Name chip covers Search and the first metric. Cards collide. | `live-audit/creative-factory-390.png` | **HIGH** |
| Creative Factory | owner | §4 Nav ≤7 · location | ≤7 top-level items. Current page obvious. | Owner chip: **33 tabs**. Eight groups. Creative Factory is marked on. Same owner-nav miss as the rest of the CRM. | `live-audit/creative-factory-1440.png` | **HIGH** |
| Creative Factory | owner | §1 / §9 Daily 20% | Default view is the day’s job (usage + generate), not the whole factory. | Fold is empty jobs + partner picker. Usage and Enqueue are far down a 6112px page. | `live-audit/creative-factory-1440.png` · `live-audit/creative-factory-1440-full.png` | **MEDIUM** |
| Brand Studio | owner | no rule — IA | — | Brand Studio lives under **Admin**. Social Studio and Creative Factory live under **Marketing**. Same suite, two homes. | `live-audit/brand-studio-1440.png` | **OPEN-QUESTION** |
| All three | owner | no rule — beta banner | — | Owner-only beta banner is on all three. Matches the earlier owner call. Not scored as a fail. | `live-audit/brand-studio-1440.png` | **OPEN-QUESTION** |

## Left for a named fix pass

Fixer started 2026-08-17 after Chris said to get the CRITICAL rows done.

Code landed in this pass for: wordmark upsert, Social “no partner” lie, Queue shows drafts, Creative Factory budget/enqueue/picker race, Turn on hidden when On, preview hero from first page.

Live prove (Playwright 100/100 + human click) is next. Rows stay CRITICAL/HIGH until that evidence is in.

Not in this pass: owner nav, phone overflow, type sizes, `BS-00` codes, Connect still looking live after 503, OPEN-QUESTION rows.
