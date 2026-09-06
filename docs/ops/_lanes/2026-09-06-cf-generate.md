# Creative Factory - can it actually make a creative today?

Read-only lane. Nothing in the repo was changed except this file.
Date: 2026-09-06. Branch in the shared checkout: `feat/csm-role-schema`.
Everything below was read out of the code. No database was touched.

---

## The one-line answer

**On the Creative Factory screen: no. Nothing comes out.** The button works and
the queue works. But no vendor is switched on anywhere in this repo, so the job
fails and the screen says so. And the clock that is supposed to pick jobs up on
its own picks up nothing — see Task 2. Chris has to press "Run queued jobs now"
himself, and even then the job fails.

**On a different screen — Brand Studio — something does come out.** Two buttons
there make real things today, with no vendor row needed:

* **"Generate copy"** writes real words with a real AI service and saves them to
  the page.
* **"Generate logo"** makes a simple text-only logo picture and saves it.

Both are behind the same owner switch (the marketing suite). Details in Task 3.
So "nothing comes out" is true of Creative Factory only. It is not true of this
repo as a whole.

And even if a Creative Factory vendor were switched on, four more things would
stop Chris getting a finished ad. All four are proven below.

---

## TASK 1 - the whole chain, step by step

Numbered in the order it happens when Chris presses the button.

### 1. The button on the screen - PROVEN, it works

File: `public/app/creative-factory.html`, line 443.
It is labelled **"Enqueue generation"**, not "Generate". Next to it is a second
button, **"Run queued jobs now"** (line 444).

Both buttons start switched off (`disabled`). They only switch on when two things
are true (line 996, `canWriteCreative`):

* a partner is picked on the screen, and
* the **marketing suite is switched on for that partner**.

The suite is off by default. `db/migrations/172_wl_marketing.sql` line 8 sets the
column to `false` for everybody. The switch that turns it on lives on a
**different screen** - Brand Studio (`public/app/brand-studio.html` line 1093,
which calls `/api/partner-marketing/enable`). Owner only.

