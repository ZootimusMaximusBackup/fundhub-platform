# Manifest A — Creative Factory declutter

**COMPLIANCE REVIEW REQUIRED** — statute citations (CROA / FTC Act / FTC Endorsement Guides / TikTok policy) are removed from the screen. No enforcement code is touched; only what is displayed.

Lane A. Owns exactly one file: `public/app/creative-factory.html`. Batch board: `docs/workflows/creative-factory-declutter-2026-08-17.md`. HEAD at start: `7be91a0`. File was 2275 lines at start.

---

## STEP 1 — Ground brief: every builder-facing string a user can see

Line numbers are against the file **as it stood at `7be91a0`**.

### A. Static HTML a user reads

| Line | What is on screen | Verdict |
|---|---|---|
| 519 | Block-reason table headers: `Code` · `Rule set` · `Match` · `Severity` · `Applies to` · `Citation` | **GO** — this is the machinery the owner named |
| 557 | Readiness table header `Rows set` | **GO** — a database row count shown as a column |
| 499–500 | Review-queue header `Subtype` | **GO** — plain word instead |
| 602–603 | Field label `Unique key` with placeholder `unique-key-per-batch` | **GO** — plain wording |
| 426, 464, 506, 535 | `<div class="req" id="jobReq/libReq/apprReq/kitReq">` — the request-URL lines | **GO** — see finding F1: they were already dead |
| 427, 440, 465, 484, 507, 523, 536, 550–553, 562–565, 580–582, 590–593, 610–613, 626–630 | Plain-language captions | **KEEP** (some reworded where they carried machinery) |

### B. Page CSS that exists only for builder furniture

| Line | What | Verdict |
|---|---|---|
| 97–103 | `.deriv` — the "derivation strip" that showed how each number was computed | **GO** — dead; no `.deriv` element is produced anywhere |
| 126–128 | `.req` — the request-URL line styling | **GO** — dead (F1) |

### C. HTML and script comments — invisible to a user

A user never sees these. Recorded because the task asked which were left and which were tidied.

| Line | What | Verdict |
|---|---|---|
| 259–301 | The `BUILT FROM` block: `db/migrations/045…052`, `api/creative/*.mjs`, `src/creative/generate.mjs`, `src/compliance/screen.mjs`, `src/http/partner-read-api.mjs`, `read-api.mjs:18` | **TIDIED** — cut to a short provenance note; the file-and-line list is gone |
| 381, 384, 407, 430, 443, 468, 487, 510, 526, 539, 568, 585 | Panel codes `CF-00` … `CF-12` in HTML comments | **TIDIED** — comments retitled in plain words |
| 194, 287, 300, 689, 853, 965, 1118–1127, 1202, 1344, 1377, 1524, 1695, 1752 | More `CF-nn` codes and file:line references in script comments | **TIDIED** where the panel moved; otherwise left |
| 659–666 | Database CHECK-constraint enums (`generation_jobs_status_ck`, `creative_assets_kind_ck (045:198)`, …) | **LEFT** — real provenance for the next builder, invisible to a user |
| 696–725, 809–814 | The rule-catalogue source comment (`047:205-300`, `screen.mjs:251`, `targeting.mjs:162`, `screen.mjs:154-157`, `screen.mjs:200`, `generate.mjs:216`) | **LEFT, trimmed** — the part describing removed columns is gone; the provenance stays |

**Finding: no `CF-nn` code was ever visible to a user.** All twelve live in comments only. The board's line 26 assumed otherwise. Nothing to strip there.

**Finding: `PLACEHOLDER set in 052 — AWAITING SIGN-OFF` is not in this file.** The readiness table already reads `Placeholder — not signed off`. The live audit that recorded the old string (`docs/workflows/ui-audit-evidence/_reverify-live/creative-factory/audit.md`) was taken against a deploy older than `7be91a0`.

### D. Strings built inside `<script>` that a user reads

**Jobs table**

| Line | What is on screen | Verdict |
|---|---|---|
| 1255 | `derives, not a kind` under a `resize` job | **GO** |
| 1256, 1257, 1260 | `nul('null')` — prints the literal word **null** in the Formats, Variants and Provider cells | **GO** → `—` |

**Job detail (expand a job row)**

