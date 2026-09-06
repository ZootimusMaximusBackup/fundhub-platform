# Creative Factory - what the seven endpoints really do

Read-only audit. Nothing in the repo was changed. Every line number below was read
in the working tree on 2026-09-06.

**Corrected 2026-09-06, same day.** A review found this file stated three things that
were wrong and left out four that mattered. The corrections are marked where they sit.
The biggest one: §7's finding is now **measured on a throwaway database**, not reasoned
from reading the code. The live database was never connected to.

---

## The short answer for Chris

The screen is real. The buttons are wired. All seven endpoints exist, all seven are
routed, and the code behind them is careful and well built.

But **nothing can come out of it today**, for three separate reasons. Each one on
its own is enough to stop him.

1. **No ad-making service is switched on.** The list of "which vendor makes our
   pictures" is a table in the database that ships empty on purpose. Nobody has put
   a row in it. Every job Chris queues records a failure instead of making anything.
2. **Even if a vendor were switched on, nobody has proven how to talk to it.**
   Four of the five vendor files fall back to made-up web addresses like
   `api.example-image-provider.com`. The address itself is **not** a lock - it can
   be changed by editing one field on the vendor's database row. The real problem
   is that the *shape* of the question we ask the vendor, and the shape of the
   answer we expect back, was written from a guess. So whoever fills in the vendor
   row will very likely have to change the vendor file too, not just the row.
   See §2.5.
3. **Even if a picture came back, the screen would never show it.** The picture's
   web address is thrown away and never saved. The library tile is hard-coded to
   say "no preview available". **This is not because the repo lacks a place to put
   files.** FundHub already has a working file store - it holds contracts, letters
   and sales decks today. The Creative Factory code simply never calls it. So the
   job is "point creative at the storage we already have", not "build storage".
   See §2.7.

So Chris presses "Enqueue generation", presses "Run queued jobs now", and gets the
sentence: *"It did not work, and nothing was made. No ad-making service is switched
on for this account, so there is nothing to make the work."*

That sentence is honest. The system is telling the truth about itself. It is just
not a system that makes ads yet.

There is also a fourth thing that stops him **before** any of that: the Generate and
Run buttons on Creative Factory stay greyed out until someone flips a per-partner
switch that lives on a **different screen** (Brand Studio). See §2.1.

---

# TASK 1 - the seven endpoints, one at a time

Common ground first, because six of the seven share it.

* **Every one of them needs a partner.** Creative Factory is partner-scoped. A staff
  session (Chris) must pass `?partner_id=`. A partner session is locked to its own.
  There is no "make ads for FundHub itself" mode unless FundHub has a `partners` row.
* **Every one of them opens the database "as that partner"** so the database itself
  filters rows (`withPartnerScope`, `src/partners/rls.mjs:94`). A query that forgets
  its filter returns nothing rather than everything.
* **Every one refuses a client or affiliate session** with 403.

---

## 1. POST /api/creative/generate

**File:** `api/creative/generate.mjs` (154 lines)

**In one sentence:** puts a request for new creative in a queue, then immediately
checks whether anything is switched on that could actually make it.

**Must be given:**

| Field | Required? | Note |
|---|---|---|
| `partner_id` | yes for staff | ignored for a partner session (locked to their own) |
| `idempotency_key` | **yes** | the "Name this batch" box on the screen |
| `asset_kind` | no | defaults to `static` |
| `prompt` / `spec` | no | an empty prompt is accepted |

**Must already exist:**

* A `partners` row, with an `org_id`.
* `partner_module_settings.marketing_suite_enabled = true` for that partner.
  Column default is **false** (`db/migrations/172_wl_marketing.sql:8`).
* A `creative_providers` row - only for the job to *run*. The job saves without one.

**Returns on success (200):** `{ ok, created, job, provider_ready, note }`.
`provider_ready` is `true`, `false`, or `null`. `null` is deliberate and means
"the readiness check itself broke, so we are not going to claim either way"
(`generate.mjs:64-66`).

**Every way it refuses:**

| Condition | Code | Exact message |
|---|---|---|
| Not a POST | 405 | `method_not_allowed` |
| No session | 401 | `unauthorized` |
| Client or affiliate session | 403 | `this endpoint serves partner, staff` |
| Auth check could not run | 503 | `auth_unavailable`, `db: "down"` |
| Staff with no `partner_id` | 400 | `partner_id_required` |
| No batch name | 400 | `Pass a stable idempotency_key so retries do not double-bill.` |
| Partner id not found | 404 | `partner not found` |
| Suite switch off | 403 | `The owner has not turned this on for this partner.` |
| Anything else | 500 | scrubbed |

**The three "saved but it cannot run" notes** (`generate.mjs:49-66`) - these are the
sentences Chris will actually read:

* Vendor row missing: *"Saved to the queue, but it cannot run yet: no ad-making
  service is switched on for this account. The next try will be recorded as a
  failure and nothing will be made."*
* Vendor row names a module that does not exist: *"...the ad-making service on file
  is one this system does not know how to use."*
* Check itself failed: *"Saved to the queue. We could not check whether an ad-making
  service is switched on, so we cannot say yet whether it will run."*

