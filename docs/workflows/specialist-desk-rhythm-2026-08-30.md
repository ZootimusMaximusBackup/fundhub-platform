# Specialist desk — two rhythms, one screen (2026-08-30)

Branch: `fix/specialist-desk-rhythm`
Screen: `public/app/inquiry-remover.html`

---

## The job, in one paragraph

Two different jobs live on this one screen and they have opposite rhythms.

**Inquiry removal is a queue you empty.** A robot opens the case when a deposit
clears. Check the client's papers, read the draft letter, press Send. Then a
clock starts, and when it runs out a sweeper phones the bureau on its own with
no human click. Start to finish: one to three business days.

**Credit repair is a caseload you nurse.** Stage the round, read the letters,
send them, wait thirty days for the bureau, read the answer, decide the next
round. Up to six rounds. Roughly seven months. You never empty this list.

The screen showed neither rhythm, and three of the things it said were not true.

---

## What was wrong, measured — not guessed

Every number below was measured against a 40-row fixture at 1440x900, with
bureau values written **both** ways: the two-letter code today's writers use, and
the full bureau name the older rows carry. Before/after screenshots are in
`docs/workflows/specialist-desk-rhythm-evidence/shots/` (that folder is
gitignored, so the pictures are handed over rather than committed).

### 1. The bureau chips counted the wrong thing

The three chips compared **full bureau names**. The rows carry the **two-letter
code**. Measured: the chips totalled **19 while 33 inquiries were open** — 14 open
inquiries invisible. Press a chip and the queue could empty under the words
"all done for today".

Both sides now go through one normaliser. A code and a name are one bureau. An
unrecognised bureau keeps its own identity rather than being folded silently into
somebody else's count.

### 2. "Docs: complete" was invented

The screen printed `complete` for every case that was not already `Blocked`, and
`Blocked` is only ever set at send time. So a client's identity packet that
**nobody had ever looked at** read "complete" on the one screen whose whole job is
deciding whether to press Send.

The real answer already existed in `src/inquiry-ops/doc-gate.mjs` and nothing
called it. The reader calls it now, in one query for the whole page. There are
three states, not two:

| Says | Means |
|---|---|
| `complete` | the packet was checked and everything required is on file |
| `chasing` | the packet was checked and something is missing (named in the row detail) |
| `not checked` | nobody has looked yet, **or the check itself failed** |

A failed packet read comes back as NULL and shows as "not checked". It is never
coerced to false and never to "complete". "We could not look" and "we looked and
it is short" are different sentences to the person about to mail a dispute letter.

### 3. "Recent Letters Issued" had no reader

It was static markup. Nothing on the page ever wrote into it, so it would have
said "No letters issued yet" after the fortieth letter went out — true on day
one, never true again.

The trail existed the whole time: every send logs a letter or portal attempt.
`GET /api/inquiries?recent=letters` reads it back. Same endpoint, same auth, same
org binding as the per-row history — no new route.

### 4. Both headlines counted a page, not a caseload

Both readers defaulted to 100 rows and the screen counted its headline over
whatever page it got. Past 100 the number silently under-reported, on exactly the
day the desk is busiest. Both readers now return `COUNT(*)` over the whole queue
beside the page, and the screen says plainly when it is showing a slice.

### 5. The inquiry queue ran backwards

The reader ordered newest first. With a limit, the rows that fall off the end are
the **oldest** — exactly the cases the desk exists to clear. The case she had just
worked jumped to the top; the one nobody had touched sank out of sight.

Oldest first now, with the age shown in its own column and the top of the queue
marked.

### 6. The Due column was being cut off

Measured: the repair table's right edge sat at **1478px inside a 1440px window**,
its wrapper was `overflow-x: visible`, and `body { overflow: hidden }` swallowed
the rest. No scrollbar, no clue anything was missing — and the column being cut
off was **Due**, the countdown the entire triage rhythm runs on.

Each table scrolls in its own box now. The page never scrolls sideways.

### 7. The frame

- Top-left is now the one number, at metric size (§12 rule 1). The operator's own
  name left that row — it is still in the status bar and in the role chip.
- The next action is said once, directly under it, at one weight (rule 2). It
  opens the exact row it names.
