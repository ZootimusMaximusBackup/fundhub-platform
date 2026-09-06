# Cursor task list — hiring, after PR #336

**Date:** 2026-09-05
**Context:** PR #336 built the applicant chain: a public careers page, candidate
outreach on a cron, interview booking, req routing, and a Zoho Recruit connector.
These are the pieces that were deliberately NOT built, each with why.

**Read `CLAUDE.md` first.** Especially §0 (split the work), §3a (back end before
front end), §12 (the traps). Every task below is one lane. Do not take two at once.

**Rules that are not negotiable in this area:**

- **No candidate is ever rejected by software.** Enforced in four places
  (`pipeline.mjs`, `api/hiring/decide.mjs`, a CHECK and a trigger in 051). Do not
  add ranking-that-rejects, auto-decline, or an AI screen. This is Title VII and
  NYC Local Law 144, not a preference.
- **Never invent job descriptions, scorecard targets, or pay figures.** Absence is
  the finding. `src/hiring/zoho.mjs` already refuses to post a req with no brief
  rather than writing one — keep that behaviour.
- **Protected characteristics never reach the scorer.** `src/hiring/grading.mjs`
  holds the deny-list. Mirror it, do not fork it.
- **Outbound calls only through `transmit()`** in `src/lib/outbound-fetch.mjs`
  with a declared fence. `src/lib/no-unfenced-transmit.test.mjs` fails the build
  otherwise.
- **Measure on a CLEAN scratch Postgres.** Running the full suite creates orgs and
  wipes message templates, so a second look at hiring afterwards reports phantom
  failures. Rebuild the database before believing a red result.

---

## 1. Google Calendar free/busy — the biggest gap

**Why it matters:** booking today guarantees two hiring interviews never collide
(a database exclusion constraint enforces it), but it is **blind to the host's
real calendar**. If Sarah has a sales call at 2pm, we will book over it.

`src/hiring/booking.mjs` documents this at the top and pins it with a test named
"`bookings` still has no staff column — the free check is blind to sales calls".

**THERE IS NO GOOGLE WORKSPACE. Owner confirmed 2026-09-05: the account is a
personal Gmail (`fundhub.ai@gmail.com`), there is no Workspace tenant, and he is
not buying one.**

That rules out the obvious route. `src/company-brain/auth.mjs` builds a
service-account JWT with **domain-wide delegation**, which reads any user's data
without them consenting — and domain-wide delegation requires a Workspace admin
console that does not exist here. **Do not design against it, and do not tell the
owner to open admin.google.com.** An earlier version of this file did; it was
wrong.

**Use per-user OAuth instead.** Each staff member authorises their own calendar
once, and we store their refresh token. On a personal Gmail this is free and
needs no admin anything.

Prior art in this repo, both already working:
- `GOOGLE_DRIVE_OAUTH_TOKEN_JSON` / `GOOGLE_GMAIL_OAUTH_TOKEN_JSON` — user
  tokens, not service-account, already read by `src/company-brain/` and
  `src/gmail/`. Follow that shape.
- `src/social/oauth.mjs` — `signState` / `verifyState` / token encryption, and
  `api/social/oauth.mjs` is a working start/callback endpoint pair.
- `src/hiring/zoho.mjs` — the newest example of storing an encrypted per-org
  refresh token and refreshing it before use.

Scope needed: `https://www.googleapis.com/auth/calendar.readonly`.

**The consequence to design around:** a host who has not connected their calendar
has no free/busy data. Treat that as "cannot offer times", surfaced by name, not
as "free". See the fail-closed rule below.

**Build:**
- A `freeBusy` read per host email against
  `POST https://www.googleapis.com/calendar/v3/freeBusy`, through `transmit()`
  behind a fence.
- Feed it into `src/hiring/booking.mjs`'s existing free check so a slot is offered
  only when BOTH our interview table and the host's real calendar are clear.
- Fail CLOSED. If the calendar cannot be read, offer nothing and say why — do not
  fall back to "probably free". Double-booking a hiring manager is worse than
  offering fewer slots.
- Cache within a request. Do not call Google once per candidate per slot.

**Reuse, do not rebuild:** `src/social/oauth.mjs` for the connect flow and state
signing, `src/adplatforms/tokens.mjs` for encrypting the refresh token at rest,
`src/hiring/owner.mjs` `assigneeFor` to decide whose calendar to read.