| Line | What is on screen | Verdict |
|---|---|---|
| 1280–1283 | Column names as labels: `id`, `idempotency_key`, `brand_kit_id`, `started_at`, `finished_at` | **GO** → plain labels |
| 1283 | `asset_count` + `· via generation_job_assets` (a database table name) | **GO** |
| 1290 | Section label `error` | **GO** → "What went wrong" |

**Review queue detail (expand a queue row)**

| Line | What is on screen | Verdict |
|---|---|---|
| 1641–1642 | Labels `item_type`, `id` | **GO** |
| 1643–1646 | Label `subtype` with sub-label `strategy_key (nullable)` / `creative_assets.kind` | **GO** |
| 1644 | `<span class="nul">null</span>` | **GO** |
| 1647–1649 | Label `detail` with sub-label `campaigns.name` / `creative_assets.format` | **GO** |
| 1652 | Label `budget_cents` with the raw cent count | **GO** |
| 1653 | Label `offer_type / platform` | **GO** |
| 1654–1656 | "Screening history, unwrapped. Each element is `{code: <screening state>, message: <reasons ARRAY>}` — `message` is a nested array, not a string." | **GO** |
| 1660 | Badge `state: blocked` | **GO** → plain |
| 1662 | "reasons: `[]` — a passed screening carries none." | **GO** |
| 1667 | "Impossible row: TikTok + credit_repair is blocked by CHECK `campaigns_tiktok_credit_repair_ck`." | **GO** |
| 1670–1673 | "Structural, no override … needs `approved_by` … (CHECK `campaigns_credit_repair_approver_ck`) … without `disclosure_asset_id` (`trg_campaign_disclosure_gate`)" | **GO** → plain |
| 1676–1677 | Labels `ai_generated` / `synthetic_performer` with values `true` / `false` | **GO** → plain labels, Yes / No |
| 1681–1683 | "A pending asset carries `blocked_reasons = []` … pending is the safe resting state an asset is inserted at, before screening, so a crash leaves a visible row rather than an unscreened one." | **GO** → plain |
| 1687–1691 | "Blank, not false: `ai_generated` and `synthetic_performer` are NULL on every campaign row." / "`budget_cents`, `offer_type` and `platform` are NULL on every asset row." | **GO** |

**Reason cards** — one function, rendered in three places (block-reason detail 1733, review-queue detail 1680, creative drawer 1915)

| Line | What is on screen | Verdict |
|---|---|---|
| 1629 | The machine code, e.g. `guaranteed-score-increase` | **KEEP**, demoted to a small muted reference line |
| 1630 | Rule-set badge: `croa`, `claims`, `disclosure`, `platform`, `approval`, `engine` | **GO** |
| 1631 | Severity badge: `block` | **GO** |
| 1634 | **The statute citation**, e.g. `CROA 15 U.S.C. 1679b(a)(3)` | **GO** — this is the owner's ask, and it leaked into the creative drawer as well as the table |
| 1635 | `detail: <raw error text>` | **GO** → "More detail" |

**Block-reason catalogue (the table the owner named)**

| Line | What is on screen | Verdict |
|---|---|---|
| 1699–1701 | Rule-set filter rail: `all` `croa` `claims` `disclosure` `platform` `approval` `engine` | **GO** |
| 1713–1714 | Origin sub-labels `editable rule` / `platform term · not editable` / `built in · not editable` | **GO** → plain "who sets it" wording |
| 1716–1720 | Severity cell: badge, or `—` plus `needs a person to approve` / `counts as a hard block` | **GO** |
| 1725 | Match column: `regex` / `required` / `—` | **GO** |
| 1729 | Citation column | **GO** |
| 1735–1744 | Per-rule expandable explanation | **GO** — folded into one plain sentence for the whole section |

**Brand kits**

| Line | What is on screen | Verdict |
|---|---|---|
| 1945 | Drawer heading **"Row, as the endpoint returns it"** with raw columns `id` `name` `status` `asset_count` `source_url` `scraped_at` `logo_asset_id` `created_at` `updated_at` | **GO** → plain labels |
| 1957, 1959, 1961, 1964 | Four `jsonbox` blocks dumping raw JSON at the user: `palette`, `fonts`, `voice_profile`, `products` | **GO** → the same real values, listed plainly |
| 1971–1976 | **"Counting"** section: "`asset_count = N` is a correlated subquery over every non-archived asset with this `brand_kit_id` … `limit` … `?include_archived=1` … `brand_kits_partner_name_uniq`" | **GO** → one plain sentence |
| 1803 | `(reference, not a picture)` beside Logo | **KEEP** |

