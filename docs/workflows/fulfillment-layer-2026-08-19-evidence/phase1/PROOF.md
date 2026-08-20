# Phase 1 — the proof, in pictures

**Date:** 2026-08-19 · **Branch:** `feat/fulfillment-layer-phase1` · **Nothing was committed. Nothing was deployed.**

This file is for reading without opening any code. Every picture in this folder is a real
screen, drawn by a real browser, filled with real numbers out of the live database. None of
it is a mock-up of what we hoped it would say.

---

## 1. The short version

The screens work. Real clients were pulled out of the live database and run through the real
code. Every one came out with a sensible answer. Nine pictures were taken. **Zero errors in
all nine.**

The one that mattered most — your TEST client, the one with half its data missing — did not
go blank, did not say "undefined", did not hang, and did not crash. It gave a smaller,
truthful answer.

The rest of the system did not move. **Thirty of the thirty-six screens are pixel-for-pixel
identical** to before this work. The six that are not are explained below, and four of them
are not really changes at all.

**Three things are wrong and you should know about them before this ships.** They are in
section 6. Two are new and both are on phones — one of them chops a money figure in half.
The third is a wording problem where two screens tell you different things about the same
client. None of the three break your two rules.

---

## 2. Your two rules

### Rule A — no written permission means staff are never told to "Pull CRS"

**Held.**

The simulated demo client has no written permission on file at all. Its screen says:

> **Get Consent**
> We do not have their written permission on file, so we cannot pull their credit yet.

The words "Pull CRS" appear nowhere on that screen's next-step line. See `ccp-sim-1440.png`.

Your TEST client is the other half of the same rule. It **does** have written permission —
recorded 18 August, never taken back, no end date. So its screen says **Pull CRS**, and that
is correct. Permission is on file, so the pull is allowed.

Across all 47 client records, **40 come back as "Get Consent"**. That is the rule doing its
job on the whole book, not just on one screen.

### Rule B — a repair-only client never sees a funding chip

**Held, on both screens, for a real client.**

One real client on your book bought credit repair only ("Chris Repair", `929fc1cb-…`).

- On the **list** view: four things blocking them, and **no funding step at all**.
  See `exhibit-repair-only-no-funding-chip.png`.
- On their **client file**: the big line reads **"No step applies right now."** with the
  reason "No step on the list applies to this file right now." Four blockers listed. The
  whole funding-round row is dashes. See `ccp-repair-only-1440.png` and
  `exhibit-none-applies-wording.png`.

This is the behaviour you already signed off. It is not a gap.

**One honest limit on rule B.** There are **zero funding-round records in the entire
database** — not for this client, not for anybody. So the dashes in the funding-round row
prove the screen handles "no record" honestly, but they cannot prove the extra guard that
would hide an approved dollar amount from a repair-only client, because no approved dollar
amount exists anywhere to hide. That guard is real in the code and is covered by written
tests. It just has no live example to photograph.

---

## 3. Where the numbers came from

I got into the live database. Read-only. Every single instruction sent to it was a "show me"
instruction — never a "change this" one. A guard in the script refused anything else before
it could reach the connection. No password or connection detail was printed anywhere.

- Database: `aws-1-us-west-2.pooler.supabase.com:6543/postgres` — the live one.
- Demo Mode on your company: **off**. So the counts below cover your 37 real client records.

The two clients:

| | which one | what makes it interesting |
|---|---|---|
| **Simulated client** | `376376b3-…`, made by the "load simulated data" button on 19 Aug | the full-data case |
| **TEST client** | `8556bedc-…`, `stanbridgejchris+e2e-fire@gmail.com` | the half-data case — its only credit report is a demo copy, so it counts as no real pull |

What the code actually returned for each of them is saved in **`derived-real.json`**. That is
the raw output, not a summary of it.

### The two answers

**Simulated client** → next step **Get Consent**. One blocker: "No written permission on
file", marked serious. No funding round. Nothing was unreadable.

