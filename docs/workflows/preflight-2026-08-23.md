# Pre-flight — 2026-08-23

## Re-run after ship — 2026-08-24 ~05:00 UTC

Part 3 live test. Gates 1–4 re-checked against deploy `6d026fda…`. Expected sequence rewritten **before** booking. One book only after that.

**Safe to book: yes.** Gates 1–4 pass.

Checked at: 2026-08-24 ~05:00 UTC.

---

## Tonight’s commits (which is which)

Same table as the first check. **On live?** updated after the ship. Hashes were not invented.

**Booking lane** (same deploy as money; you can revert one without the other):

| Hash | What it does | On live? first check 04:22 | On live? re-run 05:00 |
|---|---|---|---|
| `f604e0c6` | CONFIRM counts like YES | **no** | **yes** |
| `19e8ac94` | Blank Where line omitted | **no** | **yes** |
| `fe041d47` | Cancel stops leftover jobs + Josh quiet hours | **no** | **yes** |
| `ae0f61d8` | dpc-02 writes `booking.noshow` 5 min after a missed call so S-05A can start. Cal.com file kept. One “not used in production” comment only. | **no** — local, not pushed | **yes** |
| `b8000636` | One book email; 365-day portal link inside confirm | (not in first table) | **yes** |
| `2c205d3f` | BS-01 pre-call at 48 hours before the call; skip if sooner | (not in first table) | **yes** |

**Money / pause lane:**

| Hash | What it does | On live? first check 04:22 | On live? re-run 05:00 |
|---|---|---|---|
| `a646cf74` | 5B.2 only — each success-fee payment goes to its own invoice | **no** | **yes** |
| `6d026fda` | 5B.1 pause recovery after a new negative | (not in first table) | **yes** — this is the live SHA |

First check: local was 5 commits ahead of origin. That is done. Live = origin = this laptop = `6d026fda9513bb37f43f5604e2bbf7f4f93739eb`.

---

## Held

Still held. Do not build these in this pass:

- ClickFunnels many `entry.captured` pings for one fill. Do not run a 10× ping test.
- Per-recipient timezone quiet hours
- `$0.81` / 21 closer rows: accepted. Not this job.

Items 5 and 6 from the first check **did ship** (`b8000636`, `2c205d3f`). They are no longer held.

`ae0f61d8` **is live** now. A missed call can start no-show recovery.

---

## 1. BUILD SHIPPED — **pass** (re-run)

| Where | SHA | Note |
|---|---|---|
| Live site | `6d026fda9513bb37f43f5604e2bbf7f4f93739eb` | Netlify production deploy `6a8bcd8cdad2ae000854037e`, ready at 2026-08-24 04:51:19 UTC. Branch `main`. Site `https://fundhub.ai`. |
| Origin `main` | `6d026fda9513bb37f43f5604e2bbf7f4f93739eb` | Same as live. Message: let staff recover a funding pause after a new negative. |
| Local HEAD | `6d026fda9513bb37f43f5604e2bbf7f4f93739eb` | Same. |

They match. Required ship SHA confirmed.

Live health: `ok`, database up. This deploy expects **193** files. Applied count on health is **195**. **0** waiting.

First check at 04:22 UTC had live `f5c77159…` and failed this gate. That row stays true for that time. It is not the live site now.

---

## 2. SIX-COPY PRECALL — **pass** (re-run)

Looked in `messages` for the last 30 days. Keys: `SMS-BS01-02-PRECALL` and `BS-FUND-*`.

Emails masked. Plus-tag and owner-test rows do not fail this gate.

**Real clients:** no one got the same SMS precall key more than once.

- 4 real people each have **one** `SMS-BS01-02-PRECALL`. Masked: `c…@dripdropinfusions.com`, `j…@amosjoneslawfirm.com`, `g…@protonmail.com`, `m…@gmail.com`.
- Those four have **zero** `BS-FUND-*` rows.

**Not counted as fail:**

- Plus-tag test inboxes: two people have **2** of the same SMS precall, and **2** of each fund email (two book pings).
- Owner live file (`9af65808…`, `s…@gmail.com`): **4** copies of `BS-FUND-D1-E1-morning` on 2026-08-22. Owner test. One SMS precall. Nine fund rows total on that file.

17 SMS precall rows in 30 days. 15 people. Only plus-tag tests have more than one SMS.