**Creative drawer (library)**

| Line | What is on screen | Verdict |
|---|---|---|
| 1880 | Drawer heading **"Row, as the endpoint returns it"** with raw columns `id` `kind` `format` `provider` `compliance_state` `duration_sec` `ai_generated` `synthetic_performer` `brand_kit_id` `brand_kit_name` `parent_asset_id` `archived_at` `created_at` | **GO** → plain labels |
| 1874 | `kv()` prints the literal word `null` for any empty value | **GO** → `—` |
| 1921–1923 | Section **"What this screen is not told"** | **GO** — the same fact is already stated plainly in the caption at 626–630 |
| 1901–1902 | "Shape 1x1. Exact pixel sizes are not recorded." | **KEEP** |

**Readiness table data**

| Line | What is on screen | Verdict |
|---|---|---|
| 875, 878 | Detail cells `rate = 100` and `rate = 10` | **GO** → plain |
| 895–900 | `RATES` array | **Found, not touched.** It is dead: `#ratesBody` does not exist in the page, and `renderStaticTables` guards on it. Its two rows duplicate two readiness rows. |

**Banners, errors and action messages**

| Line | What is on screen | Verdict |
|---|---|---|
| 2091 | Banner: `creative factory — demo session, the backend was not queried and nothing is shown` | **GO** → plain |
| 2137 | Banner: `creative factory · jobs:api · assets:nodb · kits:api · approvals:api` (`CF_SRC` joined) | **GO** → plain |
| 2037 | `demo session — no backend read attempted` | **GO** |
| 2042 | `fetch unavailable` | **GO** |
| 2045 | `not signed in, or role is not staff/partner` | **GO** |
| 2049 | `/api/* not deployed` | **GO** |
| 2050 | `no such record` | **GO** → plain |
| 2062 | `response was not JSON` | **GO** |
| 2206–2207 | `Created job <uuid>. Runner cron picks it up, or click Run queued jobs now.` — and `Deduped` | **GO** → plain |
| 2244 | `Ran N job(s).` | reworded |
| 2267–2268 | `approve ok · state=approved · archived` | **GO** → plain |

---

## STEP 1 (second half) — where each of the 29 block-reason rows truly comes from

Read from the code, not from the board. **All 29 rows have a real source. There is no orphan row, and nothing on the screen was invented.**

### 12 rows — `db/migrations/047_compliance_rules.sql`, lines 205–300

One `INSERT … SELECT … CROSS JOIN (VALUES …)` seeded into the default org. Every code, message, severity and citation on the screen matches the migration word for word.

| Code | Rule set | Severity in the table | Citation in the migration |
|---|---|---|---|
| `guaranteed-score-increase` | croa | block | CROA 15 U.S.C. 1679b(a)(3) |
| `promise-to-remove-accurate-info` | croa | block | CROA 15 U.S.C. 1679b(a)(3) |
| `remove-late-payments-collections` | croa | block | CROA 15 U.S.C. 1679b(a)(3) |
| `advance-fee` | croa | block | CROA 15 U.S.C. 1679b(b) |
| `file-segregation-cpn` | croa | block | CROA 15 U.S.C. 1679b(a)(1)-(2) |
| `guaranteed-timeline` | croa | block | CROA 15 U.S.C. 1679b(a)(3) |
| `guaranteed-approval` | claims | block | FTC Act 15 U.S.C. 45 |
| `guaranteed-funding-amount` | claims | block | FTC Act 15 U.S.C. 45 |
| `fabricated-testimonial` | claims | block | FTC Endorsement Guides 16 CFR 255 |
| `income-wealth-targeting-cue` | claims | block | Meta special ad category / ECOA |
| `croa-consumer-rights` | disclosure | block | CROA 15 U.S.C. 1679c(a) |
| `tiktok-credit-repair-prohibited` | platform | block | TikTok Advertising Policies — Prohibited Industries |

`severity` is a real column, CHECKed to `block` or `warn` (`compliance_rules_severity_ck`, 047:75). All twelve ship as `block`; **no `warn` rule exists anywhere**, so the screen never had a warnings bucket to show.

