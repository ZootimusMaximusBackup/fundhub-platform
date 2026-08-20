# R2 — The state machine round 1 missed

**Date:** 2026-08-19 · **Scope:** findings only, nothing built, nothing written to client data.
**Every line cited below was opened and read.** Live counts were taken read-only as the
unprivileged `fundhub_app` role against the production database (`DATABASE_URL` from the
local `.env`). SELECT only. No writes.

---

## THE HEADLINE, IN ONE PARAGRAPH

There is a real, working stage machine in this system. Eight pipelines ("rails"), 69 stages,
a mover that is idempotent and refuses to move a card backwards, an HTTP endpoint behind a
drag-and-drop board, and a hard rule that moving a Card Stacking card to "Funded" without a
dollar amount is refused. **And it is almost empty.** Live: **47 clients, 19 cards, all 19 on
the Sales rail, ZERO cards on every other rail** — including the six-stage funding rail that
matches Chris's words exactly. **28 of 47 clients are on no board at all.** A fulfillment
queue built on cards today would show a blank screen for 60% of the book.

So the answer to "stages or jsonb" is **neither one alone**. See section 6.

---

## 1. EVERY SEEDED PIPELINE AND EVERY STAGE

### 1a. What the seed file creates — `db/seed/002_pipelines.sql`

Six pipelines, seeded at lines 11-18:

| # | key | display name | seed line |
|---|---|---|---|
| 1 | `sales` | Sales | :12 |
| 2 | `funding_card_stacking` | Funding: Card Stacking | :13 |
| 3 | `funding_altfin` | Funding: Alt-Fin (Lendflow) | :14 |
| 4 | `optimization` | Optimization (Repair) Rounds | :15 |
| 5 | `inquiry_removal` | Inquiry Removal | :16 |
| 6 | `ar_collections` | AR / Collections | :17 |

The header comment at `db/seed/002_pipelines.sql:4-7` records a seventh, `affiliates_hiring`
(R-07), as **RETIRED**, split into two replacement rails by migrations.

### 1b. Stages, per rail, as seeded

**`sales`** — `db/seed/002_pipelines.sql:29-32`, 10 stages:

| sort | key | name |
|---|---|---|
| 0 | `new_lead` | New Lead |
| 1 | `survey_complete` | Survey Complete |
| 2 | `booked` | Booked |
| 3 | `confirmed` | Confirmed |
| 4 | `showed` | Showed |
| 5 | `diagnostic_paid` | Diagnostic Paid |
| 6 | `decision_rendered` | Decision Rendered |
| 7 | `closed_won` | Closed Won (deposit) |
| 8 | `downsell` | Downsell |
| 9 | `lost` | Lost |

**`funding_card_stacking`** — `db/seed/002_pipelines.sql:34-36`, 6 stages.
**These are Chris's values, in his order:**

| sort | key | name |
|---|---|---|
| 0 | `apply_now` | Apply Now |
| 1 | `round_submitted` | Round Submitted |
| 2 | `approved` | Approved |
| 3 | `action_required` | Action Required |
| 4 | `funded` | Funded |
| 5 | `closed` | Closed |

**`funding_altfin`** — `db/seed/002_pipelines.sql:38-40`, 7 stages. The comment at `:37`
says "cards move ONLY from Lendflow webhooks":

`app_created` (0) · `docs_stips` (1) · `underwriting` (2) · `offers` (3) ·
`offer_accepted` (4) · `funded` (5) · `closed` (6)

**`optimization`** — `db/seed/002_pipelines.sql:42-51`. The comment at `:41` says
"DS-02 letters attach here and ONLY here". Thirteen live stages plus four legacy aliases:

`intake` (0) · `awaiting_documents` (1) · `analysis` (2) · `letters_generated` (3) ·
`ready_to_send` (4) · `in_transit` (5) · `awaiting_response` (6) · `response_received` (7) ·
`round_complete` (8) · `program_complete` (9) · `on_hold` (100) · `stalled` (101) ·
`cancelled` (102)
Legacy aliases at `:50-51`: `round_sent` (900) · `bureau_processing` (901) ·
`portal_updated` (902) · `upgrade_invite` (903)

