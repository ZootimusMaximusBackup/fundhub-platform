# Fulfillment Layer — Phase 0 findings

**COMPLIANCE REVIEW REQUIRED** — see section 7. Showing "Pull CRS" touches credit-pull
permission, and one status is being shown today to people who only bought credit repair.

**Date:** 2026-08-19 · **Owner:** Chris · **Status:** Phase 0 done. Waiting on your approval.

Nothing was built. No code changed. No screens touched. Nothing deployed. Nothing merged.
This is a findings report and a set of questions for you.

---

## 1. The short version

Your Employee Next Action field already exists. It is already in the system, and 15 different
automations already write to it.

**It is blank on nearly everybody.** Out of 47 client records, 39 have nothing in that field.
Every one of the 19 records that look like a real customer is blank. Of the 8 that do have a
value, 5 are demo fakes and 2 are test scripts. The last one is your own test account, and the
value on it is wrong — it says "Apply for Funding" for someone who has never had a real credit
pull.

So we have two ways to fill your screen:

**Option 1 — show the saved text.** Ships you an empty screen. It is a stamp left behind by
whichever automation ran last, and most clients were never stamped.

**Option 2 — work it out from the client's own records.** Look at whether they have a credit
report, whether they owe us paperwork, whether a bank said yes. Fills the screen truthfully,
today, with no new database columns.

**Option 2 is the recommendation, and every checker agreed.** The rest of this document is
what Option 2 can and cannot tell you.

**Nine of your eleven chips can be worked out this way. Two cannot** — "File Prep" and "Ready
to Fund" have nothing behind them at all. Those need you to say what they mean.

---

## 2. One thing to understand before reading the table

There are **two different places** in this system that both get called "custom fields." They
are not the same, and confusing them produced a wrong answer earlier in this pass.

| Name | What it is | Is it alive? |
|---|---|---|
| `clients.custom_fields` | A free-form notes blob attached to each client record | **ALIVE.** This is where all the automations write. |
| `client_custom_fields` | A separate table with about 305 properly-labelled columns | **MOSTLY DEAD.** Only 15 survey answers ever get written. The other ~290 columns have never held anything. |

That second table is the ghost of an old Airtable setup. Somebody built the columns and never
built anything to fill them. When this report says a column "exists but nothing writes it,"
that table is why.

Evidence: `src/handlers/client-custom-fields.mjs:69` is the only thing that writes that table,
and its list of allowed columns (`:6-22`) is 15 survey names.

---

## 3. The derivation table

Every line reference below was opened and read. 84 references were checked one by one.

| # | Your chip | What it means in plain English | How we can tell, from data that exists today | When we can't tell | Confidence |
|---|---|---|---|---|---|
| 1 | **Clear Fraud Alert** | There is a fraud alert on their credit file. Nothing else can move until it comes off. | Tag `fraud:alert-present` on the client, **or** hold reason = `Fraud Alert`, **or** the inquiry case has a fraud note | Show a dash | **Verified.** Warning: nothing in this system ever turns this off. Once it shows, it shows forever. |
| 2 | **Collect Documents** | We are waiting on paperwork from them. Their move, not ours. | Tag `docs:missing`, **or** their inquiry case is `Blocked` and the ID packet check comes back short | Show a dash | **Verified** |
| 3 | **Pull CRS** | They paid for their credit report and we have not pulled it yet. | They are marked paid, **and** there is no credit result on file, **and** their credit status is not `Complete` | Dash. And if their written permission is not on file, show "waiting on their permission" — **never** "Pull CRS" | **Verified.** See section 7 — this row is compliance-sensitive. |
| 4 | **Remove Inquiries** | There are credit inquiries to get taken off before we apply to banks. | Their inquiry case is in any active state — queued, scheduled, in progress, escalated or blocked | Show a dash | **Verified** |
| 5 | **Review Disputes** | A credit bureau answered our letters and nobody has read the answer. | A dispute response is sitting unconfirmed, **or** a dispute case is past its response due date | Show a dash | **Verified that the tables and the code are real.** How many rows they hold is **not measured** — nobody has read them. |
| 6 | **Review Funding File** | The credit report is in. A person has to read it before we send applications. | Credit status = `Complete` **and** there is an open review task | Show a dash | **Verified** |
| 7 | **Lock Fee** | A round funded but nobody set the fee, so the invoice cannot go out. | An **open** task titled "Fix fee lock/percent before invoicing" — **and** we can also tell when it is DONE, because a "funding locked date" gets written | Show a dash | **Verified that this is real and live.** Not verified that it is what you mean — your call. |
| 8 | **Apply for Funding** | The file is clean. Time to send applications to banks. | Marked ready for next round **and** their product tier is one of the funding tiers | Dash. The tier check is **not optional** — leaving it out is a live bug right now, see defect 1 | **Verified** |
| 9 | **Prepare Next Round** | A bank said yes. Get the next batch ready. | Their card sits at the `approved` column on the funding board, **or** the newest round has an approved amount above zero | Show a dash | **Verified.** But the code says "Prepare Next **Funding** Round". Your chip says "Prepare Next Round". Matching your exact words finds nothing, forever. |
| 10 | **Ready to Fund** | Unknown. Nobody wrote down what this means. | **Nothing.** Zero matches anywhere in the system. The closest real signal is the same one row 9 uses. | Dash, always | **Needs you** |
| 11 | **File Prep** | Unknown. Nobody wrote down what this means. | **Nothing.** No column by that name. Three columns look close and no code touches any of them. | Dash, always | **Needs you** |