### 8 rows — `src/compliance/screen.mjs`

| Code | Where in the code | rule_set the code sets |
|---|---|---|
| `screen_error` | :93 (literal object in the catch) | `engine` |
| `offer_type_missing` | :119 via `blocked()` | `engine` |
| `platform_unknown` | :123 via `blocked()` | `engine` |
| `tiktok_credit_repair_prohibited` | :133 via `blocked()` | `platform` |
| `special_ad_category_unset` | :148 via `r()` | `platform` |
| `synthetic_without_ai_flag` | :196 via `r()` | `disclosure` |
| `human_approval_required_credit_repair` | :210 via `r()` | `approval` |
| `human_approval_required_setting` | :218 via `r()` | `approval` |

`r()` is defined at :251 and `blocked()` at :252. **Neither sets a `severity` key** — so every one of these eight carries `severity === undefined`. The old table printed `—` in the Severity column for them and explained the absence in two sub-labels. That whole column is now gone.

Two of the eight are approval gates, not blocks: `human_approval_required_credit_repair` and `human_approval_required_setting` return `state: "needs_approval"` (:209, :217).

### 9 rows — `src/compliance/targeting.mjs`

All built by `reason(code, message)` at :162, which hard-codes `rule_set: "platform"` and sets no severity and no citation.

`targeting_missing` (:38) · `targeting_malformed` (:42) · `zip_targeting` (:56, :60) · `radius_too_small` (:68) · `location_exclusion` (:76) · `age_range` (:84, :88) · `gender_restriction` (:99) · `lookalike_audience` (:108, :114) · `detailed_targeting_expansion` (:126) — nine distinct codes across twelve push sites.

**Scope, verified in code:** `screen.mjs:154-157` splices these in only when `targeting !== undefined && platform === "meta"`. An asset screening passes no `targeting` key at all, so none of these nine can ever land in `creative_assets.blocked_reasons`. They reach campaigns only. That is why the screen's `platforms:['meta']` on all nine is faithful, not invented.

12 + 8 + 9 = **29**. Matches the screen exactly.

**One faithfulness note, not a gap:** four engine/targeting messages are templated in code (`offer_type_missing`, `platform_unknown`, `radius_too_small`, `age_range` interpolate a value). The screen replaces the interpolated part with `<the value>`, `<n>` and `<where>`. That is a placeholder, not invented data, and it survives the rewrite.

---

## STEP 2 — What changed, and why

File: `public/app/creative-factory.html` only. 2275 lines → 2205. Diff vs HEAD: 409 added, 479 removed.

### 1. The block-reason table — the owner's main ask

- The six-column table `Code · Rule set · Match · Severity · Applies to · Citation` is gone from the page body.
- It is now a **closed** `<details class="scopebar">` titled **"Why creative gets stopped"**, inside a new
  **Reference** card at the bottom. Same disclosure idiom as `public/app/affiliate.html:233`; the CSS is copied
  from that file's `:111-115`. No new widget was invented.
- The table inside it is three plain columns: **Applies to · What it stops · Who sets it**. No statute numbers,
  no `Rule set`, no `Match`, no `Severity`.
- **Every statute citation is gone from the file, not just from the view.** Nothing read `r.citation` after the
  rewrite, so the 29 `citation:` properties were deleted from the `RULES` array as dead data. Verified:
  `grep -c "15 U.S.C\|16 CFR\|FTC Act\|Endorsement Guides\|1679b\|1679c"` → **0**.
- Exactly one link out: `../../docs/compliance/creative-block-reasons.md#every-block-reason` (Lane B's file and
  anchor, both confirmed on disk).
- The section's summary sentence was corrected on Lane B's finding: it now says **27 of the 29 reasons stop the
  work and two hold it for a person**, instead of the old blanket "Each reason stops the work." Verified in the
  rendered page: 27 rows carry the stop stripe, 2 carry the hold stripe. The two claims Lane B confirmed
  (credit-repair always needs a person; credit-repair cannot run on TikTok) are kept, in plain words.
- The rule-set filter rail (`all croa claims disclosure platform approval engine`) is gone, with `S.ruleSet`.

### 2. Builder text stripped

Everything marked **GO** in the Step 1 inventory is gone. The heavy items:

- **Both "Row, as the endpoint returns it" drawers** — the creative drawer and the brand-kit drawer — now use
  plain labels ("Kind", "Shape", "Made by", "Brand kit", "Created", "Reference"). Same real values.
- **Four raw-JSON dumps** in the brand-kit drawer (`palette`, `fonts`, `voice_profile`, `products`) are now
  plain lists built from the same objects by two new helpers, `plainPairs()` and `plainList()`. An empty kit
  says "Nothing set." — nothing is filled in.
- **The whole review-queue detail** was rewritten: `item_type` / `subtype` / `strategy_key (nullable)` /
  `campaigns.name` / `budget_cents` / `{code: <screening state>, message: <reasons ARRAY>}` / `blocked_reasons = []`
  / `CHECK campaigns_credit_repair_approver_ck` / `trg_campaign_disclosure_gate` are all gone.
- **`reasonCard()`** — used in three places — no longer prints the rule-set badge, the severity badge or the
  citation. It prints the message, then the reason code as a small muted `reference:` line so a person can look
  it up in Lane B's file.
- **The "Counting" section** on a brand kit (correlated subquery, `brand_kit_id`, `?include_archived=1`,
  `brand_kits_partner_name_uniq`) is one plain sentence.
- **The word `null`** no longer reaches a user anywhere — the jobs table, `kv()` and the queue detail all print `—`.
- **Read failures** are in words a person can act on: "this sign-in is not allowed to see this partner" instead
  of `not signed in, or role is not staff/partner`; "this part of fundhub is not switched on yet" instead of
  `/api/* not deployed`.
- **The load banner** no longer prints `jobs:api · assets:nodb`. It names the panels that did not load, or says
  everything loaded.
- **Write messages**: "Runner cron picks it up" and `approve ok · state=approved` are gone.
- **The dead request-URL rail** — `setReq()`, its four call sites, the four `.req` divs, the `.req` CSS and
  `S.showReq` — all removed. See finding F1.
- **The dead `.deriv` "derivation strip" CSS** removed. Nothing rendered it.
- **The dead `.jsonbox` CSS** removed, now that no JSON is dumped.
- HTML comments: the `BUILT FROM` block listing seven migrations and eight source files is cut to a short plain
  note; the `CF-00`…`CF-12` comment banners are retitled in plain words. Comments are invisible to a user — this
  was tidying, not a fix.

### 3. Layout refresh

Panel order, before → after (verified in the rendered page):

| Before (HEAD) | After |
|---|---|
| Summary tiles | Summary tiles |
| Partner scope | Partner scope |
| Generation jobs | **Writing budget** |
| Job states | **Generate and decide** ← the primary action, now above the fold |
| Creative library | Generation jobs |
| AI disclosure flags | Creative library |
| Review queue | Review queue |
| **Block reasons (open table, 29 rows, citations)** | Brand kits |
| Brand kits | **Reference** (closed): job states · AI labels · why creative gets stopped · engine settings |
| Readiness | |
| Usage | |
| Generate and decide (last) | |

Standards checked in the rendered page at 1440×900:

- **§1 one primary** — exactly one filled button on the page: "Enqueue generation". It is now the third panel
  instead of the last.
- **§1 width cap** — content column 1212px, under the 1280px `fh-maxw` cap. Cap kept.
- **§3 font tokens** — two distinct sizes in the content column (14px body, 11px caption). No literal px
  font-size exists in the file; all four tokens only.
- **§9** — all four reference sections render closed.
- **§11** — no text under 11px anywhere in the page.

### 4. The 390px faults named in the brief

Measured in an identical local harness, my version against `git show HEAD:public/app/creative-factory.html`:

| Measure at 390×844 | Before (HEAD) | After |
|---|---|---|
| `document.scrollWidth` | **1280** | **499** |
| Content column width | 1280 | **390** — fits exactly |
| `.content` scrollWidth | 1280 | **390** — nothing inside it overflows |
| Summary tiles | multi-column | **1 column** |
| Text under 11px | — | **none** |
| Jobs / queue tables | pushed past the right edge | contained; scroll inside their own box |