**TEST client** → next step **Pull CRS**. Two blockers: "Start next funding round — clean
file" and "Mid-journey check-in". No funding round. Nothing was unreadable.

### The whole book, for scale

Out of all 47 records:

| answer | how many |
|---|---|
| Get Consent | 40 |
| Pull CRS | 1 |
| no step on the list applies | 6 |
| **could not work it out** | **0** |

Zero. Not one client record defeated the derivation.

The six tiles, counted over your 37 real clients:

| tile | value |
|---|---|
| Total clients | 37 |
| Needs Pull | 1 |
| Action Needed | 21 |
| Ready | — (nothing in the system records this, so there is no number) |
| Total Prequal | $50,000 — and it says on screen "From 1 client. This is not a company total." |
| Total Approved | — (no bank approval has ever been recorded) |

### One fact worth knowing before you look at any funding-round box

**There are zero funding-round records in the whole database.** Not for the TEST client, not
for the repair client, not for anybody. There are also zero cards on the funding
card-stacking board.

So every funding-round box on every client file is five dashes today, and it will stay that
way until something starts writing funding rounds. The box is behaving correctly. It just has
nothing to show yet, for anyone.

Same reason the "Total Approved" tile is a dash and the "Prepare Next Round" step can never
appear right now: both of them read from records that do not exist.

---

## 4. The pictures

All of these are the branch, filled with the real answers above. **Every one had zero errors
in the browser.**

| file | what it shows |
|---|---|
| `ccp-sim-1440.png` | Simulated client's file on a desktop. Big line: **Get Consent**. |
| `ccp-sim-390.png` | The same on a phone. |
| `ccp-test-1440.png` | **Your TEST client on a desktop. This is the one to look at.** |
| `ccp-test-390.png` | The same on a phone. |
| `lens-1440.png` | The pipeline page with the Fulfillment view switched on. All 37 real clients, each with a step and its blockers, plus the six tiles. On this picture: 30 say Get Consent, 1 says Pull CRS (your TEST client), 6 say "Not enough information" — see problem 6c about those six. |
| `lens-390.png` | The same on a phone. |
| `board-off-1440.png` | The pipeline page with the Fulfillment view switched **off** — the ordinary board, 17 cards, $50,000 estimated. |
| `board-off-390.png` | The same on a phone. |

A ninth, taken to settle a question that came up while writing this:

| `ccp-repair-only-1440.png` | The repair-only client's file. Big line: **"No step applies right now."** |

Close-ups:

- `exhibit-lens-tiles-1440.png` — the six tiles, so you can read the honest "no source yet" wording.
- `exhibit-repair-only-no-funding-chip.png` — the repair-only client on the list, no funding step.
- `exhibit-none-applies-wording.png` — the same client on their file, with the right words.
- `exhibit-lens-390-overlap.png` — the phone problem in section 6a.

---

## 5. What the TEST client actually says — word for word

This is the point of the whole exercise, so here it is written out.

**The big line at the top of the file:**

> Pull CRS

**Directly under it, small and grey:**

> Saved on the record: Apply for Funding

**In the Control panel block below, the reason line:**

> They paid for their credit report and we have not pulled it yet. Nothing here is telling
> anyone to do the saved value below.

**Active blockers — 2:**

> Start next funding round — clean file
> owned by inquiry_specialist
>
> Mid-journey check-in
> owned by funding_advisor

**Funding round:**

> Round —  ·  Finalized —  ·  Status —  ·  Approved —  ·  On hold because —

**What that proves.** The record on this client says "Apply for Funding". That text was
stamped there by an automation that never looked at whether a credit report exists. The
system worked out the truthful answer instead — **Pull CRS** — and put the stamped text
underneath, labelled as a saved value, not as an instruction. That is exactly the design you
approved.

The funding round is five dashes and not five zeros. This client has no funding round row at
all. A zero would have claimed they were approved for nothing. A dash says we have not
recorded it. That is your rule and it held.

Nothing was blank. Nothing said "undefined". Nothing spun forever. Nothing crashed.