**Owner action, and it is two clicks not an admin console:** Chris and Sarah each
open a "connect my calendar" link once and press allow. Build that link; do not
ask him to configure anything in a Google admin panel, because he does not have
one.

---

## 2. Nobody is told an application arrived

An application lands in the `applied` stage and sits there. No task, no email,
nothing. Whoever owns the req finds out by opening the hiring board.

`src/hiring/owner.mjs` `assigneeFor` already resolves the right person or role.
`src/lib/create-task.mjs` writes the to-do. This is a small lane.

Make it idempotent per application — a re-run must not stack duplicate tasks.

---

## 3. The apply endpoint's burst limit does not survive a restart

`src/hiring/apply-public.mjs` counts per-address and org-wide limits from real
rows, which hold everywhere. The **per-source-address burst limit is in memory**,
so it resets on a cold start and is not shared between function instances.

Needs a small table recording refused attempts, and the limit read from it.
That is a migration, which the lane that built it was told not to add.

**Use migration 346 or higher** — main is at 345.

---

## 4. Two competing "we need to hire" triggers, and only one is scheduled

- `src/hiring/bench.mjs` `checkBench` — bench below target. **Scheduled** via
  `src/workflows/hiring-bench-sweeper.mjs`.
- `src/ops/hire-closer.mjs` `actOnPacked` — packed calendar. Reachable only by a
  human pressing `POST /api/ops/hire-closer`, and every run tries to post to
  LinkedIn, which has no partner access and cannot succeed.

Decide whether they compose or one retires. Do not schedule `actOnPacked` while
its LinkedIn call is dead. Write the reasoning into the header of whichever
survives. **Ask Chris before retiring either** — this is a product decision.

---

## 5. The equal-opportunity survey has no data and no code

`db/migrations/053_eeo_selfid.sql` built the whole voluntary self-ID flow — the
tokens, the write that severs the link between a person and their answers, the
aggregate view that hides small groups. **No code anywhere reads or writes those
tables.** So the adverse-impact analysis it exists to enable has nothing in it.

Its design requires the survey to be a **separate submission** from the
application, so it cannot be bolted onto the careers form. Build the invite path.

Read 053 in full first. The severing behaviour is the point of the design and is
easy to break by accident.

---

## 6. Re-trace the hiring journey pages

`docs/journeys/hiring-actual.md` and `hiring-flow.md` were written while four
other lanes were still landing code, and they say so at the top. They list the
paths that were still moving.

Re-trace both **from the code**, not from the spec. Mark anything you cannot
trace as `UNVERIFIED`. Do not write `hiring-intended.md` — agents never author
intended journeys.

Append one line to `docs/journeys/CHANGELOG.md`. **Read the whole file and write
it back with your line at the top** — opening it in write mode empties it before
the read, and it has been truncated that way before. Check the line count went UP
by exactly one afterwards.

---

## Blocked on Chris, not on code

These are content and config. Nothing below is a task Cursor can complete alone.

| # | What | Where it goes |
|---|---|---|
| 1 | Four job descriptions (closer, setter, sales coordinator, CSM) | `reviseBrief()` in `src/hiring/owner.mjs` — the ONLY write path for `role_brief` |
| 2 | Application questions — none exist anywhere in this repo | would feed `candidate_applications.answers` |
| 3 | A Zoho Recruit account, then `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` | Netlify env, `--secret` |
| 3a | **Zoho support ticket — the phone number on file is decommissioned.** Signup and account recovery both verify by SMS, so this blocks #3 and is worth opening before anything else. Give Zoho a working number. | zoho.com/recruit → Support |
| 4 | Scorecard targets and pay figures | `hiring_roles.scorecard` / `.comp` |
| 5 | Named hiring managers | `hiring_roles.hiring_manager_staff_id` |
| 6 | Take the careers page off `noindex` and link it | `public/careers.html` head |
| 7 | Candidate SMS consent wording | the funding wording does not transfer |
| 8 | Interview booking link per role | `hiring_roles.interview_booking_url` |

`SELECT * FROM v_hiring_config_gaps` lists 1, 4, 5 and 8 live at any time.

**#1 unblocks the most.** With briefs written, Zoho can post, the careers page
stops saying "No written description yet", and outreach has something to send.
