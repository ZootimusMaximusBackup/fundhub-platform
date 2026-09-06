# Progress page — repair pass proof, 2026-09-05

Three things were wrong with the progress page work. All three are fixed and all
three are shown here in a real browser, not read off the markup.

Every screenshot in this folder was marked by `_shots.mjs`, which draws each red
box from the element's own on-screen position a few milliseconds before the
shutter. If a box's target is missing the script stops instead of producing a
picture pointed at the wrong thing.

---

## 1. The link was dead. Chris was told it worked.

**What a client saw.** In the portal, under "Where your funding is", a link that
read *See exactly where your file stands*. Pressing it did nothing at all. The
page did not move. There was no error, no spinner, nothing — the browser simply
stayed where it was. Since the fake eight-dot stepper had been deleted and this
link put in its place, there was no way at all for a client to reach the new
page.

**Why.** `public/app/shell.js` decides which screens a person may open. It works
out "which screen is this link for" by looking at the file name, and it treats
anything ending in `.html` as a screen inside the app. But the progress page
lives at the top of the site, not inside the app folder — like the contract page
and the login page — so it is on nobody's list of allowed screens. Two separate
guards then fired on the one link: one hid the whole card it sat in, and the
other cancelled the click.

**The fix.** A web address that starts with `/` and is not inside `/app/` is not
an app screen, so neither guard touches it any more. This grants nobody any new
access — the progress page checks who you are on its own server, and it pins a
client to their own file.

**And it moved.** The link was inside a card that only appears for clients who
bought funding. Repair clients — who the progress page is mostly for — never saw
it. It now sits outside that card, so every client has it.

`01-portal-link-outside-the-funding-card.png`

**Proof it navigates.** `e2e/progress-page.spec.mjs` clicks it and prints the
address bar before and after:

```
URL BEFORE >>> http://127.0.0.1:43451/app/client-portal.html?id=aaaaaaaa-1111-4111-8111-111111111111
URL AFTER  >>> http://127.0.0.1:43451/progress.html
```

The spec that shipped before only checked the link was *visible* and that the
file contained the right text. Both passed while the link was dead. A visibility
check cannot see this failure and neither can a text search.

---

## 2. Every row of the history showed two dates, one day apart.

**What a client would have seen** the moment the read endpoint landed:

```
4 March 2026
Mar 3 · letters mailed to all three bureaus
```

Two dates for one event, disagreeing.

**Why.** The sentence the server sends already has a date on the front of it,
written in California time. The page was adding its own date beside it, written
in world time. An event saved just after midnight lands on different days in
those two clocks.

**The fix.** The timestamp field owns the date. The duplicate on the front of
the sentence is removed. If the sentence ever arrives in a shape the page does
not recognise, or the timestamp is unusable, the page adds no date of its own
and the sentence keeps the one it has — so exactly one date reaches the client
either way.

`02-timeline-one-date-per-row.png`

Both client screens do this: the progress page and the portal's Activity tab.

---

## 3. Rounds 4 and 5 promised work on files where nothing is happening.

**What a client saw.** On any file at round 4 or above: *"Rounds 4 and above are
escalation letters. We prepare them and send them for you."* Present tense, on
every such file — including one that had been cancelled and one that was on
hold. Nothing was being prepared and nothing was being sent.

An earlier draft of the page was worse still: a green ticked **PREPARED** chip
that was switched on by nothing more than the file having a stage at all. That
chip is gone and does not come back without a fact that actually means prepared.

**The fix.** Cancelled and on-hold files get their own sentence that says
plainly that nothing is being prepared or sent. Everything else is unchanged,
including the part that has always mattered most: this page never says a
complaint was filed, lodged or accepted by anyone, because nothing in this
system records whether one was.

`03-round-4-cancelled.png` · `04-round-4-on-hold.png`

---

## 4. A failed read no longer claims nothing has happened.

The portal's Activity tab used to leave *"No activity recorded on this file
yet."* on screen when the read failed. That is a sentence about the file, and a
read that never answered knows nothing about the file. A client with a year of
history would have been told they had none.

