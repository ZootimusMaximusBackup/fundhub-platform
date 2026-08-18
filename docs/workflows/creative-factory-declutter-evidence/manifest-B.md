# Manifest — Lane B (new home for the legal rules)

**Batch:** `creative-factory-declutter-2026-08-17`
**HEAD at start:** `7be91a0`
**Status:** done
**COMPLIANCE REVIEW REQUIRED** — this file is a credit-repair / CROA / FTC
reference page. No enforcement logic was touched.

---

## Files created

| File | Note |
|---|---|
| `docs/compliance/creative-block-reasons.md` | The only file I created. **This also creates the `docs/compliance/` directory, which did not exist in the repo.** |
| `docs/workflows/creative-factory-declutter-evidence/manifest-B.md` | This manifest. Also created its directory. |

Files touched: none. `public/app/creative-factory.html` was **read only**, and
only via `git show HEAD:` so Lane A's in-flight edits were never observed. The
shared board was not edited.

---

## Anchor for Lane A to link to

Link the collapsed on-screen section to:

```
docs/compliance/creative-block-reasons.md#every-block-reason
```

Heading in the file: `## Every block reason`. That section holds all three
tables (saved rules, engine reasons, Facebook targeting reasons).

Other stable anchors, if a second link is wanted:

| Anchor | Heading |
|---|---|
| `#what-happens-when-a-rule-fires` | What happens when a rule fires |
| `#which-rules-apply-to-creatives-campaigns-or-both` | Which rules apply to creatives, campaigns, or both |
| `#the-two-things-the-screen-says-checked-against-the-code` | The two things the screen says, checked against the code |
| `#gaps-found` | Gaps found |

---

## Counts measured, versus the board's claims

The board's line 25 was treated as unverified and re-measured from source.

| Source | Board claimed | I measured | Match? |
|---|---|---|---|
| `db/migrations/047_compliance_rules.sql` seeded rows | 12 | **12** — 6 `croa`, 4 `claims`, 1 `disclosure`, 1 `platform` | ✅ |
| `src/compliance/screen.mjs` engine reason codes | 8 | **8** | ✅ |
| `src/compliance/targeting.mjs` Meta codes | 9, no citation, no severity | **9 distinct codes from 12 call sites**; no citation and no severity on any of them | ✅ |
| Total rows shown on the screen | 29 | **29** (12 + 8 + 9) | ✅ |

Method for the engine count: 8 distinct codes at `screen.mjs` lines 93, 119,
123, 133, 148, 196, 210, 218. Note 4 use the `r()` helper, 3 use `blocked()`
(which wraps `r()`), and `screen_error` at line 93 is a plain object literal in
the catch — not built with `r()`. The board's phrasing "builds with `r()`" is
loose by one code; the total of 8 is right.

Method for the targeting count: 12 `reason(...)` call sites, 9 unique codes.
`zip_targeting`, `age_range` and `lookalike_audience` each fire from two places
with different wording.

Every citation in the file is verbatim from source. No citation or severity was
supplied from outside the code. Where the code carries neither, the file says
**none in code**.

---

## Gaps found

1. **`docs/compliance/` did not exist.** `CLAUDE.md` §7 states domain rules live
   there. The directory was absent from the repo at `7be91a0`. This lane creates
   it.

2. **Campaign screening has no live caller.** `guardedWrite` in
   `src/adplatforms/index.mjs:70` screens only when passed `screenSubject`.
   Neither non-test caller passes it — `api/campaigns/write.mjs:72` and
   `src/optimize/run.mjs:95` both do pause / resume / update_budget only, which
   the code's own comment at `index.mjs:50-52` names as the correct exemption. No
   campaign is screened today.

3. **Nothing creates a campaign or an ad set.** `createCampaign`, `createAdSet`,
   `createAd` in `src/adplatforms/meta.mjs` have zero non-test callers and no
   route. Since the 9 targeting codes fire from `buildTargeting()` inside
   `createAdSet` (`meta.mjs:74`), **none of the 9 targeting codes is reachable at
   `7be91a0`.**

   This qualifies the screen's own comment (HEAD `creative-factory.html:720-724`),
   which says the 9 codes "reach a CAMPAIGN screening only". The splice path at
   `screen.mjs:154-157` is real but also unreachable, because it needs a
   `targeting` key in the subject and nothing supplies one. The screen's statement
   is not wrong about scope — it is incomplete about reachability.