### Row 7 correction, and why it matters

An earlier draft of this table told you "Lock Fee" did not exist anywhere. **That was wrong**,
and the checker caught it. Two of the four fee-lock columns really are dead — but a live
automation writes a "funding locked date" every time a round funds with the fee set
(`src/workflows/f-07-funding-locked.mjs:65`). And when the fee is **not** set, the same
automation raises a task and tags the client (`:58-62`).

That gives Lock Fee something the other chips mostly don't have: a way to tell **not done**
apart from **done**. It is the strongest of the eleven.

---

## 4. The order — this one is yours

**Nothing in the code sets an order, and I am not going to pretend it does.**

An earlier draft claimed the code implied a priority. It doesn't. Eleven of the fifteen places
that write a status write no reason alongside it, so the system genuinely cannot tell you which
of two true things matters more. This is a business judgment. Pick one and it is decided.

**My recommendation — hardest blocker first:**

> Clear Fraud Alert → Collect Documents → Pull CRS → Remove Inquiries → Review Disputes →
> Review Funding File → Lock Fee → Apply for Funding → Prepare Next Round

Each step near the top stops more of the steps below it from being possible. A fraud alert
blocks everything. No credit report means no decision anywhere. A person always works the thing
that is holding up the most.

**Two other sensible orders, if you'd rather:**

- **Money first.** Lock Fee and Apply for Funding on top. Those are the only two steps that turn
  work into money coming in. Cost: files can pile up at the bottom with nobody noticing.
- **Our move before their move.** Everything a staff member controls above everything a client
  controls. Chasing a client who isn't answering looks like work but isn't. Cost: a quiet client
  drops down the list and gets forgotten.

**One thing no order fixes.** Three signals switch on and never switch off. Nothing removes a
fraud alert flag. Two of the three hold reasons are set and never cleared. So whatever you pick,
some clients will sit at the top of the list forever until somebody builds the "clear it" step.
That is separate work and it is in section 6.

---

## 5. The six rollups

| Tile | Can we build it? | What it would say today |
|---|---|---|
| **Total clients** | **Yes — but pick which number.** | 47 all · 37 without demo accounts · 26 without demo or archived · 19 that look like real people. That last one is **not a measurement** — there is no test-account flag, so it rests on a hand-written list of email patterns. Your two screens already disagree on this today (defect 6). |
| **Needs Pull** | **Yes, once you define it.** | Paid but no credit report on file. Three earlier readings of the same words gave 0, 30 and 46. It needs one sentence from you. |
| **Action Needed** | **Yes.** | Clients with at least one open task. **26 clients.** This is the only one of the six with both a real source and a real number today. |
| **Ready** | **No.** | No definition, and nothing in this system writes a status called "Ready." The one client that came back carried a value nothing here can produce — it came from outside the system, and that record is archived. Don't put this tile up yet. |
| **Total Prequal** | **Yes, with a warning.** | **$50,000 — and all of it is one client out of 47.** A tile showing that reads as a company total. Label it or leave it off. |
| **Total Approved** | **No, not honestly.** | The honest source is approved amounts on funding rounds, and that table has no real rows. Zero would be misleading. There is a column named "Total Approved" on a different table — **do not use it.** The code's own note says the name is historical and the number is a fee calculation, not an approval total. |

**Live numbers above came from the database agent, read-only.** The checker had no database
access and could not confirm them. The sources are all verified; the counts are one measurement.

---

## 6. Twelve live bugs found along the way