**One quiet gap.** `asset_kind` is never validated by the endpoint. Send
`asset_kind: "banana"` and the job saves happily; it only fails later when the vendor
lookup finds nothing for that kind. Not a bug Chris will hit from the screen (the
dropdown offers four fixed values) but a hand-made request gets a confusing answer.

---

## 2. GET /api/creative/library

**File:** `api/creative/library.mjs` (56 lines)

**In one sentence:** lists the creative that has been made for this partner.

**Needs:** a partner. Optional filters: `state`, `kind`, `format`, `brand_kit_id`,
`include_archived=1`, `limit`, `offset`.

**Needs to already exist:** rows in `creative_assets`. Nothing else - no vendor, no
env var.

**Returns:** `{ ok, count, limit, offset, hasMore, items }`.

**Refusals:**

| Condition | Code | Message |
|---|---|---|
| Not a GET | 405 | `method_not_allowed` |
| No session / wrong kind | 401 / 403 | as above |
| Staff with no `partner_id` | 400 | `staff sessions must name a partner_id; partner sessions are scoped to their own` |
| Bad `?state=` | 400 | `unknown state <x> - expected one of pending, passed, blocked, approved` |
| Bad uuid in `?brand_kit_id=` | 400 | `invalid_parameter` |
| Query blew up | 500 | `query_failed` |

An unknown `?kind=` or `?format=` is **ignored**, not refused - a deliberate choice
so a stray value does not blank the screen (`library.mjs:29-30`).

**THE FINDING THAT MATTERS HERE.** The query deliberately does not select the file
location, and instead computes a true/false flag called `has_storage_key` so the
screen knows whether to draw a thumbnail (`library.mjs:40`). That flag **never
reaches the screen.** The shared cleanup filter that runs on every response strips
any field whose name contains `storage_key` - and `has_storage_key` contains it
(`src/http/read-api.mjs:18`, regex `/…|storage_key|…/i`, applied at `read-api.mjs:117`).

So the screen has no way to tell a stored picture from a missing one, and the
front end has given up trying: every tile in the library is hard-coded to read
**"no preview available"** (`public/app/creative-factory.html:1474-1476`). The
comment there names the cause correctly.

This is a self-cancelling pair of good intentions. Nobody is wrong; the result is
a library that can never show a picture.

---

## 3. GET /api/creative/brand-kits

**File:** `api/creative/brand-kits.mjs` (42 lines)

**In one sentence:** lists this partner's brand kits (colours, fonts, tone of voice,
products), each with a count of how many live creatives use it.

**Needs:** a partner. Optional `?state=draft|active|archived|all`, `limit`, `offset`.

**Returns:** `{ ok, count, limit, offset, hasMore, items }`.

**Refusals:**

| Condition | Code | Exact message |
|---|---|---|
| Not a GET | 405 | `method_not_allowed` |
| No session / wrong kind | 401 / 403 | as above |
| Staff with no `partner_id` | 400 | `staff sessions must name a partner_id; partner sessions are scoped to their own` |
| Bad `?state=` | 400 | `unknown state <x> - expected one of draft, active, archived` |
| Query blew up | 500 | `query_failed` |

The bad-state reply is `{ ok: false, error: "bad_state", message: "<that sentence>" }`.
The sentence is built once, for every list endpoint, at
`src/http/partner-read-api.mjs:139`, and returned at `:90`. The three allowed words
come from `brand-kits.mjs:14`. `?state=all` and an empty `?state=` are accepted and
mean "no filter".

**THE FINDING THAT MATTERS HERE.** *Nothing in the shipping product creates a brand
kit.* I searched every file for a write to `brand_kits`. There are exactly two, and
both are test fixtures:

* `src/http/creative-endpoints.pg.test.mjs:215`
* `src/compliance/invariants.pg.test.mjs`

No endpoint, no script, no database seed, no button. The migration that created the
table has a companion table `brand_kit_sources` and a `scraped_at` column, which
says the intent was "point it at a website and it reads the brand off the page" -
but that scraper does not exist in this repo.

So on the Creative Factory screen, the Brand kits panel is permanently empty and
the "Brand kit" dropdown next to the library filter offers only "any". Chris cannot
put his brand into the machine. **UNVERIFIED:** whether a brand kit is *required*
for generation - it is not; `brand_kit_id` is optional and the job runs with `null`.
So this blocks brand-consistent output, not output as such.

---

## 4. GET /api/creative/jobs

**File:** `api/creative/jobs.mjs` (45 lines)

**In one sentence:** shows every generation job and, when one failed, why.

**Needs:** a partner. Optional `?state=queued|running|succeeded|failed|all`.

**Returns:** id, brand kit, provider, status, attempt count, **error text**,
batch name, timings, and how many assets came out of it.

Two deliberate omissions: `cost_cents` is never returned, because that is FundHub's
raw vendor cost and showing it would publish the markup (`jobs.mjs:11-12`). The
`error` text **is** returned, because a partner whose job failed needs to know why -
safe only because vendor keys are scrubbed out of error text before storage
(`src/creative/providers/_http.mjs:77-85`).

**Refusals:**

| Condition | Code | Exact message |
|---|---|---|
| Not a GET | 405 | `method_not_allowed` |
| No session / wrong kind | 401 / 403 | as above |
| Staff with no `partner_id` | 400 | `staff sessions must name a partner_id; partner sessions are scoped to their own` |
| Bad `?state=` | 400 | `unknown state <x> - expected one of queued, running, succeeded, failed` |
| Query blew up | 500 | `query_failed` |

