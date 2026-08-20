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