These are **not** part of this build and I am not fixing them. They turned up while reading.
Three are serious enough to decide on now.

**Serious:**

1. **A repair-only client is being told to "Apply for Funding."** Live right now. When their
   inquiry gets removed, the system writes that status without ever checking what they bought.
   `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45`
2. **The screen says "Pull CRS" for people who have not given permission.** The pull *button* is
   correctly greyed out. The *text above it* is not checked at all. Staff read an instruction the
   system will then refuse. `public/app/client-control-panel.html:889` vs `:1196`, `:1221`
3. **Every field write can reach into another company's records.** Updates happen by client ID
   with no company check. Nothing has gone wrong because there is one company in the database.
   The day there are two, it's a leak. `src/workflows/custom-fields.mjs:8`, `src/workflows/tags.mjs:8`

**The rest:**

4. The paperwork nudge can never stop — it checks two fields nothing ever writes.
5. The bank-email workflow does nothing on real mail — it needs a field the real message never carries.
6. Archived clients show on one screen and not the other, with no explanation. This is also why your two client totals disagree.
7. "We don't know" is being shown as "No." Blank gets turned into false before it reaches the screen. Your house rule says blank must survive.
8. The AI assistant's memory of a client is mostly blank — 12 of the 14 facts it reads are from the dead table.
9. Lead source on the closer cockpit falls back to a second-choice field. How often *that* one is filled has never been measured.
10. The cockpit reads the funding-versus-repair label out of the database and then throws it away before the screen sees it. One line to fix, and it's the single most useful thing a closer could know.
11. The "Total Approved" tile shows the prequal *estimate* when there's no real approval — so two tiles show the same number under two different labels, and one says "Approved."
12. Messages to the outside scheduling service are sent and forgotten, errors discarded. 14 of the 15 next-action writers depend on it. Nothing records whether they arrive.

---

## 7. COMPLIANCE REVIEW REQUIRED

Parts of a Phase 1 build would need your sign-off before shipping:

- **Showing, hiding, or reordering "Pull CRS."** This is credit-pull permission. Good news: the
  permission gate itself is real and well built, and a withdrawal takes effect immediately. Also
  worth knowing — this platform only does soft pulls. There is no hard-pull path at all.
- **Any next action shown to a repair-only client** (defect 1 above). That's credit-repair messaging.
- **Any next action shown during the CROA three-day window.** That hold is real and correctly
  written, but it is enforced in exactly one place. A new screen could show an action inside a
  window where none is allowed.
- **Any status whose words mention invoicing, charging or collecting.** That's fee timing.

The inquiry ID packet does correctly require a signed authorization document. That part is fine.

---

## 8. What I need from you

Seven questions. Answer as many as you can; 1 and the A/B at the bottom are the blocking ones.

1. **Which order?** My recommendation, money-first, our-move-first, or your own.
2. **What is "File Prep"?** Nothing in the system has that name.
3. **What is "Ready to Fund," and how is it different from "Prepare Next Round"?** Right now the
   only real signal for both is the same one — the card sitting at "Approved."
4. **Should "Lock Fee" mean "a round funded and nobody set the fee yet"?** That's the live trace.
5. **Which people should the counts count?** All 47, the 37, the 26, or the 19.
6. **Should "Total Approved" mean money the banks said yes to, or money that landed?**
7. **"Prepare Next Funding Round" or "Prepare Next Round"?** Same thing, or two different things?

**And the queue question, A or B:**

- **(A) `pipeline.html` gets a "Fulfillment" lens** — a toggle on the screen you already have.
  Client list with next-action chips, plus the six tiles. Chips filter the list, like your
  Airtable v1. **I recommend A** — it adds no new screen, and that page already loads a client list.
- **(B) `closer-dashboard` becomes the queue.** I do not recommend this. That page is the
  card-stacking and tradelines screen — it reads one client at a time, not a list. Turning it
  into a queue means rebuilding it, and taking away what closers use it for now.

---

## 9. How this was checked

Fifteen agents across two rounds.

Round one: one agent read the shared ground, four mapped the data (credit, documents and money,
funding rounds, live database), one drafted a table, three attacked it. **All three attackers
said the draft was not safe to ship.** They were right — it declared four database columns
missing that exist, and it missed a working six-stage board that was already live.

Round two settled every disputed fact, rebuilt the table, then opened all 84 file references one
at a time. 77 were exactly right. 4 were wrong and 3 pointed at the wrong line. **I checked all
7 myself before writing this page** — the Lock Fee one in particular, because it changed a
"doesn't exist" into a "this is the strongest signal we have."