Same builder as the other lists (`src/http/partner-read-api.mjs:139`, returned at
`:90` as `{ ok: false, error: "bad_state", message }`). The four allowed words come
from `jobs.mjs:16`. `?state=all` means "no filter".

---

## 5. GET /api/creative/approvals

**File:** `api/creative/approvals.mjs` (86 lines)

**In one sentence:** one combined review queue - creative waiting on a compliance
decision, campaigns waiting on a spend approval, and partner brands sent in for
review.

It is a UNION of three different things flattened into one row shape so the screen
renders one ordered list. `?state=blocked` or `pending` filters to creative;
`?state=awaiting_approval` filters to campaigns **and** brands.

**Needs:** a partner. Nothing else.

**Refusals:** same shape as the other reads. Note it does **not** use the shared
state validator, so an unknown `?state=` here is silently treated as "match nothing"
rather than returning a 400 - a small inconsistency with the other three reads.

**Worth knowing:** the third arm of the query (partner brands) carries its own
`b.partner_id = $7` filter because `partner_brand` is *not* one of the tables the
database protects automatically. That one line is the whole isolation story for
brands, and there is a test that fails if it is deleted
(`creative-endpoints.pg.test.mjs:168-180`).

---

## 6. POST /api/creative/actions

**File:** `api/creative/actions.mjs` (96 lines)

**In one sentence:** approve, reject, or archive one piece of creative.

**Must be given:** `partner_id` (staff only), `asset_id`, and `action` = one of
`approve` / `reject` / `archive`. Reject optionally takes `reasons` (a list) or a
single `reason` string.

**Needs to already exist:** the asset, owned by that partner. Nothing else - no
vendor, no env var, no suite switch.

**Returns:** `{ ok, action, asset }` with the updated row.

**Every way it refuses:**

| Condition | Code | Exact message |
|---|---|---|
| Not a POST | 405 | `method_not_allowed` |
| No session | 401 | `unauthorized` |
| Client / affiliate | 403 | `this endpoint serves partner, staff` |
| Staff with no partner id | 400 | `partner_id_required` |
| Action not one of the three | 400 | `unknown_action`, plus `allowed: ["approve","reject","archive"]` |
| No `asset_id` | 400 | `asset_id_required` |
| Asset not found, or not this partner's | 404 | `asset not found` |
| Approving something already archived | 400 | `archived assets cannot be approved` |

**And one that is not a refusal at all, which is worse.**

| Condition | Code | What actually happens |
|---|---|---|
| **Rejecting** something already archived | **200** | `{ ok: true, action: "reject" }` - **and nothing changes** |

Approve on an archived asset says no, out loud. Reject on an archived asset says
yes and does nothing. The update at `actions.mjs:79-86` carries
`AND archived_at IS NULL`, so it matches no row; line 87 is `return r.rows[0] || found`,
which quietly falls back to the row as it was before, and the endpoint answers 200
with that unchanged row. Chris presses Reject, the screen says it worked, and the
asset is exactly as it was.

For Chris: a refusal tells you. A fake success does not. This is the more dangerous
of the two, and it is the mirror image of a case the code already handles correctly
one branch above.

**Two more things worth flagging.**

**(a) No suite-switch check - and it is two endpoints, not one.** Unlike `generate`,
this endpoint never calls `assertSuiteEnabled`. So a partner whose marketing suite is
switched **off** can still approve, reject and archive creative by hand-made request.

**`POST /api/creative/run` has the same hole, and it is the expensive one.**
`grep -n 'assertSuiteEnabled' api/creative/*.mjs` returns hits in `generate.mjs` only
(lines 11 and 106). `run.mjs` imports `requirePrincipal`, `withPartnerScope`,
`resolvePartnerId`, `claim`/`run`, `runDue` and `safeError` (lines 5-11) and never
imports `src/brand/meter.mjs` at all. So a partner whose suite is switched **off** can
still drain their own queue by hand-made request - and running a job is the step that
spends FundHub's money with the vendor. Approving is free; running is not.

The screen greys out both buttons (`creative-factory.html:1108-1111`, `setWriteControls`
disables `genBtn`, `runJobsBtn` and every `[data-cact]` button), but the screen is not
the lock. See the fail-closed entry in §2.1.

**(b) COMPLIANCE REVIEW REQUIRED - a partner can approve creative the compliance
screen blocked.** `approve` sets `compliance_state = 'approved'` **and wipes
`blocked_reasons` to an empty list** (`actions.mjs:68`). Any partner session, with
no role check of any kind, can do this to their own blocked asset. The reasons the
automated screen recorded are erased, not kept alongside. The generation service's
own header says "Nothing in this module can set 'approved' - that is a human action
through UNIT 8" (`src/creative/generate.mjs:26`), which is true, but it does not say
*which* human. Today it is any human at the partner.

I am reporting this, not recommending a review of it. It may be exactly what was
intended.

---

## 7. POST /api/creative/run

**File:** `api/creative/run.mjs` (124 lines)

**In one sentence:** takes queued jobs off the queue and actually runs them - this
is the "Run queued jobs now" button.

