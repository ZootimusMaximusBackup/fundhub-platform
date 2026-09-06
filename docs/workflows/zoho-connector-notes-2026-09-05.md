# Zoho Recruit connector — what I found and what I built

**Lane:** Zoho connector. **Date:** 2026-09-05.
**Decision this implements:** [`hiring-ats-decision-2026-09-05.md`](hiring-ats-decision-2026-09-05.md) —
Zoho Recruit is the applicant tracking system and owns the LinkedIn bridge. FundHub owns
everything after the applicant arrives.

Everything below marked **CONFIRMED** was read on a `zoho.com` page on 2026-09-05, with the
URL given. Everything marked **UNVERIFIED** or **UNKNOWN** was not, and is flagged rather than
filled in with something plausible.

---

## 1. The plan answer — read this one first

### Buy nothing yet. Start on the **Free** plan.

Zoho Recruit's free edition gives us the two things the connector actually needs: the REST
API, and LinkedIn job syndication. It costs nothing and it works for a company hiring about
five people a year.

**But there is a catch that changes how the code had to be written, and a second catch that
the owner should know about before he counts on LinkedIn.**

### Catch one: one live job at a time

**CONFIRMED.** Free = *"1 active job/ recruiter license"* —
<https://www.zoho.com/recruit/pricing.html>

We have four open reqs after migration 294 (closer, setter, sales coordinator, client success
manager). Only one can be advertised at a time. So posting is a **queue**, not a broadcast.
The code refuses to post a second job and says why. It never quietly swaps the live one out —
somebody could be halfway through applying to it.

### Catch two: LinkedIn on the free plan is the weak version

This is the part worth reading twice, because it is the whole reason we chose Zoho.

There are **two different LinkedIn routes** and they are not the same product:

| | What you get | What it costs |
|---|---|---|
| **Limited Listings ("Basic")** | The job appears on LinkedIn, free | Included, no LinkedIn contract |
| **Premium Job Posting** | Analytics, applicant tracking, unpublish, sponsoring | Requires a **LinkedIn Recruiter contract with Job Slots**, bought from LinkedIn |

We get Limited Listings. Zoho's own help page is blunt about what that means, quoted directly:

> "The jobs that you post through LinkedIn Limited Listings cannot be managed from Zoho
> Recruit. You will not have access to job analytics, suggested matches, people who have
> viewed the job, or other features."

— <https://help.zoho.com/portal/en/kb/recruit/talent-sourcing/job-boards/linkedin-limited-listings/articles/linkedin>
(fetched 2026-09-05)

The same page says Limited Listings do not appear in LinkedIn's "Jobs You May Be Interested
In" recommendations and cannot be sponsored.

