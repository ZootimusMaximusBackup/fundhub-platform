# Live re-verify — marketing (owner) — 2026-08-17 20:12–20:13Z

Live `https://fundhub.ai` as `owner@fundhub.ai`. Harness `--no-clicks`. No 503/bounce (0 retries).

Screens: template-editor · campaign-manager · social-studio · creative-factory · content-admin.

Special scan (`body-scan.json` on each slug): Ironwood / Larkspur / Halcyon / `1 CEILING BREACHED` / `NOW = Jul 30` / `static.mjs` are gone on all five. Social Studio still has `scheduler.mjs:56–59`, `src/compliance/screen.mjs`, and `INSERT` prose.

| Line | Screen | Expected | Verdict | Live fact | Evidence |
|---|---|---|---|---|---|
| 222 | PATTERN — 27 shell screens | ≤4 font sizes | **DOES-NOT-HOLD** | All five screens use 6–7 sizes (10/11/12/13/14/18/28). | `_reverify-live/*/audit.md` |
| 223 | PATTERN — 27 shell screens | Content column ≤1280 | **DOES-NOT-HOLD** | Harness width is `div.app` 1440 on four screens; Creative Factory widest block is `table.grid` 2768. | `_reverify-live/creative-factory/audit.json` |
| 224 | PATTERN — every staff/owner screen | ≤7 nav items, all usable | **HOLDS** | 4 visible items (Marketing or Automation group). Campaigns / Social / Creative / Content / Message Copy all opened. | `_reverify-live/*/audit.md` |
| 226 | PATTERN — every shell screen | Header controls clickable; profile in header | **UNVERIFIED** | Profile chip `TEST — Owner Role · owner · 34 tabs [LIVE]` sits in the header on all five. Clicks not run. | `_reverify-live/*/1440-fold.png` |
| 230 | PATTERN — 20 screens | 8px scale; rows of 3/4/6/12 | **DOES-NOT-HOLD** | Off-scale 11/13/14/18/20px on these screens. Uneven card rows on template, campaign, social, content. | `_reverify-live/*/audit.md` |
| 231 | PATTERN — 12 screens | Body text for the role, not the developer | **DOES-NOT-HOLD** | Campaign + Creative have no SQL / `file:line` / `static.mjs`. Social Studio body still has `scheduler.mjs:56–59`, `src/compliance/screen.mjs`, and `INSERT`. Agent codes (CM-00 / SS-00 / CF-01) remain (inventory called that OPEN-QUESTION). | `_reverify-live/social-studio/body-scan.json` |
| 232 | PATTERN — campaign-manager, social-studio, creative-factory | Partner picker lists real partners; rejected read is empty/error | **HOLDS** | No sample book. Campaign: no picker; honest empty (“There is no partner picker on this screen yet”). Social: `#partnerSel` disabled “— no partner list —”. Creative: `#partnerSel` disabled “No partner selected”. Tiles/tables are `—` / “no partner”, not fake numbers. | `_reverify-live/campaign-manager/1440-fold.png` · `social-studio/1440-fold.png` · `creative-factory/1440-fold.png` |
| 233 | PATTERN — campaign-manager, social-studio, creative-factory | One filled button per screen | **DOES-NOT-HOLD** | Each has one page fill plus Chat: Campaign `Sync Meta now`+Chat; Social `Queue post`+Chat; Creative `Enqueue generation`+Chat. Filter chips on those three are outlined, not black. | `_reverify-live/*/audit.json` `primaryLooking` |
| 470 | template-editor.html | Pick-and-edit above the fold; help collapsed | **HOLDS** | Fold shows tiles, draft warning, message list, and “Pick a message on the left…”. `How this works` is a collapsed `<summary>` at y=508. | `_reverify-live/template-editor/1440-fold.png` |
| 471 | template-editor.html | Tiles in 3/4/6/12 spans | **HOLDS** | Four even 282px tiles. Extra 1164 is the stats wrapper, not a fifth tile. | `_reverify-live/template-editor/audit.json` `unevenRows` |
| 472 | template-editor.html | 200 messages need search/filter or paging | **DOES-NOT-HOLD** | 200 list rows painted; page height 8753. No list search, filter, or pager (only shell Search ⌘K). | `_reverify-live/template-editor/audit.md` |
| 473 | template-editor.html | 3–4 sizes | **DOES-NOT-HOLD** | 7 sizes: 28/18/14/13/12/11/10. | `_reverify-live/template-editor/audit.md` |
| 476 | campaign-manager.html | Rejected reads show empty/error, not numbers | **HOLDS** | Five campaign GETs → 400. Tiles are `—`. Tables say “the request was turned down” / “Nothing can be shown until a partner is chosen”. No Ironwood / ceiling-breach sample. | `_reverify-live/campaign-manager/audit.md` · `1440-fold.png` |
| 477 | campaign-manager.html | Status pill reflects a real read or says it failed | **HOLDS** | CM-01: “BOOK BEING SHOWN: No partner selected”. Yellow bar: “0 of 5 panels loaded”. Panel table: “the request was turned down”. | `_reverify-live/campaign-manager/1440-fold.png` |
| 478 | campaign-manager.html | Reload and row-open succeed | **UNVERIFIED** | Reload is on screen. `--no-clicks`. Reads are 400 until a partner is in the URL. | `_reverify-live/campaign-manager/audit.json` |
| 479 | campaign-manager.html | Campaigns nav opens a usable screen | **HOLDS** | HTTP 200. Campaigns marked active. Honest empty, not a bounce or dead page. | `_reverify-live/campaign-manager/audit.md` |
| 480 | campaign-manager.html | Write controls only on real rows; confirm | **HOLDS** | Only write is `Sync Meta now`, disabled, below the fold. No pause/archive armed on empty tables. Confirm not seen (`--no-clicks`). | `_reverify-live/campaign-manager/audit.json` |
| 481 | campaign-manager.html | One filled button | **DOES-NOT-HOLD** | Filled: `Sync Meta now` (disabled) + Chat. Filter chips `all`/`breached`/`ok` are white/gray, not primary. | `_reverify-live/campaign-manager/audit.json` |
| 482 | campaign-manager.html | Default view = daily 20% | **HOLDS** | Fold is spend tiles, book-being-shown, and “did each panel load?”. Long tables sit below. | `_reverify-live/campaign-manager/1440-fold.png` |
| 483 | campaign-manager.html | Failed reads say what failed and to pick a partner | **HOLDS** | Copy says pick a partner / use a link that already has the partner. “There is no partner picker on this screen yet.” | `_reverify-live/campaign-manager/1440-fold.png` |
| 484 | campaign-manager.html | What failed and what to do next | **HOLDS** | Same as 483. No raw `400` in the body. | `_reverify-live/campaign-manager/1440-fold.png` |
| 485 | campaign-manager.html | 3/4/6/12 spans; ≤4 sizes; 8px scale | **DOES-NOT-HOLD** | 7 sizes. Off-scale 14/13/18/11. Uneven rows at y=120 and y=1528. | `_reverify-live/campaign-manager/audit.md` |
| 486 | campaign-manager.html | NOOP triage (—) | **UNVERIFIED** | `--no-clicks`. | `_reverify-live/campaign-manager/audit.md` |
| 488 | social-studio.html | Real partners; clock is now; composer empty | **HOLDS** | Picker honest empty (“— no partner list —”). Clock `NOW = AUG 17 20:13Z` (not Jul 30). Caption textarea empty. No Ironwood / Larkspur / Halcyon. LinkedIn org field still shows `12345678` (disabled). | `_reverify-live/social-studio/1440-fold.png` · `body-scan.json` |
| 489 | social-studio.html | Connect starts OAuth or says what is missing | **HOLDS** | Connect Facebook / Instagram / LinkedIn are disabled. Copy says no partner and apps are not provisioned (`docs/STILL-MISSING.md`). OAuth start not clicked. | `_reverify-live/social-studio/audit.json` · `1440-full.png` |
| 490 | social-studio.html | Publish due now names what will go out | **UNVERIFIED** | Button is on screen and disabled. `--no-clicks` — no confirm text seen. | `_reverify-live/social-studio/audit.json` |
| 491 | social-studio.html | Unbuilt features do not render | **HOLDS** | No “coming soon” control. Connect/publish sit disabled with an empty-state reason. | `_reverify-live/social-studio/1440-full.png` |
| 492 | social-studio.html | One filled button | **DOES-NOT-HOLD** | Filled: `Queue post` (disabled) + Chat. Queue / Review / Failed / Published / Audit chips are white, not filled black. | `_reverify-live/social-studio/audit.json` |
| 493 | social-studio.html | Empty copy agrees with the controls | **HOLDS** | Blue box: no partner, picker has no list. Tiles say “no partner selected”. Connect/Queue/Publish disabled. | `_reverify-live/social-studio/1440-fold.png` |
| 494 | social-studio.html | 12-col; ≤4 sizes; 8px scale | **DOES-NOT-HOLD** | 7 sizes. Off-scale 14/13. Uneven rows at y=120 and y=976. | `_reverify-live/social-studio/audit.md` |
| 495 | social-studio.html | NOOP triage (—) | **UNVERIFIED** | `--no-clicks`. | `_reverify-live/social-studio/audit.md` |
| 496 | creative-factory.html | Partner picker lists real partners; real book | **HOLDS** | `#partnerSel` present, disabled, “No partner selected”. No sample book. Jobs/review tables empty with the same line. | `_reverify-live/creative-factory/1440-fold.png` |
| 497 | creative-factory.html | Search ⌘K clickable at 1440 | **UNVERIFIED** | `Search⌘K` is visible, enabled, 99×36, above the fold. `--no-clicks`. | `_reverify-live/creative-factory/audit.json` |
| 498 | creative-factory.html | Reject/Archive confirm; asset from a list | **HOLDS** | Asset control is a select (“No creatives loaded…”), not a pasted id. Reject / Archive / Approve are disabled. Confirm not seen. | `_reverify-live/creative-factory/audit.json` |
| 499 | creative-factory.html | One filled button | **DOES-NOT-HOLD** | Filled: `Enqueue generation` (disabled) + Chat. Job chips `all`/`queued`/… are gray/white, not black. | `_reverify-live/creative-factory/audit.json` |
| 500 | creative-factory.html | Default view = daily 20% | **HOLDS** | Fold is partner scope + empty jobs. Enqueue / reject sit far below (y≈5594). | `_reverify-live/creative-factory/1440-fold.png` |
| 501 | creative-factory.html | 12-col; ≤4 sizes; 8px scale | **DOES-NOT-HOLD** | 6 sizes. Off-scale 13/20/14. Widest block 2768. | `_reverify-live/creative-factory/audit.md` |
| 502 | creative-factory.html | NOOP/GONE triage (—) | **UNVERIFIED** | `--no-clicks`. | `_reverify-live/creative-factory/audit.md` |
| 503 | content-admin.html | Nav opens a screen whose primary action works today | **DOES-NOT-HOLD** | Content nav opens HTTP 200. Screen says nothing is saved and “the video library has not been built.” Active preview chip `Card Stacking DFY` is filled black like a primary. | `_reverify-live/content-admin/1440-fold.png` · `audit.json` |
| 504 | content-admin.html | 3–4 sizes | **DOES-NOT-HOLD** | 7 sizes: 28/18/14/13/12/11/10. | `_reverify-live/content-admin/audit.md` |
| 505 | content-admin.html | 12-col; 8px scale | **DOES-NOT-HOLD** | Off-scale 14/13. Uneven rows at y=200 and y=328. | `_reverify-live/content-admin/audit.md` |

## Counts

- **HOLDS:** 18
- **DOES-NOT-HOLD:** 16
- **UNVERIFIED:** 7 (all `--no-clicks`)

HOLDS: 224, 232, 470, 471, 476, 477, 479, 480, 482, 483, 484, 488, 489, 491, 493, 496, 498, 500.

DOES-NOT-HOLD: 222, 223, 230, 231, 233, 472, 473, 481, 485, 492, 494, 499, 501, 503, 504, 505.

UNVERIFIED: 226, 478, 486, 490, 495, 497, 502.