**Must be given:** `partner_id` (staff), optional `max_jobs` (clamped 1..10,
default 3). Or `all: 1`, which is **staff-only** and drains every partner.

**Needs to already exist:** queued jobs, and - to produce anything - a
`creative_providers` row plus the matching `CREATIVE_*_API_KEY` in the environment.

**Returns:** `{ ok, ran, succeeded, failed, requeued, jobs, note }`. The counts were
added because "Ran 1 job." read as success even when the job died and made nothing
(`run.mjs:77-85`).

**Every way it refuses:**

| Condition | Code | Message |
|---|---|---|
| Not a POST | 405 | `method_not_allowed` |
| No session | 401 | `unauthorized` |
| Client / affiliate | 403 | `this endpoint serves partner, staff` |
| `all=1` from a non-staff session | 403 | `staff_only_for_all` |
| No partner id (and not `all`) | 400 | `partner_id_required` |
| Anything else | 500 | scrubbed |
| **Marketing suite switched off** | **nothing - it runs anyway** | see §6(a) |

That last row is the gap. `generate` refuses when the suite is off; `run` does not
check. `run.mjs` never imports `src/brand/meter.mjs`, so `assertSuiteEnabled` is never
called here. The button is greyed out on the screen and that is the only thing
stopping it.

**The plain-English failure sentences** (`run.mjs:21-37`), which is what Chris sees:

* *"No ad-making service is switched on for this account, so there is nothing to make
  the work."*
* *"The ad-making service on file is one this system does not know how to use."*
* *"The service answered, but sent nothing back."*
* *"Nothing was waiting to run. Add a batch first, then press this again."*

**THE BIGGEST FINDING IN THIS LANE - the automatic runner never runs anything.**

`run.mjs:56` and the every-two-minutes cron (`netlify/functions/creative-job-runner.mjs:32`)
both call the same function, `runDue`. Its very first line asks the database which
partners have queued work:

```js
// src/creative/runner.mjs:11-21
const partners = await db.query(
  `SELECT partner_id, org_id FROM ( … FROM generation_jobs WHERE status = 'queued' … )`,
  [limitPartners]
);
```

That query runs on the **raw pooled connection**. It never opens a scoped
transaction and never stamps "I am staff" onto it. But `generation_jobs` has
`ENABLE` + **`FORCE` ROW LEVEL SECURITY** with the policy
`partner_id = fundhub_current_partner() OR fundhub_is_staff()`
(`db/migrations/045_creative_factory.sql:59-72`, applied to `generation_jobs` at
`045:355-364`).

On an unstamped connection both halves are false. **The query returns zero rows.**
So `runDue` finds zero partners, runs zero jobs, and reports `{ partners: 0, jobs: [] }` -
success, every two minutes, forever.

The very next call in the same file *does* scope correctly (`runner.mjs:25`), which
is why this reads as an oversight of exactly one query rather than a design choice.

Two consequences in Chris's terms:

* The promise on the screen - *"work you add here waits in a queue and is picked up
  on its own every couple of minutes"* (`creative-factory.html:427-428`) - is not
  kept. Jobs sit in the queue until somebody presses the button.
* The staff "run everything for every partner" path (`all=1`) does nothing and
  reports success.

**MEASURED, not argued - 2026-09-06.** The first version of this lane reasoned this
out from reading the code. It has now been run. On a **scratch** Postgres 16.14
(Homebrew, on this Mac) created for this test, with every migration through 299
applied to it empty, one `partners` row and one `generation_jobs` row with
`status='queued'` inserted, then `runDue(db, {})` called twice:

| Connected as | Queued rows the connection can see | `runDue` partners | `runDue` jobs |
|---|---|---|---|
| `fundhub_app` (no superuser, no bypass) | **0** | **0** | **none** |
| the table owner, a superuser | 1 | 1 | 1 ran, and failed on the missing vendor row |

Same database, same row, same function. The only thing that changed is who is
connected. That is the finding, proved rather than asserted. The superuser run also
happens to re-confirm §2.2: the job it picked up died with *"no active provider
configured … insert a creative_providers row"*.

Nothing was pointed at the live database. The scratch database has been deleted.

**The one contingency that is left.** The above proves the mechanism. It does *not*
prove which role the **live** site connects as, and that decides whether the
automatic runner is dead or fine on production. A superuser bypasses every policy
and the sweeper would work. Migration 104 exists to make the app connect as
`fundhub_app`.

**UNVERIFIED:** which role production is actually using right now.

**How to settle it - and the earlier version of this file named the wrong way.**
Reading `/api/health` does **not** answer this. `api/health.mjs` and
`src/http/health.mjs` never ask the database for `current_user`, `rolsuper` or
`rolbypassrls`; health only reports whether migrations are pending. The repo already
ships the exact check:

```
npm run guard:db
```

That runs `src/security/superuser-guard.test.mjs`, whose `PRIVILEGE_QUERY`
(lines 121-139) selects `current_user`, `n_super` and `n_bypassrls`. Point it at the
same `DATABASE_URL` the app uses and it prints the role name and the verdict in one
line. Run against the scratch database above it printed:
*"connected as `fundhub_app` … no superuser, no bypassrls"* - 3 of 3 pass.

Do not run it against production to satisfy this; get the answer from whichever
environment the app's `DATABASE_URL` points at, without connecting this lane to the
live database.