---

## 6. Things that look wrong

I said I would tell you if a picture showed something bad. Three do.

### 6a. NEW — the Fulfillment view is unreadable on a phone

On a 390-pixel-wide phone the coloured blocker labels sit on top of the sentence next to
them, and the leftmost one runs off the edge of the card. You can still read the step, but
you cannot read the blockers.

See `exhibit-lens-390-overlap.png`. Cause: those labels are set never to wrap, and a label
longer than half the phone's width has nowhere to go.

This is new. It is not a safety problem — the step and the "No written permission on file"
warning are both still legible — but it is not shippable to anyone working on a phone.

### 6b. NEW — on a phone, the money figure gets pushed off the pipeline screen

Put `toolbar-main-390.png` next to `toolbar-branch-390.png`. Same board, same data, phone
width.

**Before:** a search box you can read ("Search n…"), a Filter button, and the whole summary —
**"17 cards · $50,000 est. · — held"**.

**After:** the new Board / Fulfillment switch takes 175 pixels of a 390-pixel row. The search
box shrinks to a bare magnifying-glass icon with no words at all. The summary is cut off
mid-number — you see "17 cards · $5…" and **"— held" is gone off the right edge entirely.**

Nothing was deleted from the page. It is a squeeze, and it only happens on a phone. But a
money figure that gets chopped in half is not a small thing, so it is listed here rather than
in the footnotes.

### 6c. NEW — the list view and the client file disagree about six clients

Six real clients came back from the system with a clear answer: *we worked it out, and none
of the steps on your list applies to this file right now.*

Here is the same client, on two screens, at the same moment:

| screen | what it says | picture |
|---|---|---|
| **Client file** | "No step applies right now." — *No step on the list applies to this file right now.* | `exhibit-none-applies-wording.png` |
| **Fulfillment list** | "Not enough information" — *We could not work out a next step from what is on this client's file.* | `exhibit-repair-only-no-funding-chip.png` |

The file is right. The list is wrong. The system did work it out; the answer was "nothing
applies".

That client is your repair-only one. Telling you we could not work out their step — when the
real answer is "correct, a repair client has no funding step" — makes correct behaviour look
like a fault. It affects six of your records today.

It is a wording fix on the list view only. The file view already has the right words.

### And three that were already like this — not caused by this work

I checked each of these against the old version of the screen and they are identical there.

1. **The client file is unusable on a phone.** At 390 pixels wide the page still tries to put
   a 300-pixel side column next to the main column, so the main column is squeezed to about
   90 pixels and text wraps to one or two letters a line. Compare `ccp-test-390.png` with
   `paint/client-control-panel-390-main.png` — the old version is just as bad.
2. **The credit scores tile shows 718 / 724 / 731 on your TEST client with nothing saying that
   credit file is a demo copy.** Phase 0 already flagged this. The screen shows real-looking
   scores for a report that was copied from the demo client.
3. **The clock in the top bar overlaps the logo** on a 1440-wide window. Both versions.

### Two things in the pictures that are my test rig, not the product

I have to name these or you would read them as faults.

1. The Actions block says *"Could not check consent from this screen."* That is because my
   stand-in server did not answer the consent question in the shape the screen expects. On
   the real site that question is answered. Ignore that line.
2. On the simulated client's picture the client picker reads "Choose a client" instead of
   naming them. Demo clients are hidden from the list I served, so the picker could not find
   them. Also my rig, not the product.

---

## 7. The paint walk — did anything else move?

I rendered **every one of the 36 screens** twice: once from the old version, once from the
new one, with exactly the same stand-in data. Then I compared the two pictures.

"Old version" here means the last saved commit, `33004eb8` — which is this branch with the
Phase 1 screen changes taken back out. So the comparison is exactly "before this work" versus
"after this work", and nothing else.

To make the comparison mean something, both runs had the clock frozen to the same second and
every random number fixed, so a screen that draws the same thing twice really does produce
the same picture twice.