4. **`screenAndRecord` is dead code.** Defined at `screen.mjs:231`, called by
   nothing outside tests. The two paths that keep an audit row write their own
   INSERT (`src/creative/generate.mjs:244`, `src/social/scheduler.mjs:65`).
   `src/brand/copy-generate.mjs:130` and `api/social/generate.mjs:95` screen but
   record no `compliance_screenings` row.

5. **No `warn` rule exists.** All 12 seeded rows ship `severity='block'`. The
   `warn` branch of `compliance_rules_severity_ck` is unexercised, so the Severity
   column has exactly one value system-wide and there is no warnings bucket
   anywhere.

6. **Absent or misspelled severity counts as a hard block.** `screen.mjs:200`
   filters `severity !== "warn"`. A row saved as `warning` would silently become a
   hard block. Fail-safe direction, but worth knowing.

7. **`kind` never selects rules.** `screen()` accepts `kind` and uses it only as
   the audit row's `subject_type` (`screen.mjs:238`). It never branches on it, so
   creative vs campaign is decided entirely by what the caller supplies
   (`platform`, `targeting`, `hasDisclosureAsset`). Separately, the DB CHECK in
   `047` allows `ad_set`, which the jsdoc `kind` list at `screen.mjs:75` omits.

8. **The screen's third summary claim is imprecise.** The CF-07 caption at HEAD
   reads "Each reason stops the work." True for 27 of 29. The two approval codes
   are appended *after* the hard-block decision at `screen.mjs:200`, so they can
   never cause a stop — they hold the work for a person. Recorded as a correction
   in the file. **Lane A may want to avoid reusing that sentence verbatim.**

9. **NOT a gap — no invented rows.** All 29 rows in the HEAD `RULES` array trace
   to real code, with verbatim messages and citations. Nothing on the screen is
   fabricated and nothing on it is missing from the new page.

---

## Confirmed against code (the two facts Lane A is collapsing to)

| Screen claim | Verdict | Producing code |
|---|---|---|
| "credit-repair creative always needs a person" | **Confirmed** | `human_approval_required_credit_repair`, `screen.mjs:207-213` — the `approveBeforeLaunch` setting is not read on this branch |
| "credit-repair ads cannot run on TikTok" | **Confirmed, enforced 3×** | `tiktok_credit_repair_prohibited` `screen.mjs:132-135`; seeded row `tiktok-credit-repair-prohibited` in `047`; CHECK `campaigns_tiktok_credit_repair_ck` at `046_ad_platforms.sql:220` |

---

## Definition of done (CLAUDE.md §6)

| Gate | Result |
|---|---|
| `npm run lint` | ✅ clean — "1290 file(s) and inline script(s) parse clean" |
| `npx tsc --noEmit` | ⛔ cannot run — no `tsconfig.json` in this repo. Matches the board's recorded baseline. |
| Test suite | ⏭️ not run by this lane. Lane B added one `.md` file: no code, no route, no handler, nothing in `scripts/lint.mjs`'s globs (`.mjs`/`.js`/`.html` only). Running the suite now would measure Lane A's in-flight HTML edits, not this lane's work. Lane E owns the suite run. |
| Playwright | n/a — no UI change in this lane. |
| Journeys `-actual.md` + changelog | n/a to this lane — owned by Lane D. No journey step changed; this is a reference doc, not a flow. |
| Change manifest | ✅ this file. |

---

## Risk

Low. Documentation only. No code, schema, route or enforcement path was touched,
so nothing in the running product can behave differently because of this lane.

The one live dependency: if Lane A changes the on-screen wording of the two
summary facts, the "two things the screen says" section of
`creative-block-reasons.md` quotes the HEAD caption verbatim and will need the
quote refreshed to match.