Note also: there is **no test at all** for `runDue`. See §4.

---

# TASK 2 - where it deliberately refuses rather than guesses

Chris asked for the equivalents of `ad_platform_category_map` shipping empty. There
are six here. Four are real fail-closed gates. The fifth is not a gate at all. The
sixth is a gate that was built and then never wired up, which is its own problem.

## 2.1 The per-partner marketing switch - **this is what greys out the buttons**

* **What it is:** `partner_module_settings.marketing_suite_enabled`, default
  **false** (`db/migrations/172_wl_marketing.sql:8`).
* **What refuses:** `assertSuiteEnabled` (`src/brand/meter.mjs:48-56`) → the
  `generate` endpoint answers 403 *"The owner has not turned this on for this
  partner."* And the screen itself keeps Generate, Run, Approve, Reject and Archive
  **disabled** until it is on (`creative-factory.html:996-997, 1110`).
* **What a person must set:** POST `/api/partner-marketing/enable` with
  `{ partner_id, enabled: true }`. **Owner role only** - an admin gets *"only the
  owner can turn this on"* (`api/partner-marketing/enable.mjs:44-46`).
* **The workflow trap:** the only button in the product that calls that endpoint is
  on **Brand Studio** (`public/app/brand-studio.html:1093`), not on Creative Factory.
  So Chris lands on Creative Factory, finds every button greyed out, and there is
  nothing on that page to turn it on with.
* **The switch only guards ONE of the three writes.** `assertSuiteEnabled` appears in
  `api/creative/generate.mjs` (lines 11 and 106) and **nowhere else** in
  `api/creative/`. So this gate is real for `generate`, and absent for:
  * `POST /api/creative/actions` - approve / reject / archive still work with the
    suite off.
  * `POST /api/creative/run` - **queued jobs still run with the suite off**, which is
    the step that spends FundHub's money with the vendor.

  In both cases the only thing stopping it is the greyed-out button on the screen,
  and a hand-made request does not go through the screen. See §6(a).

## 2.2 The vendor list - ships empty, on purpose

* **What it is:** the `creative_providers` table. Which company makes our images,
  our videos, our copy.
* **What refuses:** `resolve()` throws *"no active provider configured for asset kind
  "static" - insert a creative_providers row rather than hardcoding one"*
  (`src/creative/providers/index.mjs:55-59`). The job service treats that as a
  **permanent** failure, not an outage, and marks the job `failed` without retrying
  (`src/creative/generate.mjs:155-157`).
* **Confirmed empty:** I searched every migration and every seed file. There is not
  one `INSERT INTO creative_providers` anywhere in `db/`. The migration says so
  itself: *"NOT SEEDED WITH AN ACTIVE ROW"* (`048_campaign_config.sql:34-38`), and
  the database even ships a report view, `v_creative_config_gaps`, whose status
  column reads **"UNSET - generation cannot run"** (`052_config_defaults.sql:300-305`).
* **What a person must set:** one row per kind, e.g.
  `INSERT INTO creative_providers (org_id, asset_kind, provider_key, config, active)
  VALUES (<org>, 'static', 'static', '{"endpoint":"…","unit_cost_cents":…}', true);`
  Valid `asset_kind`: `static`, `video`, `copy`, `resize`. Valid `provider_key`:
  `static`, `ugc-video`, `product-video`, `copy`, `resize`.
* **A guard on top of the guard:** the table refuses any config blob containing a
  key named `api_key`, `apiKey`, `secret`, `token`, `password` or `access_token`
  (`048:66-69`). Credentials must live in the environment, not the database.

## 2.3 The vendor keys - each provider refuses by name

* **What refuses:** `requireKey` throws *"CREATIVE_STATIC_API_KEY is not set - the
  generation provider cannot run. Provider keys are Fundhub-level and live in env."*
  (`src/creative/providers/_http.mjs:18-27`). Note it names the variable, never a
  value.
* **What a person must set**, per kind:
  * static images → `CREATIVE_STATIC_API_KEY`
  * AI-presenter video → `CREATIVE_UGC_API_KEY`
  * product video → `CREATIVE_PRODUCT_VIDEO_API_KEY`
  * resize/derive → `CREATIVE_RESIZE_API_KEY`
  * ad copy → `ANTHROPIC_API_KEY` (a different check, `copy.mjs:26-28`)

  All five names appear in `.env.example` with empty values (lines 73-77).
  **UNVERIFIED:** whether any of them hold a real value in Netlify production. I was
  refused permission to read the local `.env`, and I did not query Netlify. What
  would settle it: `netlify env:list --context production --plain` and look at the
  names only.

## 2.4 The token budget

* **What refuses:** `assertUnderCap` throws *"this partner has used this month's
  writing budget"* when the month's token use exceeds the cap
  (`src/brand/meter.mjs:81-89`). Default cap 250,000 tokens/month. This only bites
  the **copy** provider, which is the one that calls a language model.
* **What a person must set:** nothing to start. It self-resets each month;
  `ai_token_cap_monthly` on `partner_module_settings` raises it.

## 2.5 The one that is NOT a fail-closed gate - the vendor addresses are fake

This is the item that reads like a configuration gap and is not one.

Four of the five provider files default to a made-up web address:

| File | Default address |
|---|---|
| `src/creative/providers/static.mjs:35` | `https://api.example-image-provider.com/v1/images` |
| `src/creative/providers/ugc-video.mjs:30` | `https://api.example-ugc-provider.com/v1/videos` |
| `src/creative/providers/product-video.mjs:28` | `https://api.example-product-video.com/v1/render` |
| `src/creative/providers/resize.mjs:36` | `https://api.example-resize.com/v1/derive` |

Every one of those files opens with the same warning: *"CONFIRM BEFORE THIS RUNS
LIVE. The request/response shape below … has not been proven against a real
account."* The address is overridable through `config.endpoint` on the vendor row,
so this is fixable by a row edit - but the **shape** of the request and the reply is
a guess. Whoever fills in `creative_providers` will almost certainly have to edit
the provider file too, not just insert a row.

Only the fifth, `copy.mjs`, talks to a real service (Anthropic, through
`src/agents/model.mjs`). With no `ANTHROPIC_API_KEY` that module returns "shadow
mode" and the copy provider turns that into a thrown failure
(`copy.mjs:61-63`) - correct, not silent.

## 2.6 The gate that was built and never plugged in - nobody gets billed

This one is a fail-closed gate like the four above, with one difference: **nothing in
the shipping product ever calls it.**

* **What it is:** `accrue_creative_usage()`, a database function
  (`db/migrations/050_creative_metering.sql:164`). It is meant to be the one and only
  way a billable creative event gets written down.
* **What refuses:** it **raises** - stops with an error - while the applicable rate is
  not set. Its own header says why (`050:32-35`): *"a metering row written against a
  guessed rate looks exactly like a real one, and nobody would find it until an
  invoice went out. A loud stop is recoverable; a plausible number is not."* That is
  good design.
* **The rate ships unset on purpose.** `creative_billing_rates` has the rows present
  and the rate `NULL`. The database's own gap report says so in words:
  `generation_markup_pct` reads **"UNSET - billing raises"**
  (`052_config_defaults.sql:308-312`).
* **Who calls it in the product:** *nobody.*
  `grep -rn 'accrue_creative_usage' src/ api/ db/ scripts/ netlify/` returns the
  migration that defines it and **six lines in one test file**
  (`src/social/social.pg.test.mjs`, lines 329, 397, 400, 423, 447, 472). No endpoint,
  no workflow, no cron.

**What that means for Chris, plainly.** Task 2 asked what a person must set before
this runs. Here the answer is: **nothing - and that is the problem.** On a fully
configured system - vendor row in, keys set, suite on - generation would go ahead,
spend FundHub's money with the vendor, and record **no billable event at all**. The
loud stop never fires, because the function that would fire it is never reached. The
money goes out and nothing writes down that it should come back in.

This is not a blocker to making an ad. It is a blocker to getting paid for one.

## 2.7 And one more thing - the file store exists, and creative does not use it

Not a deliberate refusal, so it does not belong above, but it is the same class of
problem and it is the one that would bite *after* everything else is fixed.

When a vendor answers, it hands back a web address for the finished image
(`source_url`, set at `_http.mjs:101`). The service then writes the asset row -
and **never writes `source_url` anywhere.** The `creative_assets` table has no such
column (`db/migrations/045_creative_factory.sql:163-219`). Instead the service
invents a file path (`generate.mjs:299-304`):

```js
return `partners/${partnerId}/creative/${a.format}/${id}.${ext}`;
```

Nothing ever puts a file at that path.

**CORRECTION - an earlier version of this lane said "there is no code anywhere in the
repo that stores the actual image file." That was wrong.** There is, and it is built,
routed and in use elsewhere in the product today:

* `src/documents/store.mjs` is a general file store that does not care which vendor
  holds the bytes. It has a `put` / `get` / `del` interface (`createStore` at line
  102, `storeFromEnv` at 435) and three ready-made back ends behind it -
  in-memory for tests (line 184), Vercel Blob (243) and Netlify Blobs (331).
* `src/documents/signed-url.mjs` mints short-lived links to those files and checks
  them on the way back in (`signDocumentUrl` at line 56, `verifyDocumentUrl` at 121).
  Default life of a link is 15 minutes.
* It is not shelfware. Contracts, DIY dispute letters, welcome videos, the closer
  deck and consent captures all go through it, and the download route is live
  (`api/documents-upload.mjs`, `api/documents-download.mjs`,
  `netlify/functions/api.mjs:221-222`).

What is true is narrower and more useful: **the Creative Factory never calls it.**
`grep -rn "documents/store\|documents/signed-url\|storeFromEnv\|signDocumentUrl"
src/creative/ api/creative/` returns nothing at all.

So the database records where a picture *would* live, the picture itself is left on
the vendor's server behind a link that is discarded, and the screen shows "no
preview available". **Chris would never see the ad, even on a fully configured
system.**

**Why the correction matters to Chris:** this changes the size of the job. It is not
"build a storage system." It is "point creative at the storage we already have" -
plus keep the vendor's link long enough to fetch the file once, and stop the cleanup
filter eating the `has_storage_key` flag (see Task 1 §2).

---

# TASK 3 - which are routed

All seven. Confirmed by line number in `netlify/functions/api.mjs`.