**Root cause of the 1280, found and fixed.** `.content` carries `fh-maxw`, which sets `margin-inline:auto`. An
auto side margin cancels flex stretch, so the column had no width of its own and sized itself to its widest
table — 1280px. `.content` now sets `width:100%` (plus `min-width:0`), which restores the stretch; `max-width`
and the auto margins still cap and centre it on a wide monitor. The top bar was also a single unwrapping flex
row; it now wraps below 640px.

**The remaining 109px is not this screen.** With the content column at exactly 390px, the page still reports
scrollWidth 499. The overflow is `#fh-shell-chip`, the session chip that **`public/app/shell.js`** injects into
the top bar — 434px wide and non-shrinking. `shell.js` is a shared file I do not own and did not touch. This is
the same shared-file finding already recorded in `docs/workflows/ui-audit-2026-08-17.md` ("the fixed session chip
… covers whatever a screen puts there"). Fixing it belongs in a shell.js unit, not here.

### 5. Nothing was invented

- No new number, tile, comparison, vendor name or count was added.
- Every block-reason message is still verbatim from the code that enforces it.
- The two placeholder billing rates still say "Placeholder — not signed off"; their detail cells changed from
  `rate = 100` / `rate = 10` to "Marked up 100%" / "10% of spend" — same values, plain words.
- Panels with no live data still say so. `panelState()` still refuses to print a zero for a failed read.

---

## Strings deliberately KEPT, and why

| Kept | Why |
|---|---|
| "A synthetic performer is always also marked AI-generated." | Named in the brief. A marketer can act on it. |
| "Credit-repair creative always needs a person" / "credit-repair ads cannot run on TikTok" | Both confirmed true in code by Lane B and by my own read of `screen.mjs:132-135` and `:207-213`. |
| The reason code (e.g. `guaranteed-score-increase`) as a small muted line | It is the identifier a person needs to find the reason in `docs/compliance/creative-block-reasons.md`. Demoted, not deleted. |
| Verbatim engine messages that contain field names — `ai_generated` in the synthetic-performer reason, `null` in the platform reason, `offer_type` in the offer reason | **This is a real gap, left open on purpose.** These are the exact words the system shows when a creative is stopped. Rewriting them here would make this list disagree with what a blocked creative actually says. Making them plain means editing `src/compliance/screen.mjs`, which is outside this file and outside this batch. |
| "No previews. The file itself is not sent to this screen." | Plain, and it explains why every tile looks the same. |
| "not a live reading" on the engine settings | Honest, and it stops a reader trusting a stale table. |
| `(a reference, not a picture)` beside a logo | Stops a reader expecting an image. |
| The provider keys `static`, `ugc-video`, `product-video`, `copy`, `resize` | These are the product's own names for what makes each creative, shown as data, not as explanation. |
| The `Kind` dropdown values `static / copy / video / resize` | These strings are posted to the generate endpoint as `asset_kind`. Renaming the visible text without touching the posted value is safe but was not asked for; left alone rather than risk the write path. |

---

## Found, not touched

| Finding | Detail |
|---|---|
| **F1 — the request-URL rail was already dead** | `setReq()` had already been reduced to a no-op that clears its target, the `Show request URLs` toggle was already gone, and no `.req` element was ever given the `on` class. Nothing was visible to a user. I removed the corpse: function, four call sites, four divs, the CSS and `S.showReq`. |
| **F2 — no `CF-nn` code was ever visible** | All twelve panel codes live in HTML/script comments. The board's line 26 assumed a user could see them. Nothing to strip. |
| **F3 — `PLACEHOLDER set in 052 — AWAITING SIGN-OFF` is not in this file** | The readiness table already said "Placeholder — not signed off" at HEAD. The live audit that recorded the old string was taken against an older deploy. |
| **F4 — `RATES` is dead data** | The `RATES` array feeds `#ratesBody`, which does not exist in the page; `renderStaticTables` guards on it. Its two rows duplicate two readiness rows. Left in place (scope discipline), but its one `nul('null')` was changed to `nul('—')` so it can never print the word "null" if somebody wires it up. |
| **F5 — five stat tiles in one row** | UI-STANDARDS §2 says never five. Five real numbers, none invented. Dropping one would delete real information and wrapping one creates the "orphan fifth" the same section flags. §2 was not in this task's named scope. Left as five; needs an owner call. |
| **F6 — the "impossible row" warning was removed** | The review-queue detail carried `Impossible row: TikTok + credit_repair is blocked by CHECK campaigns_tiktok_credit_repair_ck`. It named a database constraint at a marketer, and the row it warns about cannot occur while that constraint exists. Removed with the rest of the builder text. |
| **F7 — `src/compliance/screen.mjs` messages carry field names** | See the KEPT table above. Worth a separate unit if the owner wants those messages plain everywhere. |

---

## STEP 3 — Checks

### `npm run lint`

```
> fundhub-platform@0.0.1 lint
> node scripts/lint.mjs

lint: 1297 file(s) and inline script(s) parse clean
```

Clean. Run after every edit throughout, clean every time.

### `npx tsc --noEmit`

**Cannot run. There is no `tsconfig.json` in this repository.** Not faked, not skipped quietly — recorded as
not runnable, matching the batch board's line 28.

### `npm test`

Baseline, measured on this machine on this working tree **before any edit**:

```
# tests 5552
# pass 5545
# fail 4
# skipped 3

not ok 32   - the journeys are not stale
not ok 33   - the extraction is faithful to the code
not ok 1793 - the expected list is exactly what db/ holds — it cannot drift silently
not ok 2054 - an endpoint excused from the org filter still passes the session's org to its store
```

After my edit:

```
# tests 5634
# pass 5629
# fail 2
# skipped 3

not ok 33   - the extraction is faithful to the code
not ok 2128 - an endpoint excused from the org filter still passes the session's org to its store
```

**Zero new failures. Both remaining failures were in the baseline.** The test count moved (5552 → 5634) because
other lanes committed to `main` while I worked — see the hazard note below. `the journeys are not stale` now
passes, which is the machine proof that this change did not stale any journey.

`src/http/app-nav-matches-shell.test.mjs` — `creative-factory.html: inline sidebar carries the same rows, in the
same order, as shell.js` — **passes**. See the hazard note for why it briefly did not.

### Playwright

Run against a throwaway static copy of `public/` in the scratchpad, with only the session gate stubbed, at
390×844 and 1440×900. Numbers are in Step 2 §3 and §4 above. The same harness was used to measure
`git show HEAD:public/app/creative-factory.html` as the control, so the before/after numbers are comparable.

Not run against `https://fundhub.ai`: this change is not deployed, and the batch assigns live proof to Lane E.

---

## For Lane D — journeys

**No journey needs regenerating for this change, and the suite agrees.**

- `docs/journeys/` tracks Creative Factory only as a route-count node (`Creative Factory — 7 routes` in each
  `-actual.md`, `— 4 routes` in each `-intended.md`). Those counts come from the routing table and the role
  gates, not from screen markup.
- This change adds no route, removes no route, and touches no role gate. `src/lib/rbac.ts` is untouched.
- `the journeys are not stale` was **failing at baseline and passes after my change** — so nothing I did staled
  a journey.
- The pre-existing gap Lane D may still want to record, which I did not create: every `-actual.md` says
  **7 routes** where every `-intended.md` says **4**. That gap predates this batch.

---

## HAZARD — this working tree is shared, and my work was destroyed twice

This is the most important operational note in this manifest.

- `HEAD` moved four times while I worked: `7be91a0` → `7efa24e` → `8659d5f` → `e1b55b5`. Other agents are
  committing to `main` in this same checkout.
- `git stash list` shows three stashes, two of them on `7be91a0` — my starting commit. **A `git stash` run by
  another lane silently reverted every unstaged edit in the tree, mine included, twice.** The second time it
  reset `public/app/creative-factory.html` to exactly `HEAD`, losing all of it.
- I recovered from a scratchpad snapshot and now re-snapshot after every edit to
  `.../scratchpad/creative-factory.LANE-A.html`.
- Another lane's in-flight nav edit (removing the `Subscriptions` and `Demo Mode` rows) landed inside my file
  and was then reverted everywhere else, which made my file the only screen out of step and broke
  `inline sidebars match shell.js`. **I restored those two nav rows to match `shell.js`,** so my diff contains
  only my own work. Five other screens still fail that test from the same half-reverted edit — not mine.
- The Playwright browser is also shared: it was navigated away to another lane's page mid-measurement twice.

**Consequence for anyone reading my numbers:** the baseline and the after-run were taken on a tree that other
lanes were changing underneath me. The failure *names* are the trustworthy comparison; the counts are not.