Full working: [evidence folder](fulfillment-layer-2026-08-19-evidence/)

| # | Scope | Status |
|---|-------|--------|
| W1 | Ground: read layer, rollups, existing next_action | done |
| W2 | Credit signals | done |
| W3 | Documents and money | done |
| W4 | Funding rounds | done |
| W5 | Live database, read-only | done |
| M1 | First merged table | done — rejected by all three adversaries |
| A1·A2·A3 | Adversary passes | done — all three returned needs-work |
| R1 | Column reality | done |
| R2 | The state machine round 1 missed | done |
| R3 | Live re-measure | done |
| R4 | Existing helpers and compliance | done |
| REBUILD | Corrected table | done |
| VERIFY | All 84 citations opened | done — 4 wrong, 3 drifted, fixed here |

---

## 10. What happens next

Nothing, until you answer. Phase 1 does not start without your approval of this mapping and your
A-or-B.

When it does: worktree, pull request, no deploy, no merge. Read and display only. Every untouched
screen stays byte-identical.

---

# Phase 1 manifest

**COMPLIANCE REVIEW REQUIRED** — this build shows and hides "Pull CRS" on a permission
check, and it decides what a repair-only client is shown. Both are on Chris's list in
section 7 above.

**Date:** 2026-08-19 · **Branch:** `feat/fulfillment-layer-phase1` · **Status:** built, not
committed, not deployed, not merged.

Everything below was written from the code in this worktree, not from the plan.

## 1. What a person will notice

**On the Client Control Panel** — one new read-only block called "Control panel", under the
header, above "Need action". It says three things: what to do next about this client and one
sentence saying why, what is blocking the file, and where the funding round stands. The
"Next action" line the page already had is now driven by the same worked-out answer, so the
two lines on one screen cannot say different things. **No button was added, moved or
removed.**

**The big line is always a plain sentence and never the value saved on the record.** It
reads the step, or "No step applies right now.", or "Not worked out yet." — never a bare
dash. When the record carries a saved value it appears on a quiet line underneath, labelled
as what is on the record rather than as an instruction.

**On the pipeline board** — a **Board / Fulfillment** switch on the filter bar that was
already there. Board is on by default and is exactly the screen that shipped before.
Fulfillment shows the client list with a next-action chip on each row, the six rollup tiles,
and clicking a chip filters the list to it. Clicking the same chip again clears it.

**Nothing else on either screen changed.** No other screen in the repository was opened.

## 2. Files touched

**Counted from the final state of the diff, after the display fix round and adversary
round 3 below.** The three rounds grew every file in this table and added three files to
it, so the earlier numbers here were stale and have been replaced rather than annotated.

| File | New? | Size | What it is |
|---|---|---|---|
| `src/fulfillment/next-action.mjs` | new | 773 lines | The decider. Pure — it reads no database, opens no connection, and imports nothing that can. Takes gathered signals, returns the answer. |
| `src/fulfillment/next-action.test.mjs` | new | 1221 lines · 112 tests in 16 groups | Both compliance gates, both halves, plus the order, the honest-degrade rules, the money rules, the unread-blocker rule and the repair-only funding-round gate. |
| `src/fulfillment/read-signals.mjs` | new | 588 lines | The read layer. Every statement is a SELECT. One pass per page of clients, never a query per client. |
| `src/fulfillment/read-signals.test.mjs` | new | 253 lines · 11 tests | The read layer with no database — the four that force the blocker read to refuse live here. Added in adversary round 3. |
| `src/fulfillment/read-signals.pg.test.mjs` | new | 484 lines · 15 tests | Database-backed tests for the read layer, including the demo-row fixtures and the third org proving tile and chip agree. |
| `src/http/dashboard-next-action.test.mjs` | new | 817 lines · 29 tests | End-to-end tests over both dashboard endpoints. |
| `src/http/client-panel-screen.test.mjs` | new | 628 lines · 37 tests | The Client Control Panel's markup and money rules: the saved text never reaching the big line, the old tiles pinned to `main`'s rule, and neither screen reading a raw funding-round row. Added in the display fix round. |
| `api/dashboard/client.mjs` | changed | +82 / −1 | Adds the derivation to the reply for one client, wrapped so any failure returns the reply exactly as it was before. |
| `api/dashboard/clients.mjs` | changed | +87 / −1 | Adds the derivation per client plus the six tiles, wrapped the same way, behind `?fulfillment=1`. |
| `src/consent/index.mjs` | changed | +16 / −0 | One export added and nothing else. Behaviour unchanged. |
| `public/app/data.js` | changed | +10 / −3 | `FHData.clients()` takes an opt-in `{ fulfillment: true }`. Called as every other screen calls it, the request is unchanged. |
| `public/app/client-control-panel.html` | changed | +446 / −7 | The Control panel block and the code that paints it, the "No step applies right now." wording, the saved-record line, and the round block reading only the gated answer. |
| `public/app/pipeline.html` | changed | +731 / −0 | The lens switch and the lens, plus the truncation sentence on "Total clients". Additive only. |
| `src/http/pipeline-screen.test.mjs` | changed | +490 / −0 · 68 tests | Tests for the lens, added to the file that already tests that screen. |