**`inquiry_removal`** — `db/seed/002_pipelines.sql:53-55`, 6 stages as seeded:

`requested` (0) · `specialist_assigned` (1) · `calls_in_progress` (2) · `removed` (3) ·
`resume_funding` (4) · `hold` (5)

**`ar_collections`** — `db/seed/002_pipelines.sql:57-58`, 5 stages:

`invoice_sent` (0) · `reminder` (1) · `escalation` (2) · `paid` (3) · `written_off` (4)

### 1c. Rails and stages added by migrations — the seed file is NOT the whole picture

**`hiring`** — `db/migrations/051_hiring.sql:76-79` creates the pipeline; `:87-97` seeds
11 stages: `applied` (0) · `screening` (1) · `group_interview` (2) · `one_on_one` (3) ·
`offer` (4) · `hired` (5) · `onboarding` (6) · `ramp` (7) · `performing` (8) ·
`rejected` (9) · `withdrawn` (10).
Important: hiring cards do **not** live in `cards`. `db/migrations/051_hiring.sql:217-219`
puts `stage_id` on its own `candidate_applications` table, referencing the shared
`pipeline_stages`. A candidate is not a client.

**`affiliates_white_label`** — `db/migrations/115_affiliates_white_label.sql:50-53` creates
the pipeline; `:61-65` seeds 5 stages: `recruiting` (0) · `invited` (1) ·
`agreement_signed` (2) · `active` (3) · `paused` (4). The comment at `:43-48` states plainly
that **nothing moves these cards** — a partner is not a client, and a partners-lifecycle
table "is future work, not part of this split."

**`inquiry_removal` gains two stages** — `db/migrations/155_inquiry_gate.sql:128-133` inserts
`awaiting_documents` (2) and `letters_sent` (3), and `:110-126` plus `:143-158` renumber the
rail to: `requested` 0 · `specialist_assigned` 1 · `awaiting_documents` 2 · `letters_sent` 3 ·
`calls_in_progress` 4 · `removed` 5 · `resume_funding` 6 · `hold` 7. **Eight stages, not six.**

**`optimization` is rewritten** — `db/migrations/161_optimization_repair_pipeline.sql:10-31`
installs the 13 DFY-repair stages, `:34-45` remaps cards off the four legacy keys, and
`:48-52` pushes the legacy keys to `sort_order = 900 + old` so they fall off the right-hand
end of the board. The rows are kept "so history does not break" (`:47`).

**`affiliates_hiring` is deleted** — `db/migrations/127_retire_affiliates_hiring.sql:14-39`,
but only if zero cards sit on it (`:28-33`). Live check confirms the row is gone.

### 1d. What is ACTUALLY in the live database (read-only SELECT, `fundhub_app`, NOBYPASSRLS)

Eight pipelines exist for the one org:

| pipeline key | stages in DB | cards in DB |
|---|---|---|
| `sales` | 10 | **19** |
| `funding_card_stacking` | 6 | **0** |
| `funding_altfin` | 7 | **0** |
| `optimization` | 17 (13 live + 4 legacy) | **0** |
| `inquiry_removal` | 8 | **0** |
| `ar_collections` | 5 | **0** |
| `hiring` | 11 | **0** (candidates live elsewhere) |
| `affiliates_white_label` | 5 | **0** |

`affiliates_hiring`: absent. Total 69 stage rows, 19 card rows.

**This is not an RLS denial.** I checked: `cards`, `clients`, `pipelines` and
`pipeline_stages` each have row-level security ON with **1 policy** each, and the query
returned rows freely from all four. There is exactly **one org** in the database, so no
cross-org filtering applies. Zero here means zero.

Sales rail, card count per stage (live):