- The filter tiles moved **below** the action (rule 3). The five repair tiles now
  fit on one row instead of wrapping and growing the header band.
- One font-size escape hatch, per §12.7, naming only classes this screen owns.
  Nothing shared — `.chip`, `.clock`, `.statusbar`, `.live-pill`, `.av`, `.mono`
  are the brand file's and `shell.js`'s, and a rule here would have resized them
  on every screen in the app.

### 8. A real hole closed

Both reads were on `ROLE_SETS.STAFF`. **A setter could open this screen and read
every client's dispute file** — which items, which bureau, which round, and what
the letters say. They are now on `ROLE_SETS.SPECIALIST_DESK`: owner, admin,
inquiry_specialist, funding_advisor. That is deliberately the same four roles
`/api/pii` already limits identity reads to.

The closer, sales-manager and owner journey route tables changed as a result.
That change is the point, not a side effect.

---

## The headline numbers, and where each one comes from

| Pane | Top-left | Traced to |
|---|---|---|
| Inquiries | **"Ready to send"** — cases nothing has been sent on yet | `caseUiStatus()` over six real columns on `inquiry_removal_cases`, written by the call scheduler off real delivery and never off send time |
| Inquiries | **"oldest waiting N days"** under it | `inquiry_removal_cases.requested_at` — already the data, never displayed until now |
| Repair | **"Need me"**, with **"of 40 open"** beside it | `rollupCounts()` over the same chip logic the rows themselves use, so the number and the list cannot disagree |

The inquiry number goes **down** when she works, because only she can move it.
The repair number never reaches zero, which is why the comparison beside it is
what makes it readable at all.

Nothing shows a zero standing in for unknown. A read that failed puts an em-dash
in the slot and says the queue could not be read.

---

## What I did NOT do, and why

- **No pane-per-role landing.** The brief asked that an inquiry person land on
  the inquiry desk and a repair person on the repair desk. There is no data
  anywhere in this repo that distinguishes an inquiry person from a repair
  person — the intended journey says the Specialist runs both. Inventing that
  mapping would have been a guess dressed as a rule. What the desk does remember
  now is which side **you** were last working, which is per-viewer and true.
- **The consent gap is carried, not fixed.**
  `src/repair/read-repair-signals.mjs:211-216` sets `authorization_ok = true`
  whenever a `repair_programs` row exists and is not cancelled, even with no
  signed consent on file — which suppresses the "Needs agreement" chip for
  clients who have not signed. And a failed consent read returns null, so a
  broken consent table reads as "everything is fine". Left alone deliberately:
  it is consent capture, it needs its own compliance-flagged change, and mixing
  it into a layout branch would bury it.
- **No new page, screen, tab or menu row.** Everything moved inside surfaces that
  already existed.

---

## Verification

| Gate | Result |
|---|---|
| `npm run lint` | 1612 files parse clean |
| `npm test` (unit phase) | **7333 tests, 7323 pass, 10 fail** — the same 10 names that fail on `main`, none of them this screen |
| pg phase, own scratch Postgres, freshly migrated | **1955 tests, 1926 pass, 28 fail, 1 skipped** — byte-identical failure list to `main` run the same way on its own fresh database. All 28 are partner/RLS isolation tests, the known artifact of connecting as the database owner |
| `npm run guard:db` / `guard:rls` as `fundhub_app` | 3/3 and 4/4 pass |
| Playwright `e2e/specialist-desk.spec.mjs` | 5/5 pass |
| Playwright, the four other specs that open this screen | 86 pass, 4 fail — the same 4 that fail on `main` |
| Scratch databases | dropped |

**A trap worth writing down:** `scripts/run-suite.mjs` exits after the unit phase
when the unit phase is red. The unit phase is red on `main`, so **`npm test` never
runs the pg phase at all** — the summary looks like a full run and is not one. The
pg numbers above came from running those 137 files by hand, serialized.

New tests added: 33. They cover the bureau normaliser, the three doc states, the
waiting age, the oldest-first sort, both headlines, the batch packet reader (and
that a failed read of it is null, not "complete"), both caseload counts, and the
new role gate.
