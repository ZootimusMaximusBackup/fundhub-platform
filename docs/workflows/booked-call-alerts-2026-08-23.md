# Booked-call alerts + source tags — 2026-08-23

Owner go: run website-vs-funnel tag audit and booked-call text plan in two threads.

**Other thread:** comms logic map / comms build (`docs/workflows/comms-logic-2026-08-23.md` and slices). Do not edit those files. Do not edit app messaging code they may be touching. Read them. Do not rewrite them.

This board is findings + plan only. No app code in this batch.

---

## Tasks

| id | workflow | owner | status | notes |
|---|---|---|---|---|
| source-tags | 1 — website vs funnel labels | this thread | done | Labeled on the person as `channel_source`. Not a CRM tag. |
| booked-call-sms-plan | 2 — booked-call text plan | this thread | done | Built. Switch on Staff & Teams. Not live until ship. |
| pipeline-msg-links | 3 — pipeline phone/email → messaging + unread badge | this thread | done | Built. Not live until deploy. |

---

## Shared brief

- Main site: `https://fundhub.ai`
- Funnel: `https://apply.fundhub.ai`
- Book page in comms map: `https://apply.fundhub.ai/funding-book-call` (ClickFunnels)
- Known capture doors (from comms map): ClickFunnels webhook, homepage survey, pipeline “New Client”
- Owner ask: (1) are website leads labeled vs funnel? (2) text Chris, closer, and sales manager on booked call, with name / phone / email / credit / survey / context, each can turn it off
- Owner ask add (2026-08-23): on the pipeline, click phone or email → that person’s messaging page. Red Apple-style alert if there are unread messages. Same for email.

---

## Hands off (other thread)

Do not edit:

- `src/adapters/clickfunnels.mjs`
- `src/workflows/s-00-welcome.mjs`
- `src/workflows/s-04-*.mjs` and other booking comms jobs
- `src/messaging/**` send path
- `docs/workflows/comms-logic-2026-08-23*.md`

Read those if you need ground. Write findings here only.

---

## Manifest: source-tags

**Check:** When a lead comes from the main website, are they labeled website vs funnel?

**Journey intended:** `docs/journeys/client-intended.md` does not name a website-vs-funnel label. This check uses Chris’s 2026-08-23 ask, not an invented journey step.

### Answer

They are **labeled**, not **tagged**.

| Door | Label stored | CRM tag |
|---|---|---|
| Main site survey (`fundhub.ai`) | `channel_source` = `website:home` | none for source — only `lead:new` |
| Funnel (`apply.fundhub.ai` / ClickFunnels) | `channel_source` = `clickfunnels` | none for source — only `lead:new` |
| Pipeline “New Client” | `channel_source` = `pipeline` | same |

### Where it is set

- Website form sends `source: "website:home"` (`public/js/homepage-survey.js`).
- Website API defaults to `website:home` if missing (`api/public/survey-submit.mjs`).
- Funnel webhook always sets `source: "clickfunnels"` (`src/adapters/clickfunnels.mjs`).
- First time we create the person, that value is written to `clients.channel_source` (`src/handlers/client-lifecycle.mjs` `resolveClient`).
- Tags added on capture: `lead:new` only. No `website` / `funnel` tag.

### First door wins

If the person already exists, a later funnel ping does **not** change `channel_source`. Phone and name can fill in. The source label stays what it was on create.

### Live proof (read-only, 2026-08-23)

`clients` where not demo:

- `clickfunnels` — 41
- `website:home` — 11
- `commas` — 26
- empty — 22
- other test/tool labels — a few

`clients.tags`: **0** people have a tag that says website, funnel, or clickfunnels.

Last 14 days, capture events by `payload.source`:

- funnel `clickfunnels`: 510 entry + 277 survey
- website `website:home`: 13 entry + 13 survey

### Where a human can see it

- Sales floor source rollup and closer-call “Lead source” can show `channel_source` (or a UTM if one exists).
- Pipeline page does **not** print `channel_source`. It is not a chip on the card.

### Score

| Check | Result |
|---|---|
| Website leads are labeled as website (`channel_source = website:home`) | **PASS** — code + live rows |
| Funnel leads are labeled as funnel (`channel_source = clickfunnels`) | **PASS** — code + live rows |
| Website vs funnel is a CRM **tag** | **FAIL** — no source tag exists |
| Pipeline card shows website vs funnel | **FAIL** — field stored, not shown there |