Premium is gated on **LinkedIn's** side, not Zoho's. Zoho's own prerequisites page says you
*"must have previously purchased LinkedIn Job Slots"* and holds a LinkedIn Recruiter contract,
and that *"If you have only purchased self-serve LinkedIn Job Posts, Premium Job Posting
cannot be enabled."*
(<https://help.zoho.com/portal/en/kb/recruit/talent-sourcing/job-boards/premium-job-boards/articles/integrating-with-linkedin-premium>)

**So: upgrading Zoho does not buy better LinkedIn.** Paying Zoho more gets more live jobs,
webhooks and workflow rules. It does not get Premium LinkedIn posting; only a LinkedIn
Recruiter contract does, and that is enterprise-priced for a company hiring five people a
year.

**This does not change the decision.** Free LinkedIn placement through Zoho is still more than
our own code can ever do. It does change the expectation: the job goes up, and we will not get
view counts or applicant analytics back from LinkedIn.

### One thing the free listing will silently punish us for

The same Limited Listings page lists why a post fails, and the failures are silent. Among
them: *"Missing mandatory fields like Company ID, Industry or Location."*

A job that posts fine to Zoho and never reaches LinkedIn is the worst outcome available,
because it looks like success. So **the connector refuses to post a job with no city and
country** rather than sending one that will be dropped. Same rule as the job description: post
what a human wrote, or refuse — never guess.

### If the owner later wants webhooks instead of polling

**CONFIRMED, and it is more expensive than expected.** Zoho Recruit sells two editions with
different plan ladders, and a company hiring for itself is on the **Corporate HR** edition,
which has **no Professional tier**:

| Corporate HR edition | Free | Standard | Enterprise |
|---|---|---|---|
| Price (billed annually, per user/month) | $0 | $25 | **$50** |
| Price (billed monthly) | $0 | $30 | **$60** |
| Active jobs | **1** | 10 | 20 |
| Webhooks | — | — | **yes** |
| Workflow rules | — | yes | yes |

Sources: <https://www.zoho.com/recruit/pricing.html> and
<https://www.zoho.com/recruit/corporate-plan-comparison.html> (both fetched 2026-09-05).

So webhooks mean **Enterprise, about $50 a month**, not the ~$50 Professional tier assumed in
the brief — Professional does not exist on this edition. **Polling is the right call** and this
is settled.

---

## 2. Webhooks or polling — settled: polling

**We poll. Every 15 minutes.**

Reason: webhooks require Enterprise on our edition (table above), and the free plan has no
workflow rules to attach one to. Both confirmed on the plan comparison page and the webhooks
help article
(<https://help.zoho.com/portal/en/kb/recruit/automation/workflow/webhooks/articles/zoho-recruit-webhooks>).

### What polling costs us, in real numbers

The brief asked for the worst-case daily call count. Here it is, and **it is not as
comfortable as it looked.**

Per poll the connector makes **2 calls**: one per-job applicant read, and one incremental
search. At 15-minute intervals that is 96 polls a day.

| Situation | Calls per poll | Calls per day (+24 token refreshes) |
|---|---|---|
| Normal — under 200 applicants on the live job | 2 | **216** |
| 400 applicants on the live job | 3 | **312** |
| 800 applicants on the live job | 5 | **504** |
| 1,600 applicants | 9 | **888** |

**The problem: Zoho's own pages disagree about the free-tier allowance.**

* The v2 developer docs say Free gets **5,000 API credits per rolling 24 hours** —
  <https://www.zoho.com/recruit/developer-guide/apiv2/limits.html>
* The Corporate HR plan comparison page says Free gets **500 API calls per day** —
  <https://www.zoho.com/recruit/corporate-plan-comparison.html>
* The older help-centre article agrees with the 500 figure —
  <https://help.zoho.com/portal/en/kb/recruit/developer-guide/api-limits/articles/api-limits>

**UNKNOWN — which is current.** My read is that the credit system is the newer one and the
comparison page is stale, but that is an inference, not a Zoho statement.

**So budget against 500 a day.** At 500, the normal case (216) is fine and stays fine until
the live job passes roughly 600 applicants, at which point a 15-minute poll breaches the
limit. That is not a near-term risk at five hires a year, but it is a real ceiling and it is
worth knowing where it is.

**The lever if we ever hit it:** the per-job read exists to answer "which req did this person
apply for" and to catch anyone who applied before our first sync. Once there is exactly one
live job and the cursor is established, the search read alone answers that. Dropping the
per-job read to hourly instead of every poll cuts the daily count by roughly half. Not built —
it is not needed yet and building for it now would be speculative.

Concurrency, separately: Free allows **5** concurrent calls
(same limits page). We make them one at a time, so this is not a constraint.

---

## 3. The API facts the code is built on

### Base URLs and the data-centre trap — CONFIRMED

Zoho runs the same product in several regions and **a token from one region is meaningless in
another. It fails silently.** <https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html>

| Region | API host | Accounts host |
|---|---|---|
| US | `https://www.zohoapis.com` | `https://accounts.zoho.com` |
| EU | `https://www.zohoapis.eu` | `https://accounts.zoho.eu` |
| CN | `https://www.zohoapis.com.cn` | `https://accounts.zoho.com.cn` |
| AU | *not listed on that page* | `https://accounts.zoho.com.au` |
| IN | *not listed on that page* | `https://accounts.zoho.in` |
| JP | *not listed on that page* | `https://accounts.zoho.jp` |

**UNVERIFIED:** the AU, IN and JP **API** hosts. The multi-DC page names their accounts hosts
but not their API hosts. The code assumes the obvious pattern (`zohoapis.com.au`,
`zohoapis.in`, `zohoapis.jp`). We are a US account, so this does not bite us — and rather than
guess quietly, an unrecognised region **throws a named error** instead of falling back.

The right answer is not to guess at all: **the OAuth token response returns an `api_domain`
field, and the code stores it verbatim** on the connection row. That is the documented way to
know the region.

**API version: v2.** Path is `/recruit/v2/`.

### OAuth — CONFIRMED

<https://www.zoho.com/recruit/developer-guide/apiv2/oauth-overview.html>

Scopes needed:

```
ZohoRecruit.modules.candidates.READ      read candidates
ZohoRecruit.modules.jobopenings.ALL      read AND create job openings
ZohoRecruit.search.READ                  the incremental search endpoint
ZohoRecruit.modules.attachments.READ     resumes (not used yet — see section 6)
```

* **Access tokens last one hour.**
* **Refresh tokens do not expire** — quoting the page, they have *"an unlimited lifetime until
  it is revoked by the end-user."* So the refresh token is the durable credential; losing it
  means a human has to re-authorise.
* Auth header format is `Authorization: Zoho-oauthtoken <token>`, not `Bearer`.

**Trap the code handles:** Zoho's token endpoint answers **HTTP 200 with `{"error": "..."}`**
on failure. Checking only the status code stores a broken token and every later call fails
with no clue why.

**UNKNOWN:** whether the Free edition can create an OAuth client in Zoho's API Console. No
Zoho page addresses this directly. The free row appearing in the API limit tables is strong
evidence it can, but that is inference. **This is the first thing to test with a real
account** — if it cannot, the whole free-tier plan collapses.

### Reading candidates — CONFIRMED

<https://www.zoho.com/recruit/developer-guide/apiv2/search-records.html>

```
GET /recruit/v2/Candidates/search?criteria=(Created_Time:greater_equal:<ISO8601>)
```

* `per_page` maximum is **200**, default 200.
* Pagination is `page=N`, and **`info.more_records`** is the flag that says keep going.
* Comparators confirmed: `equals`, `starts_with`, `greater_equal`, `greater_than`,
  `less_equal`, `less_than`, `between`, `in`, `contains`, `not_contains`, `ends_with`,
  `not_equal`. Maximum 10 criteria per request.

Per-job alternative, used to tie an applicant to a specific req:

```
GET /recruit/v2/Job_Openings/{job_id}/associate
```

**UNVERIFIED — the module spelling in that path.** The create/update endpoints use
`Job_Openings` (with the underscore). Zoho's associated-records page renders the same module
as `JobOpenings` (no underscore) in its example URL. One of the two is a documentation error
and there is no way to tell which without a live account. It is an env-overridable constant
(`ZOHO_ASSOCIATE_MODULE`) so that when the first real call returns "not found", it is one line
to change and no code hunt.

### Posting a job — mostly UNVERIFIED

<https://www.zoho.com/recruit/developer-guide/apiv2/insert-records.html> **CONFIRMS**:

* `POST /recruit/v2/Job_Openings`
* The body **must** be wrapped in a `"data"` array. Up to 100 records per call.
* Success comes back as `data[0].details.id`.
* Per-record failures arrive **inside a 200 response**, so the absence of an id must be
  treated as a failure. The code does.

**UNVERIFIED:** the field names themselves. Zoho's insert-records page documents the envelope
but not the Job_Openings field list, and **no official page documents a `Publish` flag**. The
field names (`Job_Title`, `Job_Description`, `Job_Status`, `Publish`, `City`, `State`,
`Country`, `Zip_Code`, `Salary`, `Work_Experience`) and the status values (`In-progress`,
`Closed`) come from the owner-supplied v2 spec of 2026-09-05, not from Zoho's docs. They are
named constants at the top of `src/hiring/zoho.mjs` so a rename is a single edit.

**The one that matters:** if `Publish` or `Job_Status` is wrong, the job posts to Zoho and
never syndicates to LinkedIn — and nothing errors. **Check the first real posting appears on
LinkedIn before trusting this path.**

### Attachments / resumes — CONFIRMED but NOT BUILT

Two-step, and both endpoints exist:

```
GET /recruit/v2/Candidates/{id}/Attachments                  → list, with File_Name and Size
GET /recruit/v2/Candidates/{id}/Attachments/{attachment_id}  → the file itself
```

<https://www.zoho.com/recruit/developer-guide/apiv2/get-attachments.html> and
<https://www.zoho.com/recruit/developer-guide/apiv2/download-attachments.html>

Candidate records carry an `Is_Attachment_Present` boolean.

**Not built, deliberately.** Pulling a resume means storing a file, which means a `documents`
row, a storage decision and a retention rule — none of which were in this lane's scope, and
`candidate_applications.resume_document_id` is left null rather than half-wired. Each resume
also costs 2 extra API calls per candidate, which matters against the 500-a-day reading.
**This is a named gap, not an oversight.**

### Record limits on Free — CONFIRMED

5,000 records across all modules, 1,000 per module
(<https://www.zoho.com/recruit/corporate-plan-comparison.html>). At five hires a year this is
not a constraint for many years.

---

## 4. What I built

| File | What it is |
|---|---|
| `db/migrations/298_zoho_recruit.sql` | Schema. Widens three CHECKs, adds four columns, one new table, two views. |
| `src/hiring/zoho.mjs` | The connector. |
| `src/hiring/zoho.test.mjs` | 33 tests. No network, no database. |
| `src/hiring/zoho.pg.test.mjs` | 23 tests against a real Postgres, with a fake Zoho. |

### Schema — reuse, not new tables

`hiring_channel_connections` (from 051) already **is** an OAuth connection row, so Zoho uses
it. Its `channel` CHECK was widened to allow `'zoho'`, as was `hiring_job_postings.channel` and
`candidates.source`. Four columns were added to the connection row: `api_domain`,
`sync_cursor`, `last_synced_at`, `max_active_postings`.

`max_active_postings` **defaults to 1 because that is the free-tier limit** — it is a column
rather than a constant in the code so that upgrading a plan is one `UPDATE`, not a migration
and a deploy.

One genuinely new table, `hiring_zoho_candidate_links`, which maps a Zoho candidate id to our
candidate and application. It exists for three things the unique index on
`external_application_id` cannot do:

1. **Record the applicants we could NOT ingest** and why. A Zoho record with no email cannot
   become a candidate. Dropping it silently makes a mapping bug look exactly like "nobody
   applied" — invisible for weeks. Those get a row with `status='skipped'` and a reason.
2. **Count the protected fields that were refused** on the way in, so a Zoho form that starts
   collecting date-of-birth is visible in the data rather than only in a log.
3. Answer "how far have we got" without reading logs.

Two views: `v_zoho_posting_queue` ("1 live, 3 waiting", in words) and
`v_zoho_connector_health`.

### The hard rules, and where each is enforced

* **Every applicant goes through the existing `apply()`** in `src/hiring/pipeline.mjs`. Nothing
  in this connector inserts into `candidates` or `candidate_applications`. A second front door
  would be unaudited, which is what 051 was written to prevent.
* **No candidate is ever rejected, scored, ranked or advanced by this code.** There is a test
  that asserts a synced applicant sits in `applied` with zero decisions and zero scores, even
  when Zoho's own record says `Candidate_Status: "Rejected"`.
* **Zoho's `Candidate_Status` is deliberately NOT imported.** It is Zoho's pipeline state, and
  copying it would let an outside system move a person through our stages with no human in the
  loop.
* **Protected characteristics are dropped twice** — once here against the same deny-list the
  grader uses (`src/hiring/grading.mjs`), and again inside `apply()` — **and counted both
  times.** Counted even when the value is blank: "we dropped nothing because it was empty
  today" is a different finding from "the form does not ask".
* **Every outbound call goes through `ctx.fetch`.** The tests need no network.
* **No token, no email address and no full candidate record ever reaches an error string.**
  The scrubber removes the token by value, the `Zoho-oauthtoken` pattern, Zoho's `1000.xxx`
  token shape, and any email address.
* **No money appears anywhere in this connector**, so the integer-cents rule has nothing to
  bite on. Salary is passed through as a string to Zoho or omitted; it is never stored by us.

### The four ways a connector like this silently loses people

Each has a guard and a test:

1. **Pagination.** `info.more_records` is followed to the end. Hitting the 25-page ceiling sets
   `truncated` and **blocks the cursor from advancing** rather than returning a short list that
   looks complete.
2. **Timezone.** Every timestamp is UTC with an explicit offset. Arizona is `America/Phoenix`
   and does not change its clocks (see
   [`arizona-time-2026-08-28.md`](arizona-time-2026-08-28.md)), so `-07:00` is right all year —
   but the code never relies on that, because a bare local time shifts the window by hours with
   no error.
3. **Cursor overlap.** The poll deliberately re-reads **5 minutes before** the stored cursor
   and leans on the id map. Duplicates are free; gaps are invisible. **The cursor advances only
   after every page is processed, and only on a clean run** — a failed read leaves it where it
   was.
4. **Idempotency.** Zoho's `id` is the key, carried into `external_application_id` as
   `zoho:<id>:<role>` and guarded by a unique index. The role is appended because one person
   may legitimately apply for two reqs, and keying on the Zoho id alone would let the first
   application permanently block the second.

### One design decision worth naming: the poll reads twice

It unions the per-job list with the incremental search. That is not redundancy:

* The **per-job read** knows which req a person applied for, and has no "since", so it catches
  anyone who applied **before our first ever sync** — a cold-start gap a cursor-only design
  loses permanently and silently.
* The **search read** is incremental and cheap, and catches somebody in Zoho who is not
  attached to one of our postings.

Idempotency is what makes the overlap free.

---

## 5. Open questions for the owner

1. **When the live job closes, does the next queued req go up automatically, or does a human
   choose?** I built the queue and left promotion behind an explicit call. Automatic promotion
   could pull a live advert out from under someone mid-application, so this is a decision, not
   a default. **Nothing promotes anything today.**
2. **Do we want resumes pulled across?** See section 6. It costs 2 API calls per candidate and
   needs a storage and retention decision.

## 6. What is NOT built — read this before calling the connector done

* **There is no OAuth callback endpoint.** Nothing creates the connection row. Until somebody
  builds the "connect Zoho" flow, this connector has no credentials and cannot run. **This is
  the single biggest blocker** and it is outside this lane's file list.
* **Nothing is scheduled.** No cron, no route. See section 7.
* **Resumes are not pulled.** `resume_document_id` stays null.
* **No screen.** Nothing renders the queue or the health view.
* **An applicant whose req cannot be worked out is reported but not stored.** The id map row
  requires a requisition, so a Zoho candidate attached to none of our live jobs is counted in
  the run summary as skipped (`ambiguous_role` or `no_live_posting`) but leaves no row behind.
  This cannot happen on the free tier, where there is only ever one live job and the role is
  therefore unambiguous. It becomes real the day we run two jobs at once, and the fix is
  another migration, not a code change.
* **Not one call has been made against a real Zoho account.** Every endpoint here is built
  from documentation and a supplied spec. The field names for job posting are the least
  verified part and the most likely to need one edit.

## 7. What the other lanes need to add — exact lines

I did not edit `netlify/functions/api.mjs` or `src/workflows/index.mjs`; another lane owns
both.

**Cron registration** — `src/workflows/index.mjs`, alongside the other sweepers:

```js
// Zoho Recruit applicant poll. 15 minutes because Zoho's free tier has no
// webhooks (Enterprise only), so this is the only way applicants arrive.
// Budget: 2 API calls per run, ~216/day including token refreshes.
{ id: "zoho-candidate-sweeper", cron: "*/15 * * * *" }
```

The workflow body calls `syncCandidates(tx, { orgId })` from `src/hiring/zoho.mjs` per org
with an active `'zoho'` connection. It is safe to run at any interval, from any number of
sessions, in any order.

**Routes:** none needed yet — I built no `api/` handler, so there is nothing to route. When
the OAuth callback is built it will need a `ROUTES` entry; that lane should add it in the same
commit as the handler, per the "a handler file is not a route" trap in `CLAUDE.md` §12.

**Environment variables** the connector reads:

| Name | Purpose | Secret |
|---|---|---|
| `ZOHO_CLIENT_ID` | OAuth client from Zoho's API Console | yes |
| `ZOHO_CLIENT_SECRET` | OAuth client secret | yes |
| `ZOHO_ACCOUNTS_DOMAIN` | Optional override of the region's accounts host | no |
| `ZOHO_ASSOCIATE_MODULE` | Optional override for the `Job_Openings` vs `JobOpenings` ambiguity | no |
| `AD_TOKEN_ENC_KEY` | Already set — reused for token encryption at rest | yes |

**One more thing:** `db/expected-migrations.mjs` has **not** been regenerated for 298 (another
lane owns it, and `npm run migrations:manifest` is off-limits to me). No test compares the
manifest against the filesystem, so nothing is red — but `/api/health` will not count 298 until
somebody regenerates it.

---

## 8. Test results

| Command | Result |
|---|---|
| `npm run lint` | pass — 1,801 files parse clean |
| `node --test src/hiring/zoho.test.mjs` | **33 pass, 0 fail, 0 skip** |
| `DATABASE_URL=... node --test --test-concurrency=1 src/hiring/zoho.pg.test.mjs` | **23 pass, 0 fail, 0 skip** |

Database: `fh_lane_zoho`, a scratch database on local Postgres 16 created for this lane, with
all 246 migrations applied to it empty.