`new_lead` 2 · `survey_complete` 1 · `booked` 1 · `confirmed` 0 · `showed` 0 ·
`diagnostic_paid` 1 · `decision_rendered` 1 · `closed_won` 0 · `downsell` 0 · **`lost` 13**

Thirteen of nineteen cards are parked on Lost.

**Two live drifts worth recording (observed, not inferred):**
1. On `optimization`, `round_complete` and `letters_generated` **share `sort_order = 3`**.
   The seed file gives `round_complete` 8 and migration 161 gives it 8; the live row says 3.
   Two columns competing for one board position.
2. Live legacy sort orders are `round_sent` 900, `bureau_processing` 901,
   `portal_updated` 902, `upgrade_invite` **904** — the seed file's numbers imply 1800-1803
   after migration 161's `900 + sort_order`. The live values do not match either source.
   Not a blocker; recorded because "the seed says X" is not proof of what is in the database.

---

## 2. THE COMMENT ROUND 1 NEVER SAW

`api/dashboard/pipeline.mjs`, lines 1-12, quoted exactly as they appear in the file:

```
// GET /api/dashboard/pipeline?key=sales
//
// The board, as the database actually holds it: the pipeline's stages in
// sort_order, each with the client cards currently sitting in it.
//
// This exists because /api/dashboard/clients returns journey flags
// (crs_paid, deposit_paid, sale_closed) but no stage, and a board built by
// inferring stage from payment flags would be a guess dressed as data. The
// real position is cards.stage_id — one row per client per pipeline — so the
// board reads it directly and no mapping is invented anywhere.
//
// Read-only. SELECT only. Mirrors api/dashboard/clients.mjs style.
```

The reported "comment at :6-10" is verbatim correct: lines 6 through 10 are the
"guess dressed as data" passage.

**How much of round 1 does this actually reject?** Read it precisely. It rejects **one**
specific thing: building the **pipeline board's stage columns** by inferring stage from
**payment flags** (`crs_paid`, `deposit_paid`, `sale_closed`). It says the board must read
`cards.stage_id`. It does **not** say a client's next action may never be derived from
custom fields, and it does not mention `employee_next_action` at all. Round 1's ladder is
about a *queue chip*, not about *where a card sits on a board*.

That distinction is the honest reading, and it matters for section 6. But the warning still
lands hard on any design that would have shown Chris a "stage" column computed from flags
while `cards.stage_id` sat right there holding the real answer.

---

## 3. HOW A CLIENT GETS A CARD AND MOVES STAGE

### 3a. The mover — `src/workflows/cards.mjs`

Two exported functions.

`moveCardToStage` (`src/workflows/cards.mjs:17-119`):
1. `:32` — refuses without an `orgId`. The comment at `:26-31` records why: looking up a
   pipeline by key alone used to pick another company's pipeline, and the cards vanished
   from every board.
2. `:33-41` — resolves `(pipeline key, stage key, org)` to a stage id; returns
   `stage_not_found` if there is none.
3. `:48-71` — **the funded guard.** On `funding_card_stacking` moving to `funded`, it calls
   `guardFundedAmount` and refuses the move if there is no funded amount above zero. The
   comment at `:47` is "never park a card on funded with no dollars."
4. `:73-87` — find-or-create. One card per `(client_id, pipeline_id)`, enforced by an
   `ON CONFLICT (client_id, pipeline_id)` upsert at `:83`.
5. `:89-111` — after a successful move on the Card Stacking rail, emits the canonical
   `round.*` event. `:104` records the rule: a failed emit never undoes the move.

`advanceCardToStage` (`src/workflows/cards.mjs:126-166`): the same thing, but forward-only.
`:157-163` compares `sort_order` and returns `already_at_or_past` rather than moving a card
backwards. The docstring at `:121-125` gives the reason — a late webhook must not shove a
booked card back to new lead.

### 3b. Stage → event map — `src/funding/card-stacking-rounds.mjs:21-28`