**One tracked file outside this table moves whenever anybody runs the suite against a
database, and it is not this work's:** `src/verification/e2e-verification.pg.test.mjs`
rewrites `docs/END-TO-END-VERIFICATION.md` with the results of whatever database it just
ran on. It does the same thing on `main`. Treat any diff on that file as a by-product of
running the tests, not as a change anybody made.

## 3. Exports added

**`src/fulfillment/next-action.mjs`** — `NEXT_ACTIONS` (the order, frozen),
`FUNDING_CHIP_KEYS` (the four chips gate B blocks, written out a second time on purpose),
`guardConsentBeforePull`, `guardFundingProduct`, `deriveNextAction`.

**`src/fulfillment/read-signals.mjs`** — `SOFT_PULL_KIND`, `consentSignalFromRow`,
`gatherListSignals`, `signalsForListRow`, `gatherDetailSignals`, `listRollups`.

**`src/consent/index.mjs`** — `CONSENT_VALID_SQL`. Additive. It is the permission rule that
module already used, exported so a list of 500 clients cannot fork it into a second
hand-typed copy that drifts in the direction of allowing a credit pull.

**In the browser** — `window.FHFulfillmentLens` on the pipeline page, so the lens's
decisions can be tested without a screen.

## 4. Response fields added

**`GET /api/dashboard/client`** — four new keys at the top level: `next_action`,
`active_blockers`, `funding_round`, `next_action_degraded`. **All four are absent, not
blank, when the derivation could not run.** Nothing that was already in the reply changed.

**`GET /api/dashboard/clients`** — the same four on each client, plus one new top-level
`rollups` object holding `total_clients`, `needs_pull`, `action_needed`, `ready`,
`total_prequal`, `total_prequal_clients`, `total_approved`. Absent when it could not be
counted. Nothing that was already in the reply changed — in particular `crs_count` and the
mapped `custom_fields` object are untouched, bugs and all.

**And on that endpoint they are OPT-IN.** The work behind them costs eleven extra reads,
and this endpoint is also the client picker on the Client Control Panel, which uses none
of them. So they only appear when the caller asks with `?fulfillment=1`. Measured on the
same scripted request: **3 statements without the parameter — exactly what this endpoint
ran before this work — and 14 with it.** Without the parameter the reply is byte for byte
the reply `main` sends. Only the pipeline page's Fulfillment lens asks, through
`FHData.clients(200, { fulfillment: true })` in `public/app/data.js`.

The detail endpoint (`GET /api/dashboard/client`) is **not** opt-in and was not changed
here: it serves one client, its six extra reads are per page-load rather than per list,
and the Client Control Panel — its only caller — uses every one of them.

## 5. Routes affected

**None. No route was added, removed or re-gated.** Both endpoints above already existed and
are already in the `ROUTES` map. `npm run journeys` was re-run and all nine generated pages
came back byte-identical.

## 6. Database

No migration. No new table. No new column. No INSERT, UPDATE or DELETE anywhere in this
change. No workflow, event or job was touched — the 58 workflows and the funding-rounds
machinery are exactly as they were.

## 7. Journeys impacted

`role-owner`, `role-sales-manager`, `role-closer`, `role-funding-advisor`,
`role-inquiry-remover` — the five staff desks that reach both endpoints. `client`,
`affiliate` and `white-label` are blocked from both and see none of this.

**No `-actual.md` file changed, and that is the correct result.** Those pages record which
routes exist and who each one lets in. This work adds neither. The full record is one line
at the top of `docs/journeys/CHANGELOG.md`.

**No `-intended.md` file was edited.** A hook blocks it and the rule is right.

## 8. Gaps found — findings, not fixes