| Endpoint | import line | ROUTES entry line |
|---|---|---|
| `creative/generate` | 182 | 705 |
| `creative/library` | 183 | 706 |
| `creative/brand-kits` | 184 | 707 |
| `creative/jobs` | 185 | 708 |
| `creative/approvals` | 186 | 709 |
| `creative/actions` | 187 | 710 |
| `creative/run` | 188 | 711 |

There is a test that fails if a handler file is neither routed nor allow-listed, and
a second one that names four of these seven individually
(`src/http/routes.test.mjs:218`: `creative/library`, `creative/brand-kits`,
`creative/jobs`, `creative/approvals`). `generate`, `actions` and `run` are covered
only by the general rule, not by name. All seven are also listed in the health
registry (`src/pulse/registry.mjs:76-82`).

**No routing problem here.** The §12 trap did not recur.

---

# TASK 4 - which have tests, and what those tests actually prove

Five test files touch this area. Every `.pg.test.mjs` skips silently with no
`DATABASE_URL`, so "green" locally may mean "did not run".

| Endpoint | Test file | What is actually pinned |
|---|---|---|
| library, brand-kits, jobs, approvals | `src/http/creative-endpoints.pg.test.mjs` | the SQL runs, and one partner cannot see another's rows |
| generate | `src/http/creative-generate.pg.test.mjs` | the real handler, real sessions, assertions on the saved row |
| the engine underneath | `src/creative/generate.pg.test.mjs` | queue, retry, blocking, cost, storage-key namespace |
| the five providers | `src/creative/providers/providers.test.mjs` | shape and key-scrubbing, with a fake network |
| the cron | `src/creative/runner-cron.test.mjs` | **16 lines. It compares two strings.** |

**What is genuinely well pinned:**

* Each read endpoint's SQL is executed for real, then executed again as a partner
  who owns nothing, and the second must come back empty. That is the real isolation
  policy through the real shipped query, not a hand-written probe.
* `generate` is tested through the **actual handler** with real session tokens, and
  the assertions are against the saved database row, not against the reply. That is
  the right way round, and the file explains exactly which bug it exists to catch.
* A blocked asset reaching the review queue **with its reasons** is pinned
  (`creative-endpoints.pg.test.mjs:140-148`).
* `cost_cents` never leaving `jobs` is pinned (`:182-190`).
* A vendor outage leaving the job queued rather than "succeeded and empty" is pinned
  (`generate.pg.test.mjs:179`). Same for a vendor returning nothing (`:195`).

**What is NOT pinned - and these are the gaps:**

1. **`POST /api/creative/actions` has no test at all.** Approve, reject and archive -
   the three buttons that change a compliance state - are untested. Nothing catches
   it if approve stops clearing the reasons, or if the ownership check is dropped.
2. **`POST /api/creative/run` has no test at all.** Neither the per-partner path nor
   the staff `all=1` path.
3. **`runDue` has no test at all.** Which is precisely why the row-level-security
   problem in §7 above is sitting there unnoticed. The only "cron test" reads
   `netlify.toml` and checks the schedule string matches a constant. It proves the
   clock is set. It proves nothing about the alarm. The measurement in §7 was done by
   hand on a scratch database for this lane; there is still nothing in the suite that
   would catch it coming back.
4. **The reads are tested at the SQL layer, not the response layer.** The tests call
   the exported `fetchRows` function directly, which skips the cleanup filter. That
   is exactly why the `has_storage_key` problem (§2 of Task 1) is invisible to the
   suite: the test asserts `typeof r.has_storage_key === "boolean"`
   (`creative-endpoints.pg.test.mjs:123`) and passes, while the real HTTP response
   has no such field.
5. **No end-to-end test.** No test signs in, queues a batch, runs it, and looks for
   a picture. Every layer is tested against a fake of the layer below it.

Plain answer to Chris's question: **the tests prove the plumbing does not leak. They
do not prove water comes out of the tap.**

---

# TASK 5 - who is allowed to call each one

The §12 trap is `requireAuth(req, res, { roles: [...] })` - a shape where the `roles`
key is silently ignored, so the endpoint looks gated and is not.

**None of the seven has that shape.** I checked every file: `grep -n "roles:"
api/creative/*.mjs` returns nothing, and none of them import `requireAuth` at all.
They all use `requirePrincipal`, which is a different function that genuinely
enforces its list (`src/http/middleware/requirePrincipal.mjs:82-86`) and which fails
closed when the list is empty (`:67-71`).

| Endpoint | Who may call it | Any role check beyond that? |
|---|---|---|
| generate | staff, partner | no - plus the suite switch |
| library | staff, partner | no |
| brand-kits | staff, partner | no |
| jobs | staff, partner | no |
| approvals | staff, partner | no |
| actions | staff, partner | **no** - and **no suite switch either** |
| run | staff, partner | `all=1` is staff-only - **but no suite switch** |

`generate` is the only one of the seven that checks the marketing switch. `actions`
and `run` do not (§6(a)). `run` is the one that costs money.

A client or affiliate session gets 403 on all seven. A staff session must name a
`partner_id`; a partner session is locked to its own and a `partner_id` in the URL
is ignored rather than honoured or rejected - deliberately, so a prober cannot learn
whether a guessed id exists (`src/http/partner-read-api.mjs:103-115`).

