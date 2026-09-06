# Ad script flow — the states a script moves through

Required by `CLAUDE.md` §3a step 4. Written 2026-09-06, before any code.

This page is the back end. The screen is a window onto it. If this page is right, the
screen can be rebuilt in an hour.

---

## The one thing that decides the schema

**Every state a script needs already exists in this database.** Three state machines are
already shipped, and a generated ad script passes through all three. Nothing here invents
a fourth.

| Machine | Column | Values | Where |
|---|---|---|---|
| The job that writes it | `generation_jobs.status` | `queued` · `running` · `succeeded` · `failed` | `045_creative_factory.sql:312` |
| The script itself | `creative_assets.compliance_state` | `pending` · `passed` · `blocked` · `approved` | `045_creative_factory.sql:201` |
| The finished ad on the platform | `ads.approval_state` | `draft` · `awaiting_approval` · `approved` · `live` · `paused` · `archived` | `046_ad_platforms.sql:311` |

A script is a `creative_assets` row with `kind = 'copy'`. That is already allowed:
`creative_assets_kind_ck` permits `static`, `video`, `copy`.

---

## The flow

```mermaid
flowchart TD
    A["Chris asks for 10 scripts in a lane"] --> B["generation_jobs row<br/>status = queued"]
    B -->|runner claims it| C["status = running"]
    C -->|model writes the scripts| D{"The checker<br/>scripts/ads/check-script.mjs"}
    D -->|banned phrase, wrong length,<br/>hook not cause-first| C
    D -->|passes| E["creative_assets row<br/>kind = copy<br/>compliance_state = pending"]
    E --> F{"The compliance screen<br/>src/compliance/screen.mjs<br/>12 rules"}
    F -->|a rule fires| G["compliance_state = blocked<br/>blocked_reasons filled<br/>THE ROW IS KEPT"]
    F -->|clean| H["compliance_state = passed"]
    G -->|Chris rewrites the line| E
    H -->|Chris reads it and keeps it| I["compliance_state = approved<br/>only a person can do this"]
    H -->|Chris cuts it| J["archived_at set<br/>the row is never deleted"]
    I -->|Chris rewrites a line first| K["the pair is added to<br/>docs/ads/VOICE.md"]
    K --> I
    I -->|Chris films it| L["filmed_at set<br/>THIS IS THE NEW COLUMN"]
    L -->|Paul builds the ad in Meta| M["ads row<br/>approval_state = draft"]
    M --> N["approval_state = live<br/>spend starts"]
    N -->|utm_content carries the ad id| O["client_ad_attribution<br/>joins the ad to a booked call"]
```

---

## Every transition, and what fires it

| From | To | What fires it | Who or what does it |
|---|---|---|---|
| — | `queued` | Chris asks for scripts | the skill |
| `queued` | `running` | the runner claims the job | `src/creative/runner.mjs` |
| `running` | rewrite loop | the checker finds a banned phrase, a bad length, or a hook that is not cause-first | `scripts/ads/check-script.mjs` |
| `running` | `succeeded` + a `creative_assets` row | the checker passes | `src/creative/generate.mjs` |
| `pending` | `blocked` | one of the twelve compliance rules matches | `src/compliance/screen.mjs`, inside `storeAsset` |
| `pending` | `passed` | no rule matches | same |
| `blocked` | `pending` | Chris rewrites the offending line | a person |
| `passed` | `approved` | Chris keeps it | **a person only.** Nothing in the generate path can approve |
| `passed` | archived | Chris cuts it | `api/creative/actions.mjs` |
| `approved` | filmed | Chris films it | **a person only** |
| filmed | an `ads` row | Paul builds it in the ad account | outside this system |

---

## The schema change, and it is one column plus one timestamp

**1. `copy_text` on `creative_assets`.** Nullable. Holds the words of a written ad.

Today the words are generated and thrown away: the table has `storage_key` for a file and
nothing for text, and nothing uploads a file for a copy asset anyway. So a written ad
exists for a moment and is gone. Every other state on this page is unreachable without it.

Written for blocked assets too, not only clean ones. A blocked script is the most useful
thing in the library, because it is the one Chris has to rewrite, and he cannot rewrite
what was not saved.

*Name chosen deliberately.* The redactor in `src/http/read-api.mjs` strips any field whose
name contains a forbidden substring, which is why `has_storage_key` is eaten today.
`copy_text` contains none of them.

**2. `filmed_at` on `creative_assets`.** Nullable timestamp. Null means not filmed.

This is the one genuine gap on the page. `approved` means Chris kept the words.
`ads.approval_state` starts when the ad exists in the ad account. **Nothing today records
the step in between: that it was shot.** Chris films once a week, about six creatives,
going to ten. No file in this repo carries a shoot date, which is why the audit could name
five filmed assets and could not produce a filming rate.

Follows the shape already used at `046_ad_platforms.sql:191`, where `approved_at` is tied
to its state by a CHECK.

**Nothing else changes.** No new table, no new state value, no new enum. Both columns are
nullable, so every row that exists today stays valid.

---

## The one decision that is mine, not the code's

**Should filming be tracked here at all?**

Chris's system walkthroughs stay manual by his own decision, and filming is the most
manual thing he does. `filmed_at` is specced above because without it "which scripts turned
into ads" has no answer inside FundHub, and every performance question downstream needs it.

But it is a column a person has to remember to set. If nobody sets it, it is a lie by
omission dressed as data.

**Specced as: one column, nullable, set from the library screen with a single click on an
approved script.** If Chris would rather keep the shoot list on paper, delete `filmed_at`
and this page stays true; only the filmed hop disappears.

---

## What this page does NOT cover

- **Images and video.** A `copy` asset needs no file. A `static` or `video` asset does, and
  nothing uploads one today. Out of scope, separate batch.
- **Cost per script.** Meta's ad id and Chris's ad number never meet, so cost cannot be
  attributed per ad. Named in `docs/ops/2026-09-06-self-analysis.md`, separate batch.
- **The 83 chat scripts.** They are not in the repo and are deliberately not the seed.
  `docs/ads/VOICE.md` is seeded from the five filmed and running ads only.