```
export const STAGE_TO_EVENT = Object.freeze({
  apply_now: "round.started",
  round_submitted: "round.submitted",
  approved: "round.approved",
  action_required: null,
  funded: "round.funded",
  closed: null
});
```

Pinned by tests at `src/funding/card-stacking-rounds.pg.test.mjs:103-107`. The file header
`:1-3` states the intent: staff advance the card, and the system emits the same events
Lendflow emits for Alt-Fin, so the money chain and the 16 Inngest funding workflows fire
unchanged. Idempotency key includes the round number (`:237`), so round 2 re-enters the same
stages without duplicate events.

### 3c. Automatic or manual? **Both — but the split is lopsided.**

**Manual.** `public/app/pipeline.html` has real pointer-driven drag (`:643-720`) and a
cross-rail MOVE menu (`:442-495`). Both call `persistCardMove` (`:607-639`), which POSTs to
`/api/pipeline-cards` (`:623-628`). The header comment at `api/pipeline-cards.mjs:6-9`
records that drag used to be fake — DOM shuffling plus `sessionStorage`, wiped on reload —
and this endpoint is the real write. It is shift-gated (`api/pipeline-cards.mjs:39`), owners
exempt, and it calls the same `moveCardToStage` (`:92-100`).

**Automatic.** Fifteen code paths move cards without a human:

| rail | stage moved to | file:line |
|---|---|---|
| sales | `new_lead` | `src/handlers/client-lifecycle.mjs:265-270`; `src/workflows/s-01-new-lead-intake.mjs:23` |
| sales | `survey_complete` | `src/handlers/client-lifecycle.mjs:287-292` |
| sales | `booked` | `src/handlers/comms.mjs:467-472`; `src/workflows/s-04-call-booked.mjs:22` |
| sales | `diagnostic_paid` | `src/handlers/client-lifecycle.mjs:328-333` |
| sales | `decision_rendered` | `src/handlers/client-lifecycle.mjs:455-460` |
| sales | `showed` / `lost` | `src/workflows/dpc-02-call-outcome-enforcement.mjs:48`, `:54` |
| sales | `closed_won` / `downsell` | `src/workflows/dpc-03-inbound-reply-router.mjs:105`, `:119` |
| inquiry_removal | `requested`, `awaiting_documents`, `specialist_assigned` | `src/handlers/inquiry-gate.mjs:213-217`, `:220-224`, `:241-245` |
| inquiry_removal | `specialist_assigned` | `src/handlers/inquiry-docs.mjs:71-75` |
| inquiry_removal | `letters_sent` | `src/inquiry-ops/send.mjs:249-253` |
| inquiry_removal | `calls_in_progress` | `src/inquiry-ops/call-scheduler.mjs:181-185` |
| inquiry_removal | `resume_funding` | `src/inquiry-ops/gate.mjs:133-137` |
| optimization | all 13, event-driven | `src/repair/pipeline.mjs:24-31` + `EVENT_STAGE` map `:39-56`, called from `src/repair/handlers.mjs:45` |
| **funding_card_stacking** | **`approved`, and only `approved`** | `src/workflows/f-11-bank-email-event-router.mjs:64` |

**The finding inside the finding.** I grepped every caller of `moveCardToStage` /
`advanceCardToStage` across the whole tree. On the six-stage funding rail — the one whose
keys match Chris's words — **exactly one automatic mover exists, and it only ever writes
`approved`.** `apply_now`, `round_submitted`, `action_required`, `funded` and `closed` are
reachable **only by a human dragging a card** on `public/app/pipeline.html`, or by the MOVE
menu item at `:449` which drops a client on `apply_now`.

**And `funding_altfin` has no mover at all.** The seed comment at
`db/seed/002_pipelines.sql:37` says "cards move ONLY from Lendflow webhooks." No Lendflow
file appears in the caller list. `src/adapters/lendflow.mjs` contains no card move. The
Alt-Fin rail is seven columns that nothing can ever fill. Same for
`affiliates_white_label`, which says so about itself at
`db/migrations/115_affiliates_white_label.sql:43-48`.