Same picture as the first check.

---

## 3. NO LEFTOVER JOBS — **pass** (re-run)

Inngest running / queued leftover booking jobs at 04:57 UTC: **0**.

No test leftover jobs to cancel. Did not cancel any real-client job.

Owner Monday 11:30 Phoenix books (`677659b6…`, `59797b31…`) were **not** canceled.

First check had canceled five plus-tag jobs from the 03:24 UTC test book. Those stay canceled.

---

## 4. FUNCTION LIST SYNCED — **pass** (re-run)

Did not PUT. List was already current after the ship. Did not unset keys. Inngest stays on.

| Fact | Value |
|---|---|
| App | `fundhub-platform` |
| URL | `https://fundhub.ai/api/inngest` (Fundhub, not another product) |
| Sync time | **2026-08-24 04:53:10.643548 UTC** |
| Sync result | `success` |
| Function count | **61** live = **61** in the committed serve list |

Sync is about 2 minutes after the live deploy at 04:51:19 UTC.

This laptop has an uncommitted extra job (`s-04c-staff-booked-alert`). That is **not** on live. Live is 61.

---

## 5. EXPECTED SEQUENCE — **rewritten before book**

Old 8-row list is stale. New code (this ship):

At book (already a lead):

- `SMS-S04-01-CONFIRM` sms — right away, unless 11pm–11am Eastern (then the text waits until 11am Eastern)
- `EMAIL-S04-01-CONFIRM` email — right away (portal link inside, 365-day single-use). **Not** `EMAIL-PORTAL-MAGIC-LINK`. **Not** BS-01 kickoff at book.
- Josh voice — right away, unless 11pm–11am Eastern (then waits until 11am, one call)

Anchored to **appointment start**:

- BS-01 precall (`SMS-BS01-02-PRECALL` + email grid) at **48 hours before** the call. If the slot is sooner than 48h, **these do not fire at all**.
- `SMS-S04-02-REMIND-24H` — 24 hours before the call
- `SMS-S04-03-REMIND-2H` — 2 hours before (KEEP)
- `SMS-AISET04-HANDOFF` — 15 minutes before (KEEP)

### Slot this pass will book

Written **before** submit.

| Field | Value |
|---|---|
| Page | `https://apply.fundhub.ai/funding-book-call` (`/book` 404s) |
| Identity | new `e2e+aff-*@fundhub.ai` (not the owner Monday 11:30 files) |
| Phone | `FUNDHUB_TEST_PHONE` (not printed) |
| Slot | **Tue, Aug 25, 2026, 3:00–3:30 PM Phoenix (MST)** |
| Slot UTC | `2026-08-25 22:00:00Z` |
| Slot Eastern | 6:00 PM Eastern — **outside** 11pm–11am Eastern |
| Book moment | ~05:00 UTC / **~1:00 AM Eastern** — **inside** quiet hours |
| Hours until slot | about **41 hours** (under 48h) |

Then they should get, in time order:

| # | Template key | Channel | When for THIS slot |
|---|---|---|---|
| 1 | `EMAIL-S04-01-CONFIRM` | email | right away (portal link inside). Dispatcher may take up to 5 min. |
| 2 | `SMS-S04-01-CONFIRM` | sms | **held until 11:00 AM Eastern Mon Aug 24** (quiet hours). Not right away. |
| 3 | Josh robot call | voice | **waits until 11:00 AM Eastern Mon Aug 24**. One call. No template key. |
| 4 | `SMS-S04-02-REMIND-24H` | sms | Mon Aug 24, **3:00 PM Phoenix** (24h before the call) |
| 5 | `SMS-S04-03-REMIND-2H` | sms | Tue Aug 25, **1:00 PM Phoenix** (KEEP) |
| 6 | `SMS-AISET04-HANDOFF` | sms | Tue Aug 25, **2:45 PM Phoenix** (KEEP) |

**Skip — do not fire at all on this slot:**

| Template key | Channel | Why |
|---|---|---|
| `SMS-BS01-02-PRECALL` | sms | Slot is sooner than 48h. New code skips. |
| `BS-FUND-*` / `BS-REPAIR-*` | email | New book. No funding/repair path. Not a kickoff at book. |
| `EMAIL-PORTAL-MAGIC-LINK` | email | Retired at book. Confirm email carries the year-long link. |
| Staff booked-call text | sms | Not on this live ship (uncommitted extra job). |

