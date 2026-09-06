# Lane: public careers page + apply endpoint — 2026-09-05

Status: **done**, with four named gaps that are absences, not work skipped.

Written to its own file rather than the shared hiring board because other sessions
were editing that board while this lane ran. Also added: one line at the top of
`docs/journeys/CHANGELOG.md`, an appended addendum on
`docs/journeys/hiring-actual.md`, and the nine regenerated journey pages.

---

## What this lane built, in plain language

Before today there was **no way for a person to apply for a job here.** The hiring
database has been in place since migration 051 — candidates, applications, stages,
the scoring rubric, the human-decision gate — and the only thing that ever put a
row into it was a LinkedIn importer that is switched off. `api/hiring/application`
sounds like an application form and is not: it is a review screen for staff.

So now there is:

* **A careers page** at `/careers.html`. It lists the roles that are open, and has
  one form to apply for one of them.
* **A public door** at `/api/hiring/apply`. `GET` hands the page the list of open
  roles. `POST` takes one application and files it in the `applied` stage.

An application lands exactly where a staff member already looks for it — the
hiring board at `public/app/` reading `/api/hiring/candidates`. Nothing new was
added to the CRM.

---

## Files

| File | New? | What it is |
|---|---|---|
| `public/careers.html` | new | The page. Role list, the form, and all four screen states. |
| `api/hiring/apply.mjs` | new | The endpoint. GET = the role list, POST = one application. |
| `src/hiring/apply-public.mjs` | new | Validation, rate limiting, spam handling, the write. |
| `src/hiring/apply-public.pg.test.mjs` | new | 36 tests. 20 need no database and run on every CI pass. |
| `netlify/functions/api.mjs` | edited | Two lines: the import and the `"hiring/apply"` route. |

No migration. No new dependency. No change to `src/hiring/pipeline.mjs`,
`grading.mjs`, `owner.mjs` or `bench.mjs` — this lane calls them and does not
touch them.

---

## The rules this had to hold, and how

**No candidate is ever rejected by software.** Nothing in this lane scores,
advances, or closes an application. A refused *submission* writes no row at all,
which is a request that was not accepted — not an adverse action against a
person. A test reads the data back and asserts every application this path
created is still `open` with zero decision rows behind it.

**No protected characteristic is collected.** The form does not ask for age, date
of birth, gender, race or anything of that class, and the endpoint **refuses**
a request that carries one rather than quietly dropping it. Our own page never
sends those keys, so a request that does is something trying to feed an automated
employment decision tool.

**Nothing is invented.** The role names come from the database. The description
under each role is `hiring_roles.role_brief`, which a human writes and which is
empty for every role today — so the page says "no written description yet"
instead of generating one. No comp figure, no scorecard, no invented interview
question appears anywhere.

**It is treated as hostile input.** Every field is length-capped. Prose is
truncated; an email address, a role key or a link is **refused** when it is too
long, because a truncated address is a different, wrong address that we would
store and never be able to reach. Control characters are stripped. A URL in the
name field is refused. There is a honeypot field and no CAPTCHA.

**It cannot be used to check whether an address is known.** A new applicant, a
returning one, somebody who already has an open application, and a bot caught by
the honeypot all get the identical reply: `{ ok: true, received: true }`.

---

## Rate limiting — what holds and what does not

| Limit | Where it lives | Holds across restarts? |
|---|---|---|
| 5 applications per address per 24h | counted from real rows | **yes** |
| 30 applications org-wide per 5 min | counted from real rows | **yes** |
| 5 per source address per 10 min | in memory, this process | **no** |
| 20 per source address per hour | in memory, this process | **no** |

The per-source limits reset when the function goes cold and are not shared
between instances. That is a real limitation, stated plainly: a durable one needs
a table to record attempts that were *refused*, and no such table exists. Adding
one is a migration this lane did not own.

---

## Gaps — absences found, not work skipped

1. **There are no application questions.** Migration 051 scores six things —
   effort, honesty, income-goal fit, relevant experience, sales inputs, work
   history — and the questions that produce those answers live in documents that
   are not in this repository. Writing them would mean inventing screening
   criteria real people are judged against. So an application today carries a
   name, an address, an optional phone and LinkedIn link, and how they heard
   about us. **A reviewer opening one has very little to read.**

2. **No job descriptions exist.** `hiring_roles.role_brief` is empty for all four
   roles. The page is `noindex` for that reason — one line in the `<head>`, and
   deleting it is the whole switch once the briefs are written.

3. **Nothing tells a human an application arrived.** It sits in the `applied`
   stage until somebody opens the hiring board. No task, no email. The routing
   resolver for a "new application" task already exists (`assigneeFor` in
   `src/hiring/owner.mjs`); wiring one was outside this lane and is deliberately
   not half-done.

4. **The voluntary EEO self-ID survey is built in the database and has no code.**
   Migration 053 builds the whole thing — invite tokens, the write that destroys
   the link between a person and their answers, the aggregate view that suppresses
   small groups — and **nothing anywhere reads or writes those tables.** Its
   design requires the survey to be a separate submission from the application, so
   it cannot be bolted onto this form. Until the invite path is built, the
   adverse-impact analysis 053 exists to enable has no data.

---

## Documentation — done, not handed off

* **`docs/journeys/hiring-actual.md`** — a dated addendum was **appended** to the
  end rather than woven into another session's prose. It closes that page's
  finding 5 ("`apply()` has no live caller" — it does now), corrects the one
  diagram note that went stale, and says plainly which of its other findings this
  lane did **not** touch.
* **`docs/journeys/CHANGELOG.md`** — one line at the top, appended without
  rewriting anything below it. Line count checked before and after: 292 → 293.
* **The eight generated role pages and `README.md`** — regenerated with
  `npm run journeys`. Adding one route moved the platform from 217 to 218 routes,
  which is what made `scripts/journeys/generate.test.mjs` red. It is green again.

  This was checked, not assumed: the generated pages were confirmed **clean** at
  the last commit before this lane's route was added, so the drift was entirely
  this lane's and regenerating swept in nothing belonging to anybody else.

**Compatibility note:** migration `298_zoho_recruit.sql` (another lane, in flight)
widens `candidates_source_ck` with a `zoho` value. This lane only ever writes
values from the original list, so the two do not collide either way round.