**What is worth saying plainly:** "staff" here means *any employee*. There is no
distinction between an owner, an admin, a closer or a setter on any of these seven.
Any signed-in employee who names a partner can queue generation that spends money,
run it, and approve or reject that partner's creative. The one place a role is
checked in this whole area is the switch that turns the suite on, and that one is
owner-only.

Whether that is right is Chris's call, not mine. It is not the broken `roles:` shape
from §12; it is simply that no role gate was written.

---

# What Chris would click, and what would actually happen

In order, on a fresh install:

1. Opens Creative Factory, picks a partner. → **Every button is grey.** The allowance
   panel says the suite is off. Nothing on this page turns it on; the switch is on
   Brand Studio, and only the owner can flip it.
2. Suite on. Types a prompt, names the batch, presses **Enqueue generation**. →
   *"Saved to the queue, but it cannot run yet: no ad-making service is switched on
   for this account. The next try will be recorded as a failure and nothing will be
   made."*
3. Presses **Run queued jobs now**. → *"Tried 1 job: 0 worked, 1 did not. It did not
   work, and nothing was made. No ad-making service is switched on for this account,
   so there is nothing to make the work."*
4. Waits two minutes for the automatic runner instead. → Nothing happens, and
   nothing ever will, because of the unscoped query in §7. This was **measured** on a
   scratch database: as `fundhub_app`, `runDue` sees zero partners and runs zero jobs.
   (Still contingent on the live database role - see §7.)
5. Looks at the **Brand kits** panel. → Empty, permanently. Nothing in the product
   creates one.
6. Suppose all of that were fixed and a picture were made. Looks at the **library**. →
   Every tile reads **"no preview available"**. The file was never stored - not
   because there is nowhere to store it, but because creative never calls the file
   store the rest of the product uses (§2.7) - and the flag that would have said so
   is stripped from the reply.
7. Picks the **resize** option from the Kind dropdown. → Always fails. The resize
   provider needs a parent asset to derive from (`resize.mjs:26`), and the screen
   never sends one.
8. Presses **Reject** on a piece of creative that was already archived. → The screen
   says it worked. **Nothing changed.** The endpoint answers 200 and hands back the
   unchanged row (§6). Approve in the same spot correctly says no.
9. Suppose everything above were fixed and ads were being made. Looks for what to
   bill the partner. → **Nothing was recorded.** The function that writes a billable
   event is never called by anything in the product (§2.6). Money goes out to the
   vendor; nothing writes down that it should come back.

---

## Everything I could not settle

* **Which database role production connects as.** Decides whether the automatic
  runner is dead or fine on the live site. The mechanism itself is no longer a guess -
  it was measured on a scratch database (§7). What is still open is the live role.

  **Settle with `npm run guard:db`**, pointed at the same `DATABASE_URL` the app uses.
  It runs `src/security/superuser-guard.test.mjs`, whose query (lines 121-139) reads
  `current_user`, `n_super` and `n_bypassrls`, and it prints the role name in the pass
  line. Do not point this lane at the live database to get the answer.

  **An earlier version of this file said `/api/health` would settle it. It will not.**
  `api/health.mjs` and `src/http/health.mjs` never ask for `current_user`, `rolsuper`
  or `rolbypassrls`. Health only reports how many migrations are pending.
* **Whether the five `CREATIVE_*` / `ANTHROPIC_API_KEY` values are set in Netlify.**
  I was refused permission to read the local `.env` and did not query Netlify.
  Settle with: `netlify env:list --context production --plain`, names only.
* **Whether `creative_providers` is empty in the live database.** Confirmed no
  migration or seed inserts one; a human could have inserted a row by hand. Settle
  with: `SELECT * FROM v_creative_config_gaps` - it is built for exactly this.
* **Whether the whole test suite in this area currently passes.** Not measured. Two
  things were run for this lane, both on a scratch database and neither against
  production: `npm run guard:db` (3 of 3 pass) and a hand-written `runDue` proof.
* **Whether partner-approves-own-blocked-creative is intended.** That is a decision,
  not a fact, and it is Chris's.
* **Whether nobody-gets-billed (§2.6) is a "not yet" or a "forgotten".** The gate is
  built and correct; nothing calls it. Whether that was always the plan for this stage
  is a decision, not a fact.

---

## Change manifest

* **Files touched:** one, this file - `docs/ops/_lanes/2026-09-06-cf-endpoints.md`.
  No repo code, config, test or migration was modified. A throwaway Postgres database
  was created on this Mac to measure §7 and then deleted; the live database was never
  connected to.
* **Anything surprising:** the every-two-minutes runner runs nothing, and that is now
  measured rather than argued - as `fundhub_app` it sees zero partners, as a superuser
  it sees one. Second surprise: nobody gets billed. The function that records a
  billable creative event is built, correct, and called by nothing but a test file.
  Third: the file store this lane first said did not exist does exist and is in daily
  use elsewhere in the product - creative simply never calls it, which makes that a
  wiring job, not a build.
* **Anything I could not verify:** the live database role (settle with
  `npm run guard:db`, **not** `/api/health` - the earlier version of this file named
  the wrong check), whether the five provider API keys hold values, whether
  `creative_providers` is empty in production, and whether the wider test suite here
  passes. Each is listed above with the exact command that would settle it.