They should **not** get a second copy of any key above. If any template fires twice, **stop**. Do not book again.

ClickFunnels may still emit many `entry.captured` pings. Held. Do not treat that as this test. Welcome / finish-app / no-book chase can still multiply if those pings land. Once-per-client welcome lock should hold welcome to one.

---

## 6. BASELINE SNAPSHOT — **pass** (fresh, before this book)

`messages.id` is a uuid, not a number. Snapshot uses row count + newest row.

| Field | First check 04:22 | Re-run now |
|---|---|---|
| Row count | 548 | **548** (same; nothing new since first check) |
| Newest id | `0ee6a63d-e312-48ce-a86c-a5927fd0198e` | `0ee6a63d-e312-48ce-a86c-a5927fd0198e` |
| Newest created_at | `2026-08-24 03:45:32.337326+00` | `2026-08-24 03:45:32.337326+00` |

Taken before the Part 3 book.

---

## Score (re-run)

| # | Gate | Result |
|---|---|---|
| 1 | Build shipped | **pass** |
| 2 | Six-copy precall | **pass** |
| 3 | No leftover jobs | **pass** |
| 4 | Function list synced | **pass** |
| 5 | Expected sequence | **rewritten for Tue 3:00 PM Phoenix** |
| 6 | Baseline snapshot | **pass** — 548 / `0ee6a63d…` |

---

## First check (kept) — 2026-08-24 ~04:22 UTC

Read-only check. Did not book. Did not push. Did not deploy.

**Safe to book then: no.** Gate 1 failed. Live was `f5c77159…`. Local was ahead.

First-check live: Netlify deploy `6a8bb75d0332ff926c748d99`, ready 2026-08-24 03:16:46 UTC.

First-check leftover cancel: five plus-tag jobs from `booking.created` at 2026-08-24 03:24:45 UTC only.

First-check Inngest sync: 2026-08-24 03:18:21 UTC, 61 jobs, `duplicate`.

---

## 8. ACTUAL vs EXPECTED — after one book

Booked at ~05:02 UTC. ClickFunnels wrote the appointment at 05:03:43 UTC. Slot: Tue Aug 25, 2026, 3:00–3:30 PM Phoenix. Identity `e2e+aff-p3-…@fundhub.ai`. One submit. Tuesday 3:00 PM is gone from the live calendar.

**One** `booking.created` (start `2026-08-25T22:00:00Z`). **Ten** `entry.captured` (held ClickFunnels many-ping — not this test). No booking template fired twice. Stopped watching after that.

| Template key | Channel | Expected | Actual (minutes after booking.created) |
|---|---|---|---|
| `EMAIL-S04-01-CONFIRM` | email | right away | **queued +0.4 min, sent +1.3 min.** Subject names Tue Aug 25, 3:00. |
| `SMS-S04-01-CONFIRM` | sms | held until 11:00 AM Eastern | **queued +0.3 min. Send time set to 15:00 UTC (11:00 AM Eastern).** Not sent yet. |
| Josh | voice | wait until 11:00 AM Eastern | **Job running. Zero phone calls placed after this book.** |
| `SMS-BS01-02-PRECALL` | sms | skip (under 48h) | **zero rows.** |
| `EMAIL-PORTAL-MAGIC-LINK` | email | skip | **zero rows.** |
| `BS-FUND-*` | email | skip | **zero rows.** |
| `SMS-S04-02-REMIND-24H` | sms | Mon 3:00 PM Phoenix | not due yet |
| `SMS-S04-03-REMIND-2H` | sms | Tue 1:00 PM Phoenix | not due yet |
| `SMS-AISET04-HANDOFF` | sms | Tue 2:45 PM Phoenix | not due yet |

Also queued from the ten capture pings (not the book list): `EMAIL-S00-WELCOME` once (provider later marked bounced — fake `fundhub.ai` inbox) and `SMS-S00-WELCOME` once (held until 11:00 AM Eastern). Welcome lock held. Not a double.

**Could not verify on a real phone or a real inbox.** The book identity is `e2e+aff-*@fundhub.ai`. Welcome mail to that address bounced. Confirm mail is `sent` to the same fake inbox. Texts wait until morning Eastern. I did not look at Chris’s phone.

Messages table: 548 before → **552** after (four new rows).