No app files edited. Hands off comms-logic board.

---

## Manifest: booked-call-sms-plan

Status: **plan done. No code. Waiting for go.**
Date: 2026-08-23
**COMPLIANCE REVIEW REQUIRED** — the text would include credit info.

Other thread still owns client texts and the send pipe. This plan does not edit those files.

---

### What I found (short)

There is **no staff text today** when a call is booked.

What already fires on `booking.created` (the “they picked a time” event):

- A **confirm text and email to the client** (`s-04b-booking-reminders.mjs`)
- A **Josh robot call to the client’s phone** (`ai-set-01-josh-setter.mjs`) — not a text to Chris or the closer
- A closer **to-do with no person on it** (`src/handlers/comms.mjs`) — role `closer`, person id empty
- Pipeline tag `call:booked` (`s-04-call-booked.mjs`) — no text

Chris / the closer / the sales manager do **not** get a text.

---

### Builder Step 1 gate

**1. Role** — Three people get the **same** text: owner (Chris), the closer on that call, the sales manager. Not a new screen. Not three different texts.

**2. One job** — When a call is booked, text those people the lead’s name, phone, email, credit, survey answers, and extra context — only if they turned this on.

**3. First question** — “Did someone just book, and who are they?” The text answers that. Biggest line: name + when the call is.

**4. Reuse**

- Event: `booking.created` (ClickFunnels calendar; Cal.com can also fire it, not the live book page)
- Staff phone already on `staff.phone` (Staff & Teams). Comment on that column: not used for outbound texts today.
- Survey answers already stored: `cf_svy_*` on `client_custom_fields` (and `clients.custom_fields`)
- Self-reported credit: `cf_svy_self_reported_fico` (“Your Current Score”)
- Company send pause: `messaging_settings.outbound_enabled` (do not invent a second company switch)
- Pattern for “text staff, not the client”: table `owner_notifications` (finance alerts). **It queues. It never sends.**
- Do **not** reuse `sendTemplated` as it is: it always addresses the **client** phone, and a client who opted out of texts would **block** the staff ping

**5. Data**

| Need | Exists? |
|---|---|
| Name, phone, email | Yes — client + booking payload |
| Call time | Yes — `startTime` on the event |
| Survey answers | Yes — `cf_svy_*` (amount, use, score they told us, business, income, why, etc.) |
| Credit they typed | Yes — `cf_svy_self_reported_fico` |
| Bureau / CRS score | Usually **no** at book time. Soft pull is later. Do not invent a score. |
| Extra context | Some — tags, notes, source, appointment time. Full agent memory (`fetchContext`) is too long for a text. |
| Owner phone | Yes if Chris’s `staff.phone` is filled |
| Sales manager | Yes — every active staff row with role `sales_manager` |
| Closer **on this call** | **No.** Task is unclaimed. ClickFunnels host is **dropped** on the way in. Round-robin columns exist (`assignment_order`, `last_assigned_at`) but **nothing assigns**. Owner-set closer identity in sales math is Chris Stanbridge / chris@fundhub.ai — that is for numbers, not booking. |
| Per-person on/off | **No.** Nothing like this exists. |
| Route for the switch | **No.** Staff & Teams is owner / admin / sales manager only. A closer cannot open it. |

New things this needs (Chris did not name the exact names). **Listed. Not built. Waiting.**

- New setting: `staff.notify_booked_call_sms` (true/false, **default off**)
- New route so each person can flip **their own** switch (a closer cannot use Staff & Teams)
- A send path that texts **staff.phone**, not the client, and does **not** use the client’s text opt-out

**6. Files** (later build only — not this pass)

Create:

- `db/migrations/<next>_staff_notify_booked_call_sms.sql`
- `db/seed/<next>_sms_staff_booked_call.sql` (staff template key, compliance-gated)
- `src/workflows/s-04c-staff-booked-alert.mjs`
- `src/workflows/s-04c-staff-booked-alert.test.mjs`
- `src/staff/booked-call-alert.mjs` (who gets it + body)
- `src/staff/booked-call-alert.test.mjs`
- `api/staff/me-booked-call-sms.mjs` (self on/off) — **new route, wait**

Touch:

- `src/workflows/index.mjs` (register the new job only)
- `public/app/staff-teams.html` (switch next to Phone, for owner/admin)
- One line on the screens those people already use so a closer can flip their own: `public/app/closer-dashboard.html`, `public/app/sales-floor.html`, owner home — **wait; Chris did not name these pages**
- Journey `-actual.md` + changelog if a staff journey shows the switch

Do **not** touch (other thread / not asked):

- `src/adapters/clickfunnels.mjs`
- `src/workflows/s-00-welcome.mjs`
- `src/workflows/s-04-*.mjs` and other booking **client** jobs
- `src/messaging/**` send path
- `docs/workflows/comms-logic-2026-08-23*.md`
- `## Manifest: source-tags` on this board
- `## Manifest: pipeline-msg-links` on this board

**7. Risk**

Could break: client confirm texts (if we edit S-04B — we will not); double staff texts if ClickFunnels fires `booking.created` twice; client opt-out blocking staff if we misuse `sendTemplated`; credit facts in a text (compliance); Chris getting two texts if he is owner and closer.

Proves it did not: tests that the new job queues **zero** client rows; switch off = no staff text; switch on + phone = one text per person; same person in two roles = **one** text; missing closer host still texts owner + sales manager who opted in; replay of the same booking id does not send again.

---

### On / off switches (exact)

| Who | What they see | Default |
|---|---|---|
| Owner (Chris) | “Text me when a call is booked” | **Off** |
| Closer | Same switch, for themselves | **Off** |
| Sales manager | Same switch, for themselves | **Off** |

Optional. They do not have to use it.

Need a phone on their Staff & Teams row. No phone = skip that person. Do not fail the booking.

Company send pause (`messaging_settings.outbound_enabled`) still applies. Dry-run fence still applies.

Do **not** hold this for client quiet hours (11pm–11am Eastern). This is a staff ping about a new book. If they hate night texts, they leave the switch off.

Do **not** use the **client’s** “stop texts” flag. That flag is for the lead, not for Chris.

---

### Who is “the closer on that call”?

**Owner-set 2026-08-23:** There is only one closer. No round robin. That closer is assigned to **every** booked call.

Today that person is Chris Stanbridge. Soon it will be someone else. The text goes to whoever is the active closer **at book time** (staff row with role `closer`, switch on, phone on file) — not a hardcoded Chris forever, not every closer if more than one exists later.

Dedupe: if Chris is owner and closer, he still gets **one** text.

Do not build round-robin. The unused rotation columns stay unused.

---

### What the text will say (draft)

Skip any question they did not answer. No source / context line.

Every stored survey question (not just a few) — titles from the survey map.

```
🔥 YOU'RE UP — new book

Jane Doe
Tue, Aug 25, 2026, 2:00 PM MST
555-123-4567
jane@email.com

Set Your Target Amount
$50k - $100k

Planned Use
Growth (marketing, inventory, hiring)

What Would This Money Change Right Now?
Peace of mind (stop stressing about cash), Grow faster (more customers / more reach)

Your Current Score
580-649

Do You Have a Business?
Yes, 1-2 years

Annual Business Revenue
$250k - $499k

Can You Verify Revenue?
Yes, both

Available Capital
$5k - $25k
```

Personal-income questions only show if they picked personal funding. Unanswered questions stay off the text.

**COMPLIANCE REVIEW REQUIRED.** Credit they typed still counts as credit info. Bureau scores stay out unless a pull already exists — at book time it usually does not.

---

### How we send (reuse, do not hijack client texts)

Do **not** put this on the client confirm job.

New job `s-04c-staff-booked-alert` listens to `booking.created` only (not reschedule, unless Chris asks later).

Queue a staff text to `staff.phone`. Same Twilio pipe the app already has, **new destination**. Do not go through `sendTemplated`’s client address.

Dedupe: one text per staff person per booking id. If ClickFunnels double-fires the same email + same start time, the second `booking.created` is already skipped in the adapter; mismatched times can still double — same known defect as Josh / confirm. Do not try to fix that in this job.

If they cancel later, we do not un-send. Same as Josh.

---

### How we prove it (after go — not now)