**Thirty of thirty-six are identical — the same picture, byte for byte.** Zero browser errors
on all 72 renders.

Before that, a simpler check: of the 71 page, script and style files the browser downloads,
**68 are byte-for-byte the same file in both versions.** Only three differ:
`client-control-panel.html`, `pipeline.html`, and `data.js`.

| screen | same picture? | pixels different | same wobble when compared to itself? |
|---|---|---|---|
| affiliate, agent-editor, automations, brand-studio, campaign-manager, client-portal, closer-call, closer-dashboard, company-brain, consent-capture, content-admin, contracts, creative-factory, documents, finance-os, hiring, inquiry-remover, journeys, lenders, messaging, my-numbers, ops-admin, payment-success, present, products-commissions, sales-floor, social-studio, soft-pull-approve, staff-teams, template-editor | **YES — identical** | 0 | — |
| **client-control-panel.html** | no — **this is a screen we changed** | 1,113,052 | no wobble: renders the same every time |
| **pipeline.html** | no — **this is a screen we changed** | 49,664 | no wobble: renders the same every time |
| index.html | no — but see below | 49,664 | no wobble |
| calendar.html | no — but see below | 44 | **yes: 44 when compared to itself** |
| galaxy.html | no — but see below | 526 | **yes: 613 / 279 when compared to itself** |
| partner-galaxy.html | no — but see below | 267 | **yes: 138 / 129 when compared to itself** |

Full numbers: `paint-walk-summary.json`. Every raw measurement: `paint-walk-raw.json` and
`pixel-diffs.json`. Red-highlighted difference pictures: `paint/<screen>-diff.png`.

**index.html is not really a sixth screen.** It is the front door. Open it as an owner and it
sends you straight to the pipeline board. Its difference is 49,664 pixels — the exact same
number as pipeline.html, which is how you know it is the same picture.

**calendar, galaxy and partner-galaxy do not draw the same thing twice.** Two of them animate
a moving star field. When I compared each screen to *another render of itself*, the wobble was
the same size as, or bigger than, the difference between the two versions. Their files are
byte-for-byte identical in both versions, so nothing in this work could have touched them.

### Exactly what moved on the two screens we did change

I measured every button and box on both screens, in both versions, down to the pixel. Numbers
in `control-positions.json`.

**Client file (`client-control-panel.html`)**

- **Nothing was added and nothing was removed.** The new Control panel block contains no
  buttons at all — it is read-only, by design.
- Nine things moved **straight down by 603 pixels** and nothing else: Pull TransUnion, Pull
  Experian, Pull Equifax, Generate Apps, Issue Inquiry Removal, and the four collapsed
  headings under them.
- **Not one of them moved sideways. Not one changed size.** They are in the same order,
  the same width, the same height — just further down, because 603 pixels of new panel was
  added above them.

**Pipeline (`pipeline.html`)** — see `toolbar-main-1440.png` next to `toolbar-branch-1440.png`.

- **Two buttons added**: "Board" and "Fulfillment", side by side, at the left of the toolbar.
- **Three things moved 175 pixels right and 1 pixel down**: the magnifying-glass icon, the
  search box, and the Filter button. Same size, same order, same row — pushed along by the
  new switch.
- Two buttons inside the card drawer ("Archive", "Close") moved **2 pixels down**.
- **Nothing was removed. Nothing changed size.** Twelve controls did not move at all.
- Below the toolbar the board itself is unchanged apart from that same 2-pixel drop.

So: on the client file no existing button changed position sideways and none changed size.
On the pipeline, three existing controls did move sideways — 175 pixels right — because the
new switch was put in front of them on the same row. On a desktop that is fine. On a phone it
causes 6b above.

---

## 8. What this does NOT prove

Read this part.

**Pictures prove drawing, not fetching.** Everything above shows that the screens *display*
the right thing when they are handed the right answer. In these tests the answer was handed
to them by a stand-in server, not fetched live over the network. The answer itself was real —
it came out of the live database through the real code — but the trip from the database to
the browser was short-circuited.