It now says the read failed. The "nothing yet" line is kept for the one case
that earns it: the endpoint answered, and answered empty.

`05-activity-tab-failed-read.png`

**This matters right now** because `/api/read/client-progress` is on a different
branch. Until that branch merges, this read returns "not found" for everybody —
so the honest message is the one every live client will actually see.

---

## Also fixed in this pass

* **Two web addresses that come back from the server are checked before the
  browser is sent to them** — the signed report link and the payment link. Only
  ordinary web addresses are followed. Anything else is treated as no link at
  all. Without the check, a bad value in either reply could have run code inside
  the client's signed-in page.
* **A second paid round is refused** once the first request has been accepted,
  at both places a client can start one. The message that used to say "press the
  button again" is gone, because pressing again is now declined.
* **The words "credit repair" are off the client portal.** They were rendered
  copy in five places: the promoted offer, two locked tiles, the unlock window
  and the text pre-filled into the chat box. They read "Capital readiness"
  instead. The stored product codes are untouched — the display changed, not the
  data.

---

## What was measured, and where

| Check | Result |
|---|---|
| `npm run lint` | 1847 files and inline scripts parse clean |
| Unit half (`npm test`, no `DATABASE_URL`) | 9024 tests, 9021 pass, **0 fail**, 3 skipped |
| Database half, serial, own scratch Postgres | 2454 tests, 2438 pass, **15 fail**, 1 skipped |
| Playwright, whole `e2e/` directory | **399 passed**, 0 failed, 26 did not run, exit 0 |
| `e2e/progress-page.spec.mjs` on its own | **18 passed** |
| `npm run journeys:check` / `diagrams:check` | both up to date |

The 15 database failures are the pre-existing ones. This branch's diff contains
**no file under `src/`, `api/` or `db/`** — only `public/progress.html`,
`public/app/client-portal.html`, `public/app/shell.js`, one new Playwright spec
and documentation — so no database test can have moved. Their names, recorded so
the next run can be compared by name rather than by count:

```
*** all three routes are reachable through the real ROUTES map ***
the sales page carries terms and NO earnings figure
*** an UNPAID autopsy cannot upload, and nothing is written ***
*** no attestation, no upload ***
the attestation is stored on the autopsy row, NOT in client_consents
*** AN SSN IS REFUSED AND NOTHING IS STORED ***
*** AN E-MAIL IS REFUSED AND NOTHING IS STORED ***
*** A PHONE NUMBER IS REFUSED AND NOTHING IS STORED ***
identity columns are dropped, counted, and their values never reach the database
a clean upload scores, stores, and keeps NULL as NULL
the report opens with a signed link and is refused without one
*** the delete button removes the rows and keeps the purchase record ***
an approval with no amount is not chased on the wrong rail, the wrong round, or after it was written off
running it twice does not duplicate the case, the items or the letter
the RAW seed — no emit step — is readable as a real bureau pull
```

Run on macOS against a scratch Postgres created for this pass
(`fundhub_pager3`, 246 migrations applied to an empty database), as
`fundhub_app` via `APP_DATABASE_URL`, one file at a time.

---

## What I did NOT do

* **I did not add the `/api/read/client-progress` route.** It is on another
  branch and merges first. Both client screens now degrade honestly while it is
  missing, which is the whole of my job here.
* **I did not touch the stored product codes** behind the renamed portal copy.
  `repair-bundle`, `REPAIR_DFY` and `REPAIR_TRIAL` are unchanged, and so is
  every server-side name in `src/config/offers.mjs`. Only what a client reads
  changed.
* **I did not re-measure the unit half against the base commit.** My diff adds
  no test under `src/` or `scripts/`, and the run reports zero failures, so
  there is nothing to compare against.

## One file outside this lane's owned paths

`public/app/shell.js` — twenty-five lines, all inside `screenOf()` and its
comment. It is the only place the dead link could be fixed: the two guards that
killed the click both live in that file and both read that one function. The
change is strictly narrowing (an absolute address outside `/app/` stops being
treated as an app screen) and it grants no role access to anything. Full detail
in the handoff.