1. Unit tests on the new job (switch off, no phone, role overlap, no client row, replay).
2. `npm test` for those files. Do not weaken anything.
3. Do not book a live lead in the plan pass.
4. After build: one test book with the switch **on** for Chris only, then off again. Look at his phone. Closer and sales manager stay off until they opt in.
5. Check the client still only gets the normal confirm text, not this staff copy.

---

### Wait list — decided, then built

1. New column `staff.notify_booked_call_sms` default **off** — **built** (`258`)
2. New self-switch route — **not needed.** Owner-set: Staff & Teams only.
3. Where the switch lives — **Staff & Teams** (owner-set 2026-08-23)
4. Who is the closer — **one closer, all calls.** Role `closer` when present; owner also gets it if their switch is on (Chris today).
5. Credit in the text — owner asked for it. Label stays `COMPLIANCE REVIEW REQUIRED`.

Built 2026-08-23. Not on the live site until a deploy. Migration is not applied until production deploy.

---

## Manifest: pipeline-msg-links

**Status:** built 2026-08-23. Screen + pipeline read tests green. Not on the live site until a deploy.

Cannot split from the booked-call text work — different page. This one is one workflow (same card, same page).

### What is true today

- Pipeline **cards do not show** phone or email. The API already sends both (`api/dashboard/pipeline.mjs`).
- Click a card → right drawer. Phone is there with a **Text** button (not the number itself). Email is plain text.
- Text button goes to `messaging.html?client_id=…` and always opens the **text** thread.
- There is no unread badge on the pipeline.
- We do **not** have an iMessage-style unread count. We have `needs_reply`: they wrote last, we have not answered.

### Plan gate

1. **Role** — closer / sales manager / owner looking at the pipeline board. Same cards for all staff.
2. **One job** — from a card, jump to that person’s messages, and see a red alert if they are waiting on a reply.
3. **First question** — “Does this person need a text or email back?” Badge answers that. Click answers “talk to them.”
4. **Reuse** — existing `messaging.html?client_id=` deep link. Existing inbox `needs_reply`. Existing card click (drawer). Existing `--alert` red token.
5. **Data** — phone + email already on the pipeline payload. Unread flags are **not**. Add two fields on the **existing** pipeline read: `sms_needs_reply` and `email_needs_reply`. No new route. No new table.
6. **Files**
   - `api/dashboard/pipeline.mjs` — add the two flags
   - `src/http/pipeline.pg.test.mjs` — prove the flags
   - `src/http/pipeline-screen.test.mjs` — prove card links + badge
   - `public/app/pipeline.html` — show phone + email on the card; click goes to messaging; red badge; drawer email matches
   - `public/app/messaging.html` — honor `?channel=email` or `?channel=sms` (today it always prefers SMS)
7. **Risk** — a click on the number must not also open the drawer. Prove: click phone → messaging URL, drawer stays closed. Click the rest of the card → drawer still opens.

### What you will see

On each card, under the name:

- The phone number. Click it → messaging, **Text** side, that person.
- The email. Click it → messaging, **Email** side, that person.
- If they wrote last on that channel and nobody answered: a small **red circle** on that line (Apple / Facebook style). If they wrote last, the badge says **1**. We will not invent a bigger count — we do not store one.

Same links in the drawer: click the number or the email, not only a side button.

### Hands off

Do not edit ClickFunnels, welcome jobs, booking comms jobs, or `src/messaging/**` send path. Other thread owns those.

### Prove

- `npm test` for the pipeline files named above
- Live: open pipeline, click a phone, land on that client’s text thread. Click an email, land on their email thread. A person who wrote last shows a red badge.

**COMPLIANCE REVIEW REQUIRED:** no. This does not change credit copy, fees, or outbound send.

Waiting for GO.

---

## Ship status (2026-08-23)

| Item | Status |
|---|---|
| Migration 258 + seed 017 | In commit; applies on **production Netlify deploy** only |
| S-04C Inngest (`booking.created`) | In commit |
| Staff & Teams switch + owner phone save | In commit |
| Pipeline phone/email → messaging + needs-reply badge | In commit |
| Live deploy | Pending push + `netlify deploy --build --prod` |
| Live Playwright 100/100 | Pending deploy |

**COMPLIANCE REVIEW REQUIRED** — staff SMS includes typed credit score and pay lines.

**Chris manual once live:** Staff & Teams → your row → add phone → flip **Text when a call is booked** on → Save.