Seven, all recorded in the changelog line too. Numbers 2, 3 and 4 want an answer from Chris.

1. **No hand-written journey names either screen.** The Client Control Panel and the
   pipeline board appear in none of the eight intended files. Only the Specialist desk is
   described anywhere. So nothing written by a human says what a next action should say,
   what order the chips belong in, or that a permission gate or a product-type gate should
   exist on those screens. Chris's order and both gates come from his direction in this
   batch, not from a journey. An agent may not write them into the intended file.
2. **"Ready to Fund" is a step the code now has that nothing authorises.** Section 3 row 10
   above found zero matches for it anywhere in the system. The build lead added it, ranked
   it last, and gave it a meaning nobody wrote down: nothing blocking the file, the newest
   round not on hold, and the paperwork complete. **Chris needs to say whether that is what
   he means.**
3. **There is an eleventh chip Chris has not seen.** "Not enough information" is what the
   lens shows for a client whose next step could not be worked out. It is clickable and
   filterable exactly like the other ten. An empty cell would have read as "nothing to do",
   which is why it is a real chip with real words — but it is not on Chris's list.
4. **Two desks can be told to "Get Consent" and cannot do it.** A sales manager and an
   inquiry specialist both reach these two screens. Neither can reach
   `/api/consent/capture`, which admits owner, admin, closer and funding advisor only. Their
   own intended journeys say that block is correct. Nothing was changed to close this.
5. **A client with no recorded product type sees no funding chip at all.** That is the safe
   posture `src/config/product-path.mjs` requires and it was not weakened. It does mean the
   funding chips will look absent until `clients.outcome_tier` is filled in.
6. **These journey pages cannot show a screen change.** They record routes and gates only,
   so someone comparing intended against actual will see nothing of this work on either
   page. The changelog line is the only record of it in `docs/journeys/`.
7. **The twelve live bugs in section 6 above are untouched and stay Chris's.** Two are worth
   naming again: the client list's `crs_count` still counts demo rows as real credit pulls,
   and `src/workflows/c-03-inquiry-removed-resume-or-hold.mjs:45` still writes "Apply for
   Funding" onto a repair-only client's record without checking what they bought. **Only the
   display is gated here. The write is not.**

## 9. How the two gates were built

Each one is built twice, and each half has a test that fails if that half is removed.

| | Gate A — no permission, no pull | Gate B — repair-only sees no funding |
|---|---|---|
| Ordering half | "Get Consent" is ranked above "Pull CRS", and first match wins, so a client with no permission is never told to pull | Each of the four funding chips checks the product type itself and answers no |
| Hard half | `guardConsentBeforePull()` refuses "Pull CRS" on the final answer unless permission is known live. It knows nothing about the order, so reordering cannot defeat it | `guardFundingProduct()` reads its own separate list of the four chips, refuses repair-only by name, and fails closed on an unknown or missing product type |
| If the hard half ever fires | The whole answer is dropped and the screen falls back to today's display. A guard firing means the ordering above it is broken, and a broken order is not something to paper over |  |

**Both gates were widened by the rounds below, and the widening is the point of them:**

* **Gate A also covers the words underneath the big line.** The value saved on the client's
  record is written with no permission check at all and is literally "Pull CRS", so it was
  taken off the big Next Action line entirely and now sits on a quiet line labelled as what
  is on the record. The big line only ever shows a step the system worked out. See the
  display fix round, item 1.
* **Gate B also covers the money, not just the chip.** A `funding_rounds` row carries an
  approved amount and no chip is involved in painting it, so a repair-only client could read
  "approved $75,000" while correctly showing no funding chip. `funding_round` is now refused
  on any non-funding tier through the same `fundingChipsAllowed()` helper and the same
  whitelist the chips use, and the Client Control Panel stopped reading the raw newest row
  as a fallback — that fallback was the way around the gate. See the display fix round,
  item 3. That refusal does **not** mark the file as unread: it is the right answer, not a
  failure.

The screen and the pull button now read the same permission through the same
`consentStatus()` call the pull endpoint is gated on, so they cannot disagree. That closes
defect 2 in section 6 above.

---

## 10. Display fix round — 2026-08-19

Three display defects, both screens, no new route, no new column, no new screen, no write.

### 1. The big Next Action line said nothing at all when nothing applied

When the system worked the file out and found no step that applies, the big line went blank
and the page painted a bare dash. Directly under it sat the grey line reading
"Saved on the record: Pull CRS". A heading, a dash, then the forbidden words — it read as
though the dash were hiding the real instruction.