**One more, small and real:** the MOVE menu's "Repair Rounds" item at
`public/app/pipeline.html:463` targets `optimization` / **`round_sent`** — a key that
migration 161 retired and pushed to the far right of the board. A staff member using MOVE to
send a client to repair lands them in a column named "Round Sent (legacy)". The board does
not hide legacy stages: `api/dashboard/pipeline.mjs:23-29` selects every stage with no filter.

---

## 4. THE DECIDING QUESTION — do stages already answer "Employee Next Action"?

Chris's 11 values, verbatim from `docs/workflows/fulfillment-layer-2026-08-19.md:22-27`.

| # | Chris's value | Stage key that covers it | Verdict | Evidence |
|---|---|---|---|---|
| 1 | **Pull CRS** | none | **NO** | No stage on any of the eight rails names a credit pull. Sales goes `diagnostic_paid` → `decision_rendered` with no pull step. The value lives only in jsonb: `src/workflows/c-05-pre-funding-review.mjs:44`, `src/workflows/s-06-post-call-funding-purchased.mjs:42`. |
| 2 | **Collect Documents** | `optimization.awaiting_documents`, `inquiry_removal.awaiting_documents`, weakly `funding_card_stacking.action_required` | **PARTIAL — three different rails, no single answer** | `db/seed/002_pipelines.sql:42`; `db/migrations/155_inquiry_gate.sql:130`; `db/seed/002_pipelines.sql:35`. Three stages, three rails, one chip. A card can only sit on one. |
| 3 | **Remove Inquiries** | the whole `inquiry_removal` rail | **YES — as a rail, not a stage** | Eight stages, `db/seed/002_pipelines.sql:53-55` + `db/migrations/155_inquiry_gate.sql:128-133`. Fully automated: five movers listed in 3c. "Has an inquiry_removal card not in `removed`/`resume_funding`" is a clean, real query. |
| 4 | **Clear Fraud Alert** | `inquiry_removal.hold` (generic) | **NO** | `db/seed/002_pipelines.sql:55` gives a `hold` stage with no reason attached. Fraud specifically is jsonb only: `round_hold_reason: "Fraud Alert"` at `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:37`. A stage cannot tell fraud hold from any other hold. |
| 5 | **Review Funding File** | none | **NO** | No review stage on any rail. jsonb only: `src/workflows/c-05-pre-funding-review.mjs:39`. |
| 6 | **Prepare Next Round** | `funding_card_stacking.closed` implies it | **NO — inference, not a stage** | `db/seed/002_pipelines.sql:36`. "Closed" means the round ended; it does not say a human must prepare the next one. jsonb writes `"Prepare Next Funding Round"` (different string) at `src/workflows/f-04-round-approvals.mjs:32` and `src/workflows/f-11-bank-email-event-router.mjs:62`. |
| 7 | **Apply for Funding** | **`funding_card_stacking.apply_now`** | **YES — closest thing to an exact match in the whole system** | `db/seed/002_pipelines.sql:34`. Also the MOVE menu's Card Stacking destination, `public/app/pipeline.html:449`. And it emits `round.started` (`src/funding/card-stacking-rounds.mjs:22`). |
| 8 | **Lock Fee** | none | **NO stage — BUT SEE BELOW** | **Round 1 called this "NOT FOUND, zero hits, whole repo." That is wrong.** `db/schema/005_client_custom_fields.sql:245` has `funding_fee_locked text[]` (CHECKBOX · Funding Fee Locked) and `:273` has `funding_fee_locked_timestamp date`. Both columns exist. **Zero writers anywhere in `src/ api/ public/ scripts/`.** The right finding is "the field exists and nothing ever fills it," not "it does not exist." |
| 9 | **File Prep** | none | **NO** | No stage, no column, no jsonb key. Genuinely absent. |
| 10 | **Review Disputes** | `optimization.response_received` (7), `optimization.awaiting_response` (6) | **PARTIAL** | `db/migrations/161_optimization_repair_pipeline.sql:20-21`. `response_received` is fed automatically by `repair.response.received` / `repair.parse.low_confidence` (`src/repair/pipeline.mjs:48`, `:50`). That is genuinely "a dispute response arrived, look at it." It is the strongest stage match after `apply_now`. |
| 11 | **Ready to Fund** | `funding_card_stacking.approved` | **PARTIAL** | `db/seed/002_pipelines.sql:35`. "Approved" means the round was approved, which is close but not identical to "ready to fund". It is the one funding stage with an automatic writer (`src/workflows/f-11-bank-email-event-router.mjs:64`). |

