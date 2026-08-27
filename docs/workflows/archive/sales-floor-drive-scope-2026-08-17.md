# Sales Floor + Google Drive — what it would take

Date: 2026-08-17
Batch: `docs/workflows/offer-stack-2026-08-17.md` (task W4)
This is a report. Nothing was built. No code changed.

---

## The short answer

**It is already built.** The Sales Floor screen already has Google Drive access, all the way
through, today. The code is real and it is wired end to end.

It is not switched fully on. What is missing is not code. It is two settings in Google, one
setting in Netlify, and a test run that nobody has ever done.

There is one real danger, and it has nothing to do with the Sales Floor. There is **one Google
account for the whole platform, not one per company**. That is fine while there is one company.
It breaks the moment there are two. More on that in section 3.

---

## 1. What already exists

### The Drive connection is real code, not a name that says "drive"

I checked every file you asked about. Here is what is actually there.

| File | What it really does |
|---|---|
| `src/company-brain/config.mjs` | Reads the Google login details out of settings. |
| `src/company-brain/auth.mjs` | Signs a message with a private key and trades it with Google for a temporary pass. Real. It talks to `oauth2.googleapis.com`. |
| `src/company-brain/drive-client.mjs` | Real calls to Google Drive. Lists files, reads files, downloads files, and asks Google "what changed since last time." Read-only — it never writes, deletes, or moves anything. |
| `src/company-brain/walk.mjs` | Scans every file in the Drive once. |
| `src/company-brain/sync.mjs` | The catch-up pass. Remembers where it stopped and picks up only what changed. |
| `src/company-brain/store.mjs` | Saves what it found into the database. |
| `src/company-brain/mime.mjs` | Decides how to read each kind of file. Video and audio are **never downloaded** — only the name and the link are saved. That matters: Meet recordings stay in Drive. |
| `src/sales/recordings.mjs` | Lists Meet recordings **for the sales manager**. Matches a file name to a client, then stamps the Drive link onto that client's call record. |

There is **no Google software package installed**. The team wrote the Google connection by hand
using tools already built into the server. Nothing new was added to the project to do it.

### The Sales Floor screen is already plugged in

This is the part that surprised me. The chain is complete:

1. `src/sales/metrics.mjs` line 434 — the Sales Floor data builder already calls the recordings
   list and returns it.
2. `api/read/sales-floor.mjs` — the address the screen calls. It sends the recordings back.
3. `netlify/functions/api.mjs` — both addresses are on the routing list, so they work when
   deployed. (This repo has a known trap where a file exists but has no address. Not the case here.)
4. `public/app/sales-floor.js` lines 194–223 — already draws the "Today's recordings" panel,
   already shows an **"Open in Drive"** link for each one, and already has a **"Refresh from
   Drive"** button.
5. That button calls `api/company-brain/sync.mjs`, which runs the catch-up pass.

The plain text you see in `public/app/sales-floor.html` line 260 — *"Meet recordings land in
Google Drive. This list fills after Drive is connected."* — is a placeholder. The page script
replaces it with the real list as soon as there is one.

### Things that only *look* like Drive

- `src/chat/platform-help.mjs` line 41 — the word "drive" is one search word on a help topic
  card. It is not a connection to anything.
- `public/app/sales-floor.html` lines 9–11 — those point at Google's font service. Fonts, not files.

---

## 2. What is missing

Very little, and almost none of it is code.

### Missing thing 1 — the Google account setting that makes files visible

There are two settings:

- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` — **this one is set** on the live site. The repo's own
  audit records confirm it (`docs/workflows/e2e-verify-run5-evidence/`).
- `GOOGLE_DRIVE_DELEGATE_EMAIL` — **this one is not set.** It is optional, but the choice has a
  big effect.

Here is what that second setting does, in plain terms. The system logs in as a **robot account**,
not as a person. Without that setting, the robot can only see files that somebody **explicitly
shared with the robot's own email address**. If nothing was shared with it, the robot logs in
fine and sees an empty Drive. The screen would then honestly say "no recordings," and everyone
would think it was broken when it was actually just empty.

With that setting filled in, the robot borrows one real staff member's view of Drive and sees
everything that person sees. That requires a Google Workspace admin to approve it once.

**Nothing in the repo records which of these two paths was chosen.** That absence is the finding.

### Missing thing 2 — nobody has ever proven a sync actually ran

The repo's own audit file says it plainly: *"Sync run not proven."* The code exists, the settings
mostly exist, and no human has ever clicked "Refresh from Drive" against the live site and watched
a real file appear.

That is a ten-minute check, not a build.

### Missing thing 3 — text search needs a key that is not set

`OPENAI_API_KEY` is not set. It is used to make written documents searchable.

This does **not** block the recordings panel. Recordings are video, and video is saved as name
plus link only — no search needed. So the Sales Floor recordings list works without it. The
wider "search all company documents" feature does not.

### Not missing — things you might expect to need but do not

| Thing | Status |
|---|---|
| A sign-in flow where a person clicks "Connect my Google account" | **Not needed and does not exist.** The system uses a robot account instead. That is a deliberate choice, written down in `docs/COMPANY-BRAIN-BUILD-SPEC.md`. |
| A table to store Google passwords or tokens | **Does not exist and is not needed today.** The login details live in settings, not the database. The one table that exists, `brain_drive_sync`, holds only a bookmark — Google's "you were here last time" marker. Not a credential. |
| New web addresses (endpoints) | **None needed.** Both already exist and are routed. |
| New database tables | **None needed** for the recordings panel. |
| Permission by job role | **Already done.** Only `owner`, `admin`, and `sales_manager` can reach either address. Enforced in both files. |
| Permission by company | **Done in the code, not in the database.** See the next section. This is the weak spot. |

### One small thing worth a look

In the local `.env` file, the Google login value is wrapped in single quote marks. Most loaders
strip those automatically, so it probably works. But if the quotes ever survive, the system reads
it as broken text and quietly reports "not configured" instead of saying why. Worth one glance
during the proving run. This affects the local machine only — the live site uses its own settings.

---

## 3. The multi-tenant risk — read this part

"Multi-tenant" means more than one company shares the same software and the same database. Their
data must never mix.

There are **three separate ways** one company's staff could end up seeing another company's files.

### Risk 1 — one Google account for everybody (the biggest one)

There is exactly **one** set of Google login details for the entire platform. I searched the whole
database schema: there is **no table anywhere that stores a Google account per company.**

So if Company A and Company B both use this software, and both press "Refresh from Drive," both
of them scan **the same Google Drive** — the platform owner's. The same files get copied twice,
once labeled Company A and once labeled Company B. Both sales managers then see them.

This is not a bug that might happen. It is how the system is built right now. It is harmless while
there is one company. It leaks on the day there are two.

### Risk 2 — the database has no safety net on these tables

There is a database feature that hides other companies' rows automatically, even when the code
forgets to ask for the right ones. It is called row-level security. Think of it as a second lock
that does not depend on anyone remembering.

**The three Drive tables do not have it.** I checked: `brain_files`, `brain_chunks`, and
`brain_drive_sync` have no such rule. The only thing keeping companies apart is that a person
typed "only this company's rows" into each query by hand.

Nineteen other tables in this system do have that second lock (see `db/migrations/045`). These
three do not. `db/migrations/104_app_role.sql` was the work that made those locks actually
function — but a lock only helps a table it was installed on.

Plain-English failure: someone adds one new query to the Sales Floor next month and forgets the
"only this company" line. Nothing warns them. Nothing fails. A second company's sales manager
opens the Sales Floor and sees the first company's call recordings and client documents.

### Risk 3 — no test would catch it

There is a test that hunts for exactly this kind of leak: `src/http/cross-org-isolation.pg.test.mjs`.
It only checks addresses that carry a specific client's ID in the web address. The Sales Floor
address does not carry one. **So the Sales Floor is never tested for cross-company leaks.**
Neither are any of the Drive tables.

### One thing that is safe

The part that guesses which client a recording belongs to only looks at clients inside the same
company. That piece is correctly scoped.

### What would fix all three

- Give each company its own Google account details, stored encrypted in a new table.
- Put the second lock on all three Drive tables.
- Add the Sales Floor to the leak test.

None of that is needed today with one company. All of it is needed before a second one.

---

## 4. The rule about calling the outside world

`CLAUDE.md` §12 says new outgoing internet calls are allowed **only** inside
`src/messaging/providers/`. Nowhere else.

The repo enforces this with a test that reads the entire codebase and fails the build if any file
can reach the internet without permission: `src/lib/no-unfenced-transmit.test.mjs`. Everything
must go through one single gate, `src/lib/outbound-fetch.mjs`, or be named on a written list with
a written reason.

### What this means for Drive work

The Drive files are **already on that written list**, with reasons already recorded:

- `src/company-brain/auth.mjs` — "Exchanges a Google refresh token for an access token. Internal
  infrastructure."
- `src/company-brain/drive-client.mjs` — "Reads company documents out of Google Drive. Read-only,
  staff-facing."
- `src/company-brain/sync.mjs` and `src/company-brain/walk.mjs` — these two only hand the ability
  along. They never call out themselves.

So the constraint is simple and strict:

**Any new call to Google must go inside `src/company-brain/drive-client.mjs`, which is already
approved — or behind a new module in `src/messaging/providers/`.**

It may **not** be added to `src/lib/`, `src/handlers/`, `src/mail/`, to any file under `api/`, or
to a page script in the browser. A new file that calls Google directly makes the test suite fail.
That is by design.

### The three grandfathered exceptions — not precedent

`CLAUDE.md` §12 names three places that broke this rule before the rule existed. They are allowed
to stay. They must **never** be pointed at to justify a fourth:

1. `src/adapters/lendflow.mjs` — submits a funding application.
2. `src/workflows/ds-02-diy-letters.mjs` — sends do-it-yourself dispute letters out for delivery.
3. `src/workflows/c-06-crs-results-router.mjs` — sends the funding letter pack to the same
   delivery service.

Honest note: the written list in the test file is longer than three entries. It is a reviewed list
where each item required someone to write down a reason — not a free pass. Adding to it is a
decision, not a detail.

---

## 5. What would a sales manager actually use Drive for?

The repo gives exactly **one** answer, and says it in three separate places.

**Google Meet call recordings.**

- `public/app/sales-floor.html` line 260: *"Meet recordings land in Google Drive. This list fills
  after Drive is connected."*
- `src/sales/recordings.mjs`, first line: *"Meet recordings live in Google Drive. This module
  lists them for the sales manager and stamps the Drive link onto the matching call / interview
  row. Files stay in Drive — we only store the link."*
- `src/sales/metrics.mjs`: *"No Meet recordings yet. Click Record in Google Meet; the file lands
  in Drive."*

The job it does for a manager: a closer runs a sales call on Google Meet and hits Record. The file
lands in Drive. The Sales Floor lists it, works out which client it belongs to from the file name,
and puts an "Open in Drive" link on that client's call record. The manager can then listen to any
call from one screen instead of hunting through folders.

### What the repo does NOT tell me

The intended journey file, `docs/journeys/role-sales-manager-intended.md`, **says nothing at all**
about Drive, recordings, Google, or Meet. I checked the whole file. It is a list of which web
addresses this role may and may not reach — nothing more. The same is true of the `-actual`
version.

**This is a gap and I am reporting it rather than filling it.** The code does something the
intended journey never describes. Per `CLAUDE.md` §4, that is a finding, not something to quietly
reconcile.

Beyond call recordings, **the repo does not say what else a sales manager would use Drive for.**
I am not going to invent one.

One related fact, not a guess: there is a separate screen, Company Brain
(`public/app/company-brain.html`), which is the general "search all company documents" surface.
A sales manager can already reach it. That is a different screen from the Sales Floor.

---

## 6. Size

### If the goal is "turn on what is already there": **SMALL**

- New files: **zero**
- Database changes: **zero**
- New web addresses: **zero**
- New outside software: **zero**

The work is: decide the Google visibility approach, set at most one setting, run one deploy, click
"Refresh from Drive" once, and confirm a real recording appears. Then update the sales-manager
journey document to describe the recordings step, which it currently omits.

Reason it is small: every piece of code already exists and is connected.

### If the goal is "safe for more than one company": **MEDIUM to LARGE**

- New files: roughly **five to eight**
- Database changes: **at least two** migrations — one for per-company Google details, one to put
  the second lock on the three Drive tables
- Plus a settings screen so each company can connect its own Google account
- Plus adding the Sales Floor to the cross-company leak test

Reason it is bigger: this is not a screen change. It changes how the system is shaped — from one
shared Google account to one per company — and it touches the database's security rules. Being
wrong here means one company reads another company's files, which is the worst failure this
product can produce.

---

## Findings summary

1. Drive access on the Sales Floor is **already built and wired**, front to back.
2. `GOOGLE_DRIVE_DELEGATE_EMAIL` is not set, and the repo does not record whether that was on
   purpose. Without it the robot may see an empty Drive.
3. Nobody has ever proven a live sync ran. The repo says so itself.
4. **One Google account serves every company.** No per-company Drive setting exists anywhere.
5. The three Drive tables have **no database-level company isolation**. Code-only.
6. **No test checks the Sales Floor for cross-company leaks.**
7. The sales-manager intended journey **does not mention Drive or recordings at all**, though the
   code does. Documentation gap.