The line now says **"No step applies right now."** in plain words. All three answers are
sentences now, and no two of them read the same:

| The system worked it out and found a step | the step, e.g. "Get Consent" |
| The system worked it out and no step applies | "No step applies right now." |
| The system could not work it out | "Not worked out yet." |

The saved value stays where Chris approved it: a quiet line underneath, labelled as what is
on the record, never as an instruction.

### 2. Two money tiles that were already on the screen had quietly changed

`Prequal`, `Total Approved` and the two income-per-year lines were switched onto the new
shared money rule. That changed what they printed: a recorded zero became "$0" where it had
been a dash, and a negative became **"$-500"**. Nobody asked for either.

Those four displays are back on the rule they shipped with on `main`, byte for byte — a
recorded zero and a negative are both a dash there. The one shared whole-dollars rule stays
in place for the two NEW money values (this page's funding-round approved amount and the
pipeline lens's), which is what stops $50,000 rendering as $500 on one screen.

**Open question for Chris, not for an agent:** on those old tiles, should a recorded zero
read "$0" or a dash? It reads as a dash today because that is what it read before this work.

### 3. Funding money could reach a repair-only client

`funding_rounds` rows carry an approved amount. Both screens painted the newest one for
anybody who had one — including a REPAIR_ONLY client, who would read
"Round 1 · approved · approved $75,000" for funding they never bought. No chip was involved,
so Gate B's chip guard never saw it.

Gate B now covers the money as well as the chip, through **the same helper and the same
whitelist** — `fundingChipsAllowed()` in `src/fulfillment/next-action.mjs`, reading
`src/config/product-path.mjs`. A round is handed back only on the three funding tiers;
REPAIR_ONLY, an unrecognised tier and no tier at all all get nothing. `degraded` is not set
by this: refusing to show funding money to a repair client is the right answer, not a
failure to work one out.

The Client Control Panel's round block also stopped reading the raw newest row as a
fallback. That fallback was the way around the gate. It now paints the worked-out round or
dashes. The round number, status and hold reason a client does have are still on the page in
the tiles that always showed them.

### Files touched

| File | What changed |
|---|---|
| `src/fulfillment/next-action.mjs` | `funding_round` is refused on any non-funding tier, via the existing `fundingChipsAllowed()` |
| `public/app/client-control-panel.html` | the "none applies" wording; the old tiles back on `main`'s money rule; the round block reads only the gated answer |
| `public/app/pipeline.html` | comment only — records why `roundText` may never be handed a raw round row |
| `src/fulfillment/next-action.test.mjs` | +5 tests: the round is gated on exactly the tiers a chip is |
| `src/http/client-panel-screen.test.mjs` | the blank-slot test replaced with three stronger ones; +3 tests pinning the old tiles to `main`'s rule; +3 tests that neither screen reads a raw round row |

No test was weakened or deleted. One test asserted the old blank slot; it now asserts the
plain words, and two more were added beside it.

---

## Adversary round 3 — the numbers fix (read and display only)

Four findings, all a number or a chip stating something that was not true. Every fix was
checked by putting the defect back and watching the new test fail, then restoring it.

### 1. The tile disagreed with the chip beside it

`needs_pull` counted "paid, no real credit row, live written permission". The per-client rule
(`evaluatePullCrs`) has one more test the tile did not: `crs_status = 'Complete'` also means
the credit is already in, and `evaluateGetConsent` reads it the same way through
`completedCreditPull()`. Measured on real Postgres: the tile said 4, only 2 of those clients
got the chip.

The tile's `paidNothingPulled` fragment now carries
`TRIM(c.custom_fields->>'crs_status') IS DISTINCT FROM 'Complete'`. `TRIM` and
`IS DISTINCT FROM` are chosen to match the decider exactly — `str()` in `next-action.mjs`
trims and treats a blank as nothing, and a missing status must stay on the "not complete"
side. Both halves of the split population (`needs_pull` and `needs_consent`) read the same
fragment, so no client can fall out of both.

### 2. Demo rows were filtered for credit and nowhere else

`REAL_CRS_SQL` excluded `is_demo`; nothing else did. A demo task inflated `action_needed` and
painted a blocker pill with Demo Mode OFF, and a demo funding round drove a funding chip.
Both rows belong to a REAL client, so no client-level demo filter can hide them.

Now filtered, one identical clause each: `tasks`, `funding_rounds`, `cards`, `documents`,
`inquiry_removal_cases`, and the `action_needed` rollup's `tasks` subquery.

**Not filtered, and why:** `dispute_cases` and `dispute_responses` have no `is_demo` column
(160_metro2_dispute_engine.sql), and `v_invoice_balance` is a view (031_invoices.sql:445)
that does not carry `invoices.is_demo` through. Either needs a migration; this layer writes
no schema. Both recorded in the code comment.

**Trade-off, recorded:** the filter is unconditional, exactly as the credit read has always
been. With Demo Mode ON, a demo client's own demo rows are now skipped too, so their file
shows fewer blockers than before. Threading `demoOn` through `gatherListSignals` would mean
changing both endpoints; the credit read set the precedent and this follows it.

### 3. Honest degrade failed on the blocker read

`open_blockers` is built only when tasks, funding_rounds AND v_invoice_balance all succeed.
Any one failing dropped `blocker_inputs`, `ctx.blockers` became `[]`, and NOTHING was marked
degraded — and an empty blocker list is the whole condition for "Ready to Fund".

The read layer now sets `blockers_unknown: true` on that path. `buildContext()` reads it as
`ctx.blockersUnknown` and `evaluateReadyToFund()` answers UNKNOWN, which sets `degraded` and
`next_action: null`.

Deliberate boundaries:

* **Gate B is tested first inside the chip**, so a repair-only client is never degraded by a
  signal that only ever fed a funding step. No funding step for a repair-only file stays the
  CORRECT answer, not a failure to work one out.
* **An earlier YES is not degraded.** A client whose answer is "Get Consent" keeps it — that
  answer never read the blocker list. Degrading it would replace a useful answer with
  nothing, which is the opposite of the point.
* **Nothing is invented.** `active_blockers` stays `[]`; the honesty is in `degraded`.

This is rule 1's second half, now written into the module header: a chip whose YES rests on
an ABSENCE cannot tell an empty list from a list that never loaded.

### 4. A tile counting the whole book sat over a list cut off at one page

`loadOnce()` asks for 200 clients; `listRollups` counts the whole org with no limit. "Total
clients 47" over a list of 3 is fine at 47 and a lie above 200.

`rollupText()` takes a third argument, `shown`, and the "Total clients" tile carries one
sentence — "The list below shows 200 of these 431." — only when the two numbers disagree.
Absent, non-numeric or non-finite `shown` says nothing rather than guessing. No tile added,
no paging control added, no other tile affected.

### Files touched

| File | What changed |
|---|---|
| `src/fulfillment/read-signals.mjs` | `crs_status` added to the tile's rule; `is_demo` filter on five reads and the `action_needed` rollup; `blockers_unknown` set when the blocker read fails |
| `src/fulfillment/next-action.mjs` | `ctx.blockersUnknown`; "Ready to Fund" answers UNKNOWN on an unread blocker list; header's UNKNOWN inventory corrected (it named two chips; five can) |
| `public/app/pipeline.html` | `rollupText(rollups, id, shown)`; the "Total clients" sentence; `paintTiles` and `loadOnce` pass the count |
| `src/fulfillment/read-signals.pg.test.mjs` | +5 tests: demo task and demo round on a REAL client; a third org proving tile and chip agree on "Complete" |
| `src/fulfillment/read-signals.test.mjs` | +4 tests: the blocker read forced to refuse, end to end |
| `src/fulfillment/next-action.test.mjs` | +5 tests: the unread-list rule, its boundaries, and the flag being opt-in |
| `src/http/pipeline-screen.test.mjs` | +4 tests: the truncation sentence, and that it appears nowhere else |

No test weakened, no test deleted. No write, no migration, no column, no route, no screen,
no tab, no menu row, no workflow touched.

### Verified

* `npm run lint` — 1361 files parse clean.
* `npx tsc --noEmit` — not applicable, there is no `tsconfig.json` in this repo.
* No-DB: 257 tests across the six fulfillment / pipeline / endpoint files, all pass.
* Real Postgres (own scratch database `fh_numbers_fix`, local Postgres 16, migrated from
  `db/migrate.mjs`): `src/fulfillment/read-signals.pg.test.mjs` — 15 tests, all pass.
* Whole suite without a database: 6248 tests, 6242 pass, 3 fail, 3 skipped. The same 3
  failures reproduce on this branch's committed HEAD with none of this work in the tree —
  `scripts/journeys/generate.test.mjs`, `src/http/read-endpoints-org-scope.test.mjs`,
  `src/lib/no-unfenced-transmit.test.mjs`. Pre-existing, failure for failure.