**Score: 2 clean (Apply for Funding, Remove Inquiries) · 3 partial (Collect Documents,
Review Disputes, Ready to Fund) · 6 not covered by any stage.**

### Why stages cannot carry all eleven, structurally

The constraint is one row per client per pipeline —
`src/workflows/cards.mjs:74` and the `ON CONFLICT (client_id, pipeline_id)` at `:83`.
A client can be on eight rails at once, but only in one column of each. Chris's eleven
values cut across rails: "Collect Documents" can be true while a repair round is in transit
and an inquiry case is waiting. Stages answer **"where is this file in this process"**.
Chris's field answers **"what should a person do next on this file"**. Those are different
questions, and the eleven values prove it — six of them describe a person's task with no
process position at all.

### And the coverage numbers make it worse

Live, right now:
- **19 of 47 clients have any card.** 28 have none. Excluding demo clients, **20 real
  clients** are on no board.
- **0 clients have a `funding_card_stacking` card.** The rail that matches Chris's words has
  never held a single card.
- **8 of 47 clients have `employee_next_action` set** in jsonb — 7 "Collect Documents",
  1 "Apply for Funding".

Neither source covers the book. Stages cover 40% of clients on one rail. The jsonb key
covers 17% of clients. Together, still not everyone.

---

## 5. DOES EVERY CLIENT HAVE A CARD? — No. 28 of 47 do not.

**How a card is born:** only `moveCardToStage` inserts one
(`src/workflows/cards.mjs:81-85`). Nothing else in the tree writes the `cards` table except
one demo backfill, `db/migrations/149_demo_pipeline_cards.sql:2-11`, which puts demo clients
on `sales` / `new_lead`.

**The intended first card** is Sales / `new_lead`, placed on `entry.captured` by
`src/handlers/client-lifecycle.mjs:265-270`. The comment above it at `:240-243` says
placement is synchronous "so Pipeline UI updates even when Inngest cannot invoke functions."
`src/workflows/s-01-new-lead-intake.mjs:23` places the same card again; `advanceCardToStage`
never demotes, so the double-write is safe.

**So a client only gets a card if it arrived through `entry.captured`** (or a later sales
event, or the demo backfill, or a human dragged it). Any client created another way —
imported, seeded, created by an internal tool, created before that handler existed — has no
card and appears on no board, forever, until someone drags it.

Live proof (read-only, `fundhub_app`, RLS on with a policy present on `cards` and `clients`):

```
clients_total            47
clients_with_any_card    19
clients_no_card          28
clients_no_card, non-demo 20
cards_by_pipeline        sales: 19   (every other rail: 0)
```

**A fulfillment queue built on cards misses 28 of 47 clients — 60% of the book, 20 of them
real, non-demo people.** That is the number.

The `W5-live-data.md` finding at line 541 already recorded this for one client
("0 pipeline cards, empty `pipeline_ids` → this client is on no board"). It is not one
client. It is most of them.

---

## 6. STAGES, DERIVED JSONB, OR BOTH — the plain answer

**Both. And the split between them is not a compromise, it is the actual shape of the
problem.**

Reuse before you build (CLAUDE.md §8) says: do not invent a stage machine, there is one.
It also says do not invent a second answer to a question the first one already answers well.
Applied honestly:

**Use stages where a stage is the truth — and only there.** Two of Chris's eleven values are
already a stage, exactly, with automatic writers behind them:
- **Remove Inquiries** = has an `inquiry_removal` card not yet in `removed`/`resume_funding`.
  Five automatic movers keep it honest.
- **Review Disputes** = has an `optimization` card in `response_received`.
  Fed automatically by `src/repair/pipeline.mjs:48`.
Deriving either of these from jsonb when `cards.stage_id` holds the answer is exactly the
"guess dressed as data" the pipeline handler warns about.

**Use the existing jsonb key for the rest — do not build a third thing.**
`clients.custom_fields.employee_next_action` is already written by 15 code paths in the live
workflow engine, already carries 9 of Chris's 11 strings, and is already painted on one
screen (`public/app/client-control-panel.html:889`). It is the right home for the six values
no stage expresses. It is not a workaround; it is the field Chris means.

**Do not build the queue on cards.** 28 of 47 clients have no card. A card-based queue is
blind to 60% of the book on day one, and the gap is not closing by itself — nothing
backfills cards for clients that never fired `entry.captured`.

**Do not build the queue on the typed column either.** `client_custom_fields` has one
writer, frozen to `cf_svy_*` fields, so `client_custom_fields.employee_next_action` is
always NULL. Same for `funding_fee_locked` at `db/schema/005_client_custom_fields.sql:245`.
Those columns exist and are empty — which is a finding, not a foundation.

**Concretely, for Phase 0 (read and display only):** the queue reads `clients`, takes
`custom_fields.employee_next_action` when it is set, and **left-joins the card/stage for the
two values a stage answers better**, showing the stage as the evidence line under the chip.
Every client appears, because the base table is `clients` and not `cards`. Where neither
source says anything — 39 of 47 clients today have no `employee_next_action` and most have
no card past `sales` — the honest output is a dash, not a guessed chip.

**The one thing that must not happen:** do not compute a *stage* from flags, and do not show
a client's board position anywhere except from `cards.stage_id`. That is what
`api/dashboard/pipeline.mjs:6-10` forbids, and it is right.

---

## CORRECTIONS TO ROUND 1

1. **"Lock Fee — NOT FOUND, zero hits, whole repo" is wrong.**
   `db/schema/005_client_custom_fields.sql:245` — `funding_fee_locked text[]`.
   `db/schema/005_client_custom_fields.sql:273` — `funding_fee_locked_timestamp date`.
   Both opened and read. The correct finding: **the columns exist and have zero writers.**
   (This is the exact trap the brief named — a search for `lock` + `fee` misses
   `funding_fee_locked`.)

2. **Round 1's mapping table never saw the stage machine.** Six stage keys matching Chris's
   funding language have existed since `db/seed/002_pipelines.sql:34-36`, wired to canonical
   events at `src/funding/card-stacking-rounds.mjs:21-28`, moved by
   `src/workflows/cards.mjs:17-166`, read by `api/dashboard/pipeline.mjs` and
   `api/dashboard/pipeline-counts.mjs`, and written through `api/pipeline-cards.mjs`.
   Two of Chris's eleven values are answered better by that machine than by any jsonb key.

3. **Round 1 did not count how many clients are on a board.** 19 of 47. That number decides
   the architecture and nobody had it.

## NOT VERIFIED

- **The allowed option list for `employee_next_action`.** GHL typed it `SINGLE_OPTIONS` but
  the field map records no options. Not in this repo. Cannot be verified here.
- **Whether the four unmatched chips (Lock Fee, File Prep, Ready to Fund, Prepare Next
  Round) are the same concept under different words.** That is a question for Chris, not a
  thing to decide from code.
- **Why the live `optimization` sort orders differ from both the seed and migration 161**
  (`round_complete` at 3, `upgrade_invite` at 904). Observed live; the cause is not in any
  file I read. Not chased — out of scope.