**So the very first thing Chris sees may be two grey buttons he cannot press.**
The screen does tell him why (line 1132: "The owner has not turned this on for
this partner"), but the fix is on another page and the screen does not say that.

### 2. The click handler - PROVEN

`public/app/creative-factory.html` line 2274. It sends a POST to
`/api/creative/generate` with the kind, the words typed in "What to make", and
the batch name.

The batch name is required. No name, no request (line 2296).

### 2a. One of the four "Kind" choices can never work - **BROKEN**

The Kind dropdown offers four choices: **static, copy, video, resize**
(`public/app/creative-factory.html` line 437).

**"resize" can never succeed, even after a vendor is switched on.**

Resize means "take a picture we already made and make it in another shape". So
the code demands to be told *which* existing picture (`src/creative/providers/
resize.mjs` line 27):

```
if (!parent?.id) throw new Error("resize requires a parentAsset with an id");
```

But the form never asks which picture, and the request it sends contains only
`prompt`, `formats`, `variants` and `assetKind`
(`creative-factory.html` lines 2310-2316). There is no place on the form to pick
a parent picture at all.

So picking "resize" always fails. And it fails badly: the error is not marked
"do not bother retrying", so `src/creative/generate.mjs` lines 163-178 tries it
**three times, with a pause between each**, before giving up.

This is the same shape of problem as the offer-type one in Task 4 — a form that
does not send what the code behind it requires — on the same form, and the first
version of this lane missed it.

### 3. The route - PROVEN

`netlify/functions/api.mjs` line 705 maps `creative/generate` to
`api/creative/generate.mjs`. This matters because CLAUDE.md section 12 warns a
handler file that is missing from that map returns "not found". This one is in
the map. So are `creative/run`, `creative/actions`, `creative/jobs`,
`creative/library`, `creative/approvals`, `creative/brand-kits`.

### 4. The endpoint - PROVEN

`api/creative/generate.mjs`. It checks who is asking, checks the marketing suite
again on the server, then calls `enqueue()`.

### 5. The job row - PROVEN

`src/creative/generate.mjs`, function `enqueue()` (line 42). It writes one row to
the `generation_jobs` table with status `queued`.

Then, **before it answers**, the endpoint asks whether any vendor exists that
could run this job (`checkProvider`, line 47). The answer it gives Chris is
honest. On a system with no vendor set up he sees, word for word:

> "Saved to the queue, but it cannot run yet: no ad-making service is switched on
> for this account. The next try will be recorded as a failure and nothing will
> be made."

That is good. It is also the end of the road today.

### 6. Who picks the job up - **BROKEN. The clock ticks and never sees any work.**

**This was wrong in the first version of this lane, which said the clock was
proven and simply had nothing to do. It is not proven. It cannot see the queue.**

`netlify/functions/creative-job-runner.mjs` runs every two minutes and calls
`runDue()` in `src/creative/runner.mjs`.

The very first thing `runDue()` does is ask the database: which accounts have
work waiting? (`src/creative/runner.mjs` lines 11-21.)

That question is asked on a plain, unlabelled database connection. The database
has a lock on the `generation_jobs` table: a connection only sees rows if it has
first said *"I am partner X"* or *"I am staff"*. Nothing says either here. The
lock is set to FORCE, which means even the table's own owner is not let past it
(`db/migrations/045_creative_factory.sql` lines 59-72, switched on for
`generation_jobs` at lines 355-364; the two checks it uses are defined at lines
41-50 and both come back empty when nothing was said).

**So the answer comes back empty. Zero accounts. Zero jobs. Every two minutes,
forever, and it reports success while doing nothing.** The runner does not even
write a log line when it finds nothing (`creative-job-runner.mjs` only logs when
`ran > 0`).

The very next call in the same file *does* say who it is
(`runner.mjs` line 25, `withPartnerScope`). So this is one query that was
missed, not a decision.

**What this means for Chris:** the promise printed on his own screen -
*"Work you add here waits in a queue and is picked up on its own every couple of
minutes"* (`public/app/creative-factory.html` lines 427-428) - **is not kept.**
Work sits in the queue until he personally presses "Run queued jobs now".

The staff "run it for every account" path has the same fault
(`api/creative/run.mjs` line 56 calls the same `runDue`). It does nothing and
reports success.

**The one thing that could make this wrong.** This holds only if the live
database login is an ordinary one. A superuser login walks past every lock and
the clock would work fine. Migration `db/migrations/104_app_role.sql` exists to
make the app log in as the ordinary `fundhub_app`, and the repo has a guard test
for it (`src/security/superuser-guard.test.mjs`, run by `npm run guard:db`). But
that test proves what the repo intends, not what production is doing right now.

**UNVERIFIED:** which login production actually uses. What settles it:
`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;`
run on a scratch copy of the database, never production. **Note: reading
`/api/health` will not settle it** - I checked, and health only reports whether
the database is up and which migrations are applied
(`src/http/health.mjs` lines 124-155). It says nothing about the login. This
lane connected to no database at all.

The "Run queued jobs now" button, pressed by hand for one account, is not
affected - that path says who it is properly (`api/creative/run.mjs` line 68).

### 7. Picking the vendor - **MISSING**

`src/creative/providers/index.mjs` line 46. It reads a table called
`creative_providers` and looks for an active row for the kind asked for.

**There is no such row anywhere in this repository.** I checked every migration
file and every seed file. The table is created in
`db/migrations/048_campaign_config.sql` line 40. Nothing ever puts a row in it.
The only inserts are inside test files (`src/creative/generate.pg.test.mjs`
line 50).

There is also **no screen and no endpoint that can add one**. I searched all of
`api/`, `src/`, and `public/app/`. Nothing writes to that table.

So today: the lookup finds nothing, throws, and `run()` marks the job
**failed on purpose, with no retry** (`src/creative/generate.mjs` line 157 -
"No provider configured is a permanent failure, not an outage").

**What Chris sees:** press "Run queued jobs now" and the line next to the button
reads *"Tried 1 job: 0 worked, 1 did not. No ad-making service is switched on for
this account, so there is nothing to make the work."*

That one sentence is built in **two different files**, and a fixer needs both:

| Half of the sentence | Where it is written |
|---|---|
| *"Tried 1 job: 0 worked, 1 did not."* | `public/app/creative-factory.html` lines 2371-2377 |
| *"It did not work, and nothing was made."* + *"No ad-making service is switched on for this account, so there is nothing to make the work."* | `api/creative/run.mjs` lines 88-97, using `plainReason` at lines 21-36 |

(An earlier version of this lane put the whole sentence at `api/creative/run.mjs`
line 22. That was wrong and would have sent a fixer to the wrong file.)

The same plain wording appears on the job row in the list below, through
`plainJobError` at `creative-factory.html` line 1319. The wording is deliberate
and good. What is missing is any way for him to fix the cause — but see Task 5,
because the screen does at least tell him a vendor is not set.

### 8. Calling the vendor - PROVEN as code, **UNPROVEN as a real service**

If a row existed, the code in `src/creative/providers/` would run. See Task 3.
Every one of the four image/video adapters points at a **made-up web address**
unless the database row overrides it.

### 9. Storing the finished file - **MISSING for pictures, HIDDEN for words**

This is the finding nobody has written down yet. The heading used to say plain
"MISSING" for both; that was too strong for the written copy, and the exact
difference is spelled out below.

`src/creative/generate.mjs` function `storeAsset` (line 205) writes a row to
`creative_assets`. Look at what it writes and what it throws away:

* The vendor hands back `sourceUrl` - the web address of the finished picture.
  **`storeAsset` never saves it.** And the table has no column for it. I read
  every column in `db/migrations/045_creative_factory.sql` lines 163-220, and
  checked that no later migration ever adds one (`grep "ALTER TABLE
  creative_assets"` returns nothing).
* The vendor hands back `text` for written copy. **This one is narrower than the
  first version of this lane said, and the correction matters.** The words *are*
  written to the database — `src/creative/generate.mjs` lines 271-276 saves them
  into `compliance_screenings.screened_text`, cut off at 8,000 characters. But
  that is the safety-check audit record, not the creative itself. There is **no
  column for the words on `creative_assets`**, **no endpoint hands them back**
  (`api/creative/library.mjs` lines 36-49 selects neither), and **no screen shows
  them**. The comment at line 296 says "copy lives in the row, not object
  storage" - but there is no row field on the asset to live in.

  In plain words: **the words survive only in the safety audit trail. They are
  not on the creative and they are not on any screen Chris can open.** Getting
  them back would mean somebody reading the audit table by hand in SQL.
* `storage_key` is filled in with a made-up file path like
  `partners/<id>/creative/1x1/abc.png`. **Nothing ever puts a file there.** There
  is no upload call anywhere in `src/creative/` - no object store, no `put`, no
  `upload`.

The screen is honest about the result. `creative-factory.html` line 1985 draws an
empty grey box labelled **"no preview available"** and prints:

> "The file itself is never sent to this screen, so no preview can be shown and
> this screen cannot even tell whether a file was saved. This is written copy, so
> there is no file at all - and the words themselves are not sent here either."

The library endpoint confirms it: `api/creative/library.mjs` line 40 returns only
`(a.storage_key IS NOT NULL) AS has_storage_key`. A yes/no. Not a picture, not a
link, not the words.

**So even a perfectly working vendor produces a row in a list that Chris cannot
look at, cannot read, cannot download and cannot paste into an ad account.**

### 10. The compliance check - PROVEN it runs, and PROVEN it blocks everything

See Task 4. Short version: it runs on every asset, and today it stops every
single one for a reason that is not the asset's fault.

### Chain summary

| # | Step | Verdict |
|---|---|---|
| 1-5 | Button, endpoint, job row | PROVEN - all work |
| 2a | The "resize" choice on the form | **BROKEN - can never work, and burns 3 tries first** |
| 6 | The clock that is meant to pick jobs up on its own | **BROKEN - it cannot see the queue, and reports success** |
| 7 | A vendor to actually make the thing | **MISSING - nothing, nowhere** |
| 8 | The vendor adapters themselves | Real code, fake web addresses |
| 9 | Saving the finished picture or words | Picture address **thrown away**; words survive only in the safety audit row, on no screen |
| 10 | The compliance check | Runs, and blocks 100% of assets today |

---

## TASK 2 - who runs the job

**The short answer: nobody, automatically.** The clock exists, it is real, and it
runs on time. But it cannot see the queue, so it does nothing and says it went
fine. Only Chris pressing the button gets a job to run.

**It is not an Inngest workflow.** I searched `src/workflows/index.mjs` for
"creative". No match. There is no creative workflow registered there at all.

It is a **Netlify scheduled function**:

* File: `netlify/functions/creative-job-runner.mjs`
* Schedule: `netlify.toml` line 126-127, `*/2 * * * *` - **every two minutes**
* A test keeps the two in step: `src/creative/runner-cron.test.mjs` fails if the
  schedule in `netlify.toml` stops matching the constant in the file.

**What it is meant to do when it wakes up** (`src/creative/runner.mjs`):

1. Find up to 25 partners who have at least one job waiting.
2. For each partner, run up to 3 jobs.
3. For each job: look up the vendor, call it (up to 3 tries with a pause between),
   save what comes back, screen it.
4. Log a one-line count. Nothing is emailed and nothing appears as an alert.

Two guards worth knowing: a partner cannot run more than 3 jobs at once
(`max_concurrent_jobs`, default 3), and a job that fails for a reason that might
clear up goes back in the queue rather than being marked failed - up to 3 tries.
A missing vendor is not one of those; it fails straight away.

### What actually happens - the correction

**Step 1 never returns anything.** The full proof is in chain step 6 above. In
short: that first question is asked on a database connection that has not said
who it is, and the `generation_jobs` table refuses to show rows to a connection
that has not said who it is. So the list of partners comes back empty, steps 2
to 4 never run, and step 4's log line is skipped entirely because the runner only
logs when it ran something.

Both ways in have the same fault:

| Way in | Result |
|---|---|
| The every-two-minutes clock (`creative-job-runner.mjs`) | Sees nothing. Runs nothing. Reports success. |
| Staff "run it for every account" (`api/creative/run.mjs` line 56, `all=1`) | Same. Sees nothing, reports success. |
| Chris pressing "Run queued jobs now" for one account (`api/creative/run.mjs` line 68) | **Works.** This path says who it is first. |

**In Chris's words:** the clock is real and it ticks, but it is looking at a
locked cupboard and reporting that the cupboard is empty. Work he adds will sit
there until he presses the button himself.

### Nothing tests this, which is why it was never caught

The lane's original line — that a test keeps the schedule honest — is true, but
that test is **all** there is, and it does not test the runner. It reads the
schedule string out of `netlify.toml` and compares it to the same string in the
code. That is the whole file (`src/creative/runner-cron.test.mjs`, 16 lines).

**There is no test anywhere for `runDue` itself** — the function that claims and
runs jobs. `grep -rn "runDue" src/ api/ netlify/` returns only the definition and
three places that call it. No test file appears. That is exactly why a query that
returns nothing has been sitting there unnoticed.

---

## TASK 3 - the vendors

Five adapter files in `src/creative/providers/`. One outside file matters too.

### The four that make pictures and video

All four are **real, complete code** - they build a request, send it, read the
answer, and refuse to pretend an empty answer was a success. They are not stubs.

But every single one of them has a **fake web address** written in as the default:

* `static.mjs` line 35 - `https://api.example-image-provider.com/v1/images`
* `ugc-video.mjs` line 30 - `https://api.example-ugc-provider.com/v1/videos`
* `product-video.mjs` line 28 - `https://api.example-product-video.com/v1/render`
* `resize.mjs` line 36 - `https://api.example-resize.com/v1/derive`

`example-image-provider.com` is not a company. The address is only overridden by
an `endpoint` value inside the `creative_providers` database row - the row that
does not exist.

Each file also carries this warning at the top, written by whoever built it:

> "CONFIRM BEFORE THIS RUNS LIVE. The request/response shape below is the common
> one for hosted image APIs, but it has not been proven against a real account."

**So: real plumbing, no vendor chosen, no address, and the shape of the request
has never been checked against a real company.**

### The one that writes words - this one is real

`src/creative/providers/copy.mjs`. It calls `src/agents/model.mjs`, which is a
genuine, working connection to OpenAI (first choice) or Anthropic (fallback).
Real addresses: `api.openai.com` and `api.anthropic.com`. This one would work.

**Except for a bug.** `copy.mjs` line 27 refuses to run unless
`ANTHROPIC_API_KEY` is set:

```
if (!env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is not set — the copy provider cannot run.");
}
```

But `model.mjs` prefers **OpenAI** when an OpenAI key is present (owner decision,
2026-08-25, written in the file header). So a machine set up with **only** an
OpenAI key would be turned away by a check for a key it does not need.

**That is a real bug in the code, and it is true no matter what any machine has
set.** Whether it actually bites depends on which keys production holds, which is
UNVERIFIED - see the table below for the exact check. The first version of this
lane said "on this laptop both keys are set, so it would pass here"; that was an
unbacked claim and has been removed. The bug itself stands on the code alone.

### Key names (names only, never values)

| Adapter | Env var it needs | In `.env.example`? |
|---|---|---|
| static images | `CREATIVE_STATIC_API_KEY` | yes, line 73 |
| ugc video | `CREATIVE_UGC_API_KEY` | yes, line 74 |
| product video | `CREATIVE_PRODUCT_VIDEO_API_KEY` | yes, line 75 |
| resize | `CREATIVE_RESIZE_API_KEY` | yes, line 77 |
| copy | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | yes, lines 11 and 152 |

Note the mismatch: `.env.example` line 76 lists `CREATIVE_COPY_API_KEY`. **No code
anywhere reads that name.** It is a dead line in the example file.

**A column was removed from this table.** The first version had a fifth column,
"Set in local `.env`?", reading blank, blank, blank, blank, "both set". There was
no command behind those answers and no way for a second reader to reproduce them,
so they have been taken out rather than left as an unbacked claim.

**What is set where - both UNVERIFIED, with the exact check for each:**

| Environment | What settles it |
|---|---|
| This laptop | `grep -c '^CREATIVE_STATIC_API_KEY=.\+' .env` (a count, never a value) - one per key name. **This lane did not run it: the tool refused a command that touched `.env`, and this lane does not work around a refusal.** |
| Netlify production - the one that actually matters | `netlify env:list --context production --plain`, run by someone who can reach it. `api.netlify.com` is blocked from here (CLAUDE.md section 11) and I did not try. |

No key value was read, printed or handled anywhere in this lane.

### The other two generation paths - on Brand Studio, and they work

**This was missed the first time round.** The first version of this lane
mentioned `src/brand/copy-generate.mjs` once, in passing, for a single argument.
It never looked at it as a way of making something. It is one, and there are two
of them, both on **Brand Studio** (`public/app/brand-studio.html`), not on
Creative Factory.

**1. "Generate copy" - real AI, real words, really saved.**

* The button is at `brand-studio.html` line 1106. Press it and the line beside it
  says *"Writing copy…"*.
* It posts to `/api/partner-marketing/generate-copy`, which **is** in the route
  map (`netlify/functions/api.mjs` lines 162 and 636), so it is not one of the
  404 traps.
* The endpoint calls `generateSectionCopy` in `src/brand/copy-generate.mjs`,
  which calls `callModel` in `src/agents/model.mjs` - the same genuine OpenAI /
  Anthropic connection described above. **No `creative_providers` row is
  needed.** This path does not use that table at all.
* The words come back, get run through the same safety check
  (`copy-generate.mjs` lines 130-140 - and note it passes `offerType: "funding"`
  properly, which is why it is not blocked the way Creative Factory would be).
* If the check passes, the words are **saved twice**: an old-copy record in
  `partner_page_section_versions` (line 153) and the live page text in
  `partner_pages.body_json` (line 166). Blocked sections are skipped and left
  alone. Locked legal blocks are never sent to the AI in the first place.

**So: press the button, get real written copy on the page. That works today.**

**2. "Generate logo" - a picture, made here, no vendor and no key at all.**

* The button is at `brand-studio.html` line 1124.
* It posts to `/api/partner-marketing/generate-logo`, also routed
  (`api.mjs` lines 164 and 638).
* There is **no AI and no outside company involved**. It draws a simple
  text-only logo - the brand name set in the brand's own typeface and colours -
  right here in the code (`src/brand/wordmark.mjs`, `wordmarkDataUrl`).
* It saves the picture straight onto `partner_brand.wordmark_url` and the screen
  shows it immediately.

**So: press the button, get a plain text logo on screen. That also works today,
with no key and no vendor set up anywhere.**

**What both share with Creative Factory:** the same owner switch. Both call
`assertSuiteEnabled`, so if the marketing suite is off for that partner both
refuse with *"The owner has not turned this on for this partner."* Both also
count against the usage cap.

**Why this matters to the headline.** "Nothing comes out" was true of the screen
this lane was pointed at, and false of the repo. Two Generate buttons in this
codebase produce a real, saved result today.

### Is a creative vendor even allowed to send?

**Yes.** CLAUDE.md section 12 says outbound sending is only allowed in
`src/messaging/providers/`. The test that enforces that rule,
`src/lib/no-unfenced-transmit.test.mjs`, has an explicit allowance at line 128:

> `"src/creative/providers/_http.mjs": "UNFENCED SPEND: paid creative-generation providers."`

So the creative vendors are already permitted, deliberately and in writing. They
are flagged as "can spend money, cannot reach a client". Nothing needs unblocking.

---

## TASK 4 - the compliance screen

### Where it runs

Inside `storeAsset` (`src/creative/generate.mjs` line 245), on **every asset,
one at a time, right after it is saved**. There is no way round it. There is no
"skip" flag and the file says do not add one.

The rules come from `db/migrations/047_compliance_rules.sql` - twelve saved
rules, all of them set to "stop", plus eight more checks built into
`src/compliance/screen.mjs` itself.

### What happens to a blocked asset

It is **kept, not deleted**. The row stays in the library marked `blocked`, and
the reasons are saved alongside it. The database refuses to let a blocked asset
have an empty reason list (`045` line 205). A second copy of the verdict is
written to an audit table, `compliance_screenings`.

Nothing in the generate path can ever mark something `approved`. Only a person
can, through the Approve button (`api/creative/actions.mjs`).

### Can a person see WHY?

**Yes.** `creative-factory.html` line 1670 (`reasonCard`) prints the reason
message, plus a short code, plus extra detail if there is any. The asset detail
panel has a heading "Why it was stopped" (line 2007). The screen also carries a
full reference table of all 29 possible reasons in plain-ish English, and points
at `docs/compliance/creative-block-reasons.md` for the legal detail.

That part is done properly.

### But here is the problem

**Today, every asset would be blocked for the wrong reason.**

`src/compliance/screen.mjs` line 117 refuses anything that does not say what is
being sold:

```
if (!OFFER_TYPES.has(offerType)) {
  return blocked("offer_type_missing", ...)
}
```

The allowed answers are `funding`, `credit_cards`, `credit_repair`.

**The Generate form never asks and never sends it.** Look at the form: Kind, What
to make, Name this batch. That is all (`creative-factory.html` lines 436-443).
The request it builds sends `{ prompt, formats, variants, assetKind }` and no
offer type (line 2312). `storeAsset` reads `spec.offerType`, gets nothing, and
the screen stops the asset.

So the thing Chris would eventually see, on every single asset, is a red box
reading:

> **offer_type must be one of funding, credit_cards, credit_repair; got undefined.**

That is engineer language on a screen built for someone who does not read code.
`docs/compliance/creative-block-reasons.md` line 143 already has the plain
version - *"The request did not say what is being sold"* - but the screen shows
the raw one because it prints the message the engine wrote.

**Why nobody caught this:** every test in `src/creative/generate.pg.test.mjs`
passes `offerType: "funding"` by hand (lines 66, 81, 159, 184...). The tests test
a request the real screen never sends. Green tests, broken screen.

For contrast, the same screening called from Brand Studio does it right -
`src/brand/copy-generate.mjs` line 132 passes `offerType: "funding"`.

---

## TASK 5 - the plain answer

**Which screen this is about: Creative Factory** (`public/app/creative-factory.html`,
the "Generate and decide" panel). Brand Studio is a different screen and it is
covered separately at the end of this section - it does make things.

**On Creative Factory today, clicking the button gives Chris an error, not an ad
and not a fake.**

He presses "Enqueue generation". The screen says, honestly, that the job is saved
but cannot run because no ad-making service is switched on. It then sits there.
The two-minute clock that is supposed to pick it up **cannot see it** (Task 2),
so nothing happens on its own. When he presses "Run queued jobs now" the job is
marked failed, and the list says *"No ad-making service is switched on for this
account, so there is nothing to make the work."* Nothing is made. Nothing is
faked. Nothing is hidden. The failure message is telling the truth.

**The exact thing that has to be configured is a row in the `creative_providers`
database table** - one row per kind of creative (picture, video, words), naming
which vendor to use and the vendor's web address. That row does not exist, no
migration creates it, and no seed file creates it. **There is no screen and no
endpoint in the CRM that can create it** - I searched all of `api/`, `src/` and
`public/app/`. Today it can only be added by hand, in the database, by someone
who writes SQL.

**Correction: the screen does tell him it is missing.** The first version of this
lane said "there is no screen anywhere in the CRM" and "what is missing is any
way for him to fix it", without opening the panel on the screen it was auditing.
Creative Factory has a fold-out panel called **"Settings the creative engine
ships with"** (`creative-factory.html` lines 600-612). Its second row reads:

> **Creative vendors** · Which vendor makes each kind of creative · 0 ·
> **Not set — generation cannot run** · Nothing can be generated until a vendor
> is switched on

So he is told. What is missing is only the *ability to fix it from a screen*, not
the warning.

**But that panel is a new finding of its own, and it is not good.** That table is
**typed into the page as a fixed list** - a hardcoded array at
`creative-factory.html` lines 826-851. It is not read back from the database.

There is a database view built for exactly this job -
`v_creative_config_gaps`, created at `db/migrations/048_campaign_config.sql`
line 262 and rebuilt at `052_config_defaults.sql` line 290. It counts the live,
active vendor rows. **Nothing in `api/` or `public/` ever asks it anything.**
`grep -rn v_creative_config_gaps api/ public/ src/` returns the view itself, one
test file, some migration comments, and — in `public/` — only the comment at
`creative-factory.html` line 825 saying where the wording came from.

**What that means for Chris:** the day somebody finally inserts a vendor row, that
panel will still say **"Not set — generation cannot run"**, because it is reading
a sentence typed into the page, not the database. That is the same failure shape
as a screen showing its starting text and looking like a real answer.

To the screen's credit, it says so in small print directly above the table:
*"These are not read back from the running system, so this table will not change
when somebody changes a setting."* So it is honest. It is still a table of
numbers that will go stale and mislead anyone who does not read the small print.

**And fixing the vendor row would not be enough.** Four more things stand between
him and a finished ad:

1. **No real vendor has been picked.** Four of the five adapters point at
   invented web addresses like `api.example-image-provider.com`. Somebody has to
   choose actual companies, sign up, and check the request shape against a real
   account - the code files say this in their own headers.
2. **The finished picture is thrown away, and the words are hidden.** The system
   saves a note that an asset exists, but there is no place in the database for
   the picture's address, and nothing ever uploads a file. The written words are
   saved, but only into the safety-check audit record - they are on no creative,
   in no answer from the server, and on no screen. The screen says "no preview
   available" because there genuinely is nothing to show.
3. **Every asset would be stopped by the compliance check** for a reason that is
   not about the ad: the form does not ask what is being sold, so the checker
   refuses it. The one-line fix is a dropdown on the form - funding, credit
   cards, or credit repair - passed through to the job.
4. **One of the four "Kind" choices can never work.** The dropdown offers
   "resize", but resize needs to be told which existing picture to reshape, and
   the form never asks and never sends it. It fails every time, after three slow
   retries. Either take it off the dropdown or give the form a way to pick the
   original picture.

And one more that is not between him and an ad, but will mislead him:

5. **The "Settings the creative engine ships with" panel will never update.** It
   is a fixed list typed into the page. It will keep saying "Not set" after a
   vendor is switched on. Pointing it at the `v_creative_config_gaps` view that
   already exists is the fix.

**And the clock, on top of all five:** even with everything above fixed, nothing
would run on its own, because the two-minute sweeper cannot see the queue
(Task 2). That is one query in one file.

### Brand Studio - the same question, a different answer

If Chris opens **Brand Studio** instead and presses **"Generate copy"**, real
words are written by a real AI service and saved to his page. If he presses
**"Generate logo"**, a plain text logo is drawn and saved. Neither needs a
vendor row and neither needs a `CREATIVE_*` key. Both need the same owner switch
(the marketing suite) turned on for that partner. Full detail in Task 3.

**The honest summary:** the queue, the safety check, the approval buttons and the
plain-English error messages are all real and all working. The clock exists but
is blind. The part that actually makes an ad, and the part that keeps the ad once
it is made, are both absent. This is a well-built factory floor with no machine
in it and no loading dock - while the smaller workshop next door, Brand Studio,
is turning out copy and logos today.

---

## What would settle the UNVERIFIED items

| Unknown | What settles it |
|---|---|
| **Which database login production uses.** The blind-clock finding in Task 2 holds only if it is an ordinary login, not a superuser. | `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;` on a scratch copy of the database. **Not `/api/health`** - I checked, and health only reports up/down and migration counts (`src/http/health.mjs` lines 124-155). |
| Whether Netlify has any `CREATIVE_*` key set | `netlify env:list --context production --plain` |
| Whether this laptop has any `CREATIVE_*` key set | `grep -c '^CREATIVE_STATIC_API_KEY=.\+' .env` - a count, never a value. The tool refused a command touching `.env` in this lane and I did not work around it. |
| Whether any partner has the marketing suite on | one read of `partner_module_settings` on live |
| Whether a `creative_providers` row exists on live | `SELECT count(*) FROM creative_providers` on live |

I did not run any of these. `api.netlify.com` is blocked here, this lane is
forbidden from touching the production database, and no key value was read or
printed anywhere.

---

## Change manifest

* **Files touched:** `docs/ops/_lanes/2026-09-06-cf-generate.md` only. No repo
  code, no config, no tests, no database of any kind, no git commands beyond
  read-only ones.
* **Anything surprising:** the every-two-minutes clock cannot see the queue - it
  asks the database a question without saying who it is, the locked table answers
  "nothing", and it reports success while running nothing, forever. Second: this
  screen is not the only Generate button in the repo - Brand Studio writes real
  copy and makes a real logo today, with no vendor and no key. Third: the panel
  that warns "no vendor set" is typed into the page and will keep saying it after
  someone sets one.
* **Could not verify:** which database login production uses (this decides
  whether the blind-clock finding bites); what is set in Netlify production env
  (host blocked); what is set in the local `.env` (the tool refused a command
  touching it, and this lane did not route round the refusal); how many partners
  have the marketing suite on; whether a `creative_providers` row exists live.