The part these pictures cannot cover is the database work: whether the counting instructions
are right, whether demo records are properly excluded, whether one company can see another's
clients.

**That part is covered by written tests, not by pictures. Here they are, by name:**

| test file | how many tests | did they run here? |
|---|---|---|
| `src/fulfillment/next-action.test.mjs` | 95 | **yes — all passed** |
| `src/http/pipeline-screen.test.mjs` | 52 | **yes — all passed** |
| `src/http/client-panel-screen.test.mjs` | 28 | **yes — all passed** |
| `src/http/dashboard-next-action.test.mjs` | 24 | **yes — all passed** |
| `src/fulfillment/read-signals.test.mjs` | 7 | **yes — all passed** |
| **Total run here** | **206** | **206 passed, 0 failed, 0 skipped** |
| `src/fulfillment/read-signals.pg.test.mjs` | 10 (in 2 groups) | **NO — see below** |

**The 10 database tests were not run, and I will not pretend otherwise.** They need a real
Postgres database to run against. Without one they quietly report "0 tests" — which looks
like a pass and is not one. The only database I could reach from here is the live production
one, and running tests against production is not something I will do.

Those 10 are the ones that check: a demo credit record does not get counted as a real pull; a
demo client stays hidden while Demo Mode is off; "Action Needed" counts clients rather than
tasks; "Ready" and "Total Approved" stay blank instead of turning into zero; a client with no
prequal recorded stays blank instead of turning into $0; the chips and the tiles agree; and
"Needs Pull" only counts clients somebody actually has permission to pull for.

**Somebody has to run those 10 against a scratch database before this merges.** That is the
one gap in this proof.

**Two smaller limits.** These pictures were taken in one browser (Chromium) at two widths
(1440 and 390). Nobody clicked through a real login. And the phone pictures are a browser
pretending to be phone-sized, not an actual phone.

---

## 9. Files in this folder

| file | what it is |
|---|---|
| `PROOF.md` | this |
| `derived-real.json` | the raw answer the real code gave for the two real clients |
| `ccp-sim-1440.png`, `ccp-sim-390.png` | simulated client's file, desktop and phone |
| `ccp-test-1440.png`, `ccp-test-390.png` | TEST client's file, desktop and phone |
| `ccp-repair-only-1440.png` | repair-only client's file, desktop |
| `lens-1440.png`, `lens-390.png` | pipeline with the Fulfillment view on |
| `board-off-1440.png`, `board-off-390.png` | pipeline with it off |
| `toolbar-main-1440.png` / `toolbar-branch-1440.png` | the pipeline toolbar, before and after, desktop |
| `toolbar-main-390.png` / `toolbar-branch-390.png` | the same, phone — this is problem 6b |
| `exhibit-lens-390-overlap.png` | problem 6a, close up |
| `exhibit-repair-only-no-funding-chip.png` | rule B holding on the list, and problem 6c, close up |
| `exhibit-none-applies-wording.png` | the same client's file, with the right words — the other half of 6c |
| `exhibit-lens-tiles-1440.png` | the six tiles, close up |
| `paint/<screen>-main.png` / `-branch.png` | all 36 screens, both versions |
| `paint/<screen>-390-main.png` / `-branch.png` | the two changed screens at phone width |
| `paint/<screen>-diff.png` | the differences, in red, for the six screens that differ |
| `paint-walk-summary.json` | the comparison table as data |
| `paint-walk-raw.json` | every measurement from the comparison run |
| `pixel-diffs.json` | how many pixels differ, and where |
| `control-positions.json` | every button's position, both versions, both changed screens |

---

## 10. What I would do next

1. Fix 6c — the list view's wording for "nothing applies". It is a small change and it stops
   two screens telling you different things about the same client.
2. Fix 6a and 6b, or decide the Fulfillment view is desktop-only for now and say so.
3. Run the 10 database tests against a scratch database. Nobody has.
