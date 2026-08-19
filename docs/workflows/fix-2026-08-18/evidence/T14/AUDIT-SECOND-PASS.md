# T14 — second pass, after an adversarial audit of the first fix

A multi-agent audit was run against the committed branch on 2026-08-19. Six
finders raised **32 candidate findings**. The run hit a session limit: only
**19 of 71 agents completed**, so only 7 findings were adversarially verified
and 25 were never checked either way. **This audit is incomplete and must not
be read as a clean bill of health.**

Everything below was then verified by hand, by reading the code.

## Confirmed real, and fixed in this pass

### 1. The first thank-you fix did not actually work (BLOCKER)

The gate trusted a browser note called `fh_booking_v1`. That note was written
by a timer every 0.4 seconds as soon as a visitor **clicked a time slot** —
before any name, any email, or any submit. So:

- Click a slot, close the tab, come back later → "Your Call Is Booked."
- The person adds it to their calendar and waits for a call nobody scheduled.

Fixed in two places. `04a-book-top.html` now refuses to write the note at all
unless a name and an email are filled in, and only writes it when the person
actually presses Book or Confirm — the every-0.4-seconds writer is gone.
`05-thank-you.html` now additionally requires the note to be recent (6 hours),
and the appointment to still be in the future.

Proven — five cases, `gate-cases.json`:

| Situation | Page says |
|---|---|
| No note at all | We've Got Your Application |
| Slot picked, form never filled | We've Got Your Application |
| Note left over from last week | We've Got Your Application |
| Call already happened | We've Got Your Application |
| Real, fresh, upcoming booking | **Your Call Is Booked** |

### 2. The page still gave booking advice to people with no booking

"What happens on the call" and "Need to move it? Reschedule straight from the
confirmation email" were shown to everyone. Both are now hidden unless a real
booking exists.

### 3. The education page still sold things that do not exist

The first honesty pass missed the scrolling banner and the FAQ. The banner
promised "40+ video lessons per program", "Complete template libraries" and
"Lifetime access with updates". The FAQ said **"Most students complete a
program in 4 to 8 weeks"** — there are no students; nothing has opened. All
removed or marked as planned.

### 4. The honest "nothing has opened" page could not be reached

`/education/learn/` was linked from nowhere. Now linked from the education footer.

## Confirmed real, NOT fixed — you need to know these

### The new enrolment endpoint has zero executed tests

`npm test` reports 5840 passing. **None of those are database tests.**
`scripts/run-suite.mjs:69` stops the run the moment any unit test fails, and two
unit tests already fail on untouched `main`. So the database tests never start.
Run directly, `src/http/education-enroll.pg.test.mjs` reports **0 tests** with no
database configured.

The enrolment endpoint therefore shipped with **no test that has ever run**.
The tests exist and look correct; nothing has executed them.

### Nothing reads the enrolment rows

A person can now really enrol. No screen anywhere shows those rows to staff. The
data is saved and unseen until someone builds a way to look at it.

## Not fixed, and not fixable here

The apply, booking and thank-you pages are hosted by ClickFunnels. **All three
fragment fixes — including the blocker above — do nothing on the live site until
a person pastes them into the ClickFunnels editor.**

## Findings raised but never verified

25 of the 32 findings were never checked, because the audit ran out of capacity.
They are recorded in the workflow journal. They are candidates, not facts, and
this thread does not claim them either way.
