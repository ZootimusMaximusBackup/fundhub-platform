# Fundhub — Missing Message Copy
**Draft for Chris's approval. Nothing here is wired yet.**
Written 2026-08-22. Voice matched to existing approved Fundhub templates.

Rules applied throughout:
- Fundhub submits to lenders. Never implies Fundhub funds anyone.
- No score guarantees, no outcome promises.
- Every SMS ends `Reply STOP to opt out.`
- Only merge tags already in use by live templates.

Merge tags used: `{{contact.first_name}}` · `{{custom_values.booking_link}}` · `{{custom_values.portal_link}}` · `{{CLIENT_PORTAL_URL}}` · `{{appointment.start_time}}` · `{{reschedule_link}}` · `{{invoice_number}}` · `{{balance_due}}` · `{{custom_fields.funding_round_number}}` · `{{sender_name}}` · `{{unsubscribe}}`

---

## A. Welcome — fires on `entry.captured`

### `EMAIL-S00-WELCOME`
**Channel:** email · **Timing:** immediate

**Subject:** You're in — here's what happens next

```
Hey {{contact.first_name}},

You're in. Here's how this works.

Fundhub looks at your credit profile the way a lender does — structure, timing,
and sequence, not just the score. Then we tell you what's realistically fundable
right now and what needs to be fixed first.

Two steps from here:

1. Finish your application so we can see the full picture
2. Book a call so we can walk you through what it means

Start here: {{custom_values.booking_link}}

If you already did both — nothing to do. We'll be in touch.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `SMS-S00-WELCOME`
**Channel:** sms · **Timing:** immediate

```
Hey {{contact.first_name}}, it's Fundhub. Got your info. Next step is a quick call so we can show you what your profile actually supports: {{custom_values.booking_link}} Reply STOP to opt out.
```

---

## B. No-Book Chase Emails — fires on `survey.submitted`, stops on booking

Pairs with the three existing texts (`SMS-NOBOOK-01/02/03`) at the same intervals.

### `EMAIL-NOBOOK-01`
**Channel:** email · **Timing:** +2h

**Subject:** Your file is ready — the call isn't booked yet

```
Hey {{contact.first_name}},

Your application is in and we can see your profile.

What we can't do is tell you what it means until we get you on a call. That's
the part where we go through what's fundable now, what isn't, and what order to
do things in.

It takes about 30 minutes.

Grab a time: {{custom_values.booking_link}}

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `EMAIL-NOBOOK-02`
**Channel:** email · **Timing:** +24h

**Subject:** The order matters more than the score

```
Hey {{contact.first_name}},

One thing we see constantly: two people with nearly identical profiles get
completely different results.

Usually it comes down to sequence — which applications went out, in what order,
how close together, and what was on the file at the time.

That's what the call covers. Your file, your sequence, what to do first.

{{custom_values.booking_link}}

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `EMAIL-NOBOOK-03`
**Channel:** email · **Timing:** +72h

**Subject:** Closing this out unless you want the call

```
Hey {{contact.first_name}},

Last note from me on this.

Your application is still on file. If you want us to walk you through it, the
calendar is open. If the timing isn't right, no problem — it'll be here when
it is.

{{custom_values.booking_link}}

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

---

## C. No-Show Recovery — fires on `booking.noshow`

Touch 1 already exists (`EMAIL-S05A-NOSHOW-RECOVERY` / `SMS-S05A-NOSHOW-RECOVERY`, immediate).
These are touches 2–4.

### `SMS-S05A-NOSHOW-02` · `EMAIL-S05A-NOSHOW-02`
**Timing:** +24h

**SMS:**
```
Hey {{contact.first_name}}, Fundhub again. We held your spot and your analysis is still sitting here. Pick a new time and we'll go through it: {{reschedule_link}} Reply STOP to opt out.
```

**Email subject:** Still holding your analysis

```
Hey {{contact.first_name}},

We missed you yesterday. Your file is still here and nothing's changed on our end.

Pick a time that actually works and we'll go through it:
{{reschedule_link}}

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `SMS-S05A-NOSHOW-03` · `EMAIL-S05A-NOSHOW-03`
**Timing:** +72h

**SMS:**
```
Hey {{contact.first_name}}, quick one. Do you still want to go through your funding analysis, or should we shelve it? Either answer is fine — just let us know. {{reschedule_link}} Reply STOP to opt out.
```

**Email subject:** Do you still want this?

```
Hey {{contact.first_name}},

Straight question: do you still want to go through your analysis, or has the
timing changed?

Either answer works. We just don't want to keep reaching out if you're not in
a position to move on it right now.

If you are: {{reschedule_link}}

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `SMS-S05A-NOSHOW-04` · `EMAIL-S05A-NOSHOW-04`
**Timing:** +7d

**SMS:**
```
Hey {{contact.first_name}}, Fundhub. Closing your file for now. Your analysis stays saved — if the timing changes, book anytime: {{reschedule_link}} Reply STOP to opt out.
```

**Email subject:** Closing your file for now

```
Hey {{contact.first_name}},

We're closing this out for now.

Your analysis stays saved in your portal — nothing gets deleted. If the timing
changes, the calendar's always open.

{{reschedule_link}}

Good luck out there.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

---

## D. Offer Bucket Delivery — fires when the closer sets the bucket after `call.completed`

One email per bucket. Each confirms what they bought, where it lives, and what happens next.
All of them point to the portal, which they already have from booking.

### `EMAIL-OFFER-SOFT-PULL` — UnderwriteIQ soft-pull assessment ($32)

**Subject:** Your UnderwriteIQ assessment is running

```
Hey {{contact.first_name}},

Payment received. Your UnderwriteIQ assessment is running now.

This pulls your profile the way an underwriter sees it — structure, utilization,
inquiry spacing, and what's actually driving decisions on your file.

Results land in your portal: {{CLIENT_PORTAL_URL}}

Your advisor will walk you through what it means.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `EMAIL-OFFER-FUNDING-DFY` — Funding, done-for-you

**Subject:** You're set up — here's what we need from you

```
Hey {{contact.first_name}},

You're in. Here's what happens now.

Before we can start submitting, we need your documents uploaded and approved.
That's a hard gate — nothing moves until it clears.

Upload here: {{CLIENT_PORTAL_URL}}

Once your documents are approved:

1. We optimize your profile
2. Your specialist starts Round 1
3. You get a text when applications go out
4. We clean up the resulting inquiries
5. Repeat across the remaining rounds

You'll hear from us at every step. Reply to this email or text us if anything
is unclear.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `EMAIL-OFFER-REPAIR-DFY` — Credit repair, done-for-you

**Subject:** Your repair file is open

```
Hey {{contact.first_name}},

Your repair file is open.

We work in rounds. Each round we identify what's disputable, send the letters,
wait for the bureaus to respond, then reassess based on what came back.

Your portal shows every item, every letter, and every response as it lands:
{{CLIENT_PORTAL_URL}}

Bureaus set their own timelines, so the pace isn't ours to control. What we
control is that nothing sits idle.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `EMAIL-OFFER-REPAIR-TRIAL` — Repair test run, first round

**Subject:** Your first repair round is starting

```
Hey {{contact.first_name}},

Your test round is starting.

This is one full round, done for you — we identify what's disputable, send the
letters, and show you exactly what comes back from the bureaus.

Track it here: {{CLIENT_PORTAL_URL}}

When the round closes, we'll go through the results with you and you can decide
whether to keep going.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `EMAIL-OFFER-UWIQ-DELIVERABLES` — UnderwriteIQ Deliverables Package

**Subject:** Your deliverables package is being built

```
Hey {{contact.first_name}},

We're building your package now. Here's what's in it:

• Credit Analysis Report
• Dispute Letter Pack
• Credit Optimization Roadmap
• Funding Snapshot
• Bank & Lender Match List
• How To Use This mini course

Everything lands in your portal as it's finished: {{CLIENT_PORTAL_URL}}

The mini course explains how to actually use the rest of it. Start there when
it arrives.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `EMAIL-OFFER-FUNDING-MASTERY` — Funding Mastery course

**Subject:** Funding Mastery — you're enrolled

```
Hey {{contact.first_name}},

You're enrolled. Full course is unlocked in your portal right now:
{{CLIENT_PORTAL_URL}}

This is the whole system, A to Z — profile structure, lender sequencing,
inquiry spacing, timing, and the order operations actually need to happen in.

Work through it in order. The sequence is the point.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `EMAIL-OFFER-NONE` — No offer / not a fit right now

**Subject:** Where things stand

```
Hey {{contact.first_name}},

Thanks for the call.

Based on what we went through, there isn't a package we'd put you in right now.
We'd rather tell you that than sell you something that won't move the needle.

Your analysis stays in your portal: {{CLIENT_PORTAL_URL}}

Profiles change. When yours does, come back and we'll take another look.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

---

## E. Document Collection — fires after `deposit.paid`, drives the `GHL-DOC` agent

### `EMAIL-DOC-01-REQUEST` · `SMS-DOC-01-REQUEST`
**Timing:** immediate on `deposit.paid`

**SMS:**
```
Hey {{contact.first_name}}, Fundhub. Before we can start, we need a few documents from you. Upload them here: {{CLIENT_PORTAL_URL}} Or just reply to this text with photos. Reply STOP to opt out.
```

**Email subject:** Documents needed before we can start

```
Hey {{contact.first_name}},

One thing standing between you and Round 1: documents.

We need these before anything moves:

• Government-issued photo ID
• Proof of address
• Articles of organization or incorporation, if you have an entity

Two ways to send them:

1. Upload in your portal: {{CLIENT_PORTAL_URL}}
2. Text photos directly to this number

Our system reviews them as soon as they land and tells you immediately if
anything is unclear or needs a retake.

Nothing starts until these clear — so the sooner they're in, the sooner you're
moving.

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

### `SMS-DOC-02-REQUEST-MORE`
**Timing:** fired by the `GHL-DOC` agent when its output is `request_more`.
Agent supplies the specific issue in `message_to_client`.

```
Hey {{contact.first_name}}, Fundhub. Got your upload — one thing needs fixing before we can move forward. Details in your portal: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.
```

### `SMS-DOC-03-APPROVED` · `EMAIL-DOC-03-APPROVED`
**Timing:** fired when the `GHL-DOC` agent returns `accept`

**SMS:**
```
Hey {{contact.first_name}}, documents approved. We're optimizing your profile now and your specialist will start Round 1 shortly. Reply STOP to opt out.
```

**Email subject:** Documents approved — you're moving

```
Hey {{contact.first_name}},

Your documents cleared.

Next: we optimize your profile, then your specialist starts Round 1. You'll get
a text the moment applications go out.

Track everything here: {{CLIENT_PORTAL_URL}}

{{sender_name}}
Fundhub

fundhub.ai • Funding Intelligence for Entrepreneurs
{{unsubscribe}}
```

---

## F. AR / Billing — invoice per completed round, driven by the `GHL-A2` agent

Invoice is generated when a round completes. These are the three chase touches.

### `EMAIL-AR-01-FIRST-NOTICE` · `SMS-AR-01-FIRST-NOTICE`
**Timing:** on `invoice.sent`

**SMS:**
```
Hey {{contact.first_name}}, Fundhub billing. Round {{custom_fields.funding_round_number}} is complete and invoice {{invoice_number}} for {{balance_due}} is in your portal: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.
```

**Email subject:** Invoice {{invoice_number}} — Round {{custom_fields.funding_round_number}} complete

```
Hey {{contact.first_name}},

Round {{custom_fields.funding_round_number}} is complete. Invoice
{{invoice_number}} is ready.

Amount due: {{balance_due}}

Pay here: {{CLIENT_PORTAL_URL}}

Per your agreement, each round is invoiced as it completes. Settling this keeps
the next round on schedule.

Questions on anything in it — reply to this email.

{{sender_name}}
Fundhub Billing

fundhub.ai
{{unsubscribe}}
```

### `EMAIL-AR-02-REMINDER` · `SMS-AR-02-REMINDER`
**Timing:** +7 days unpaid

**SMS:**
```
Hey {{contact.first_name}}, Fundhub billing. Invoice {{invoice_number}} for {{balance_due}} is still open. Pay or tell us a date: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.
```

**Email subject:** Invoice {{invoice_number}} is still open

```
Hey {{contact.first_name}},

Invoice {{invoice_number}} for {{balance_due}} is still outstanding.

The work on Round {{custom_fields.funding_round_number}} is done and delivered.

Pay here: {{CLIENT_PORTAL_URL}}

If you need a few more days, reply with a date and we'll note it on your account.
We just need to know where things stand.

{{sender_name}}
Fundhub Billing

fundhub.ai
{{unsubscribe}}
```

### `EMAIL-AR-03-FINAL-NOTICE` · `SMS-AR-03-FINAL-NOTICE`
**Timing:** +14 days unpaid

**SMS:**
```
Hey {{contact.first_name}}, Fundhub billing. Final notice on invoice {{invoice_number}} for {{balance_due}}. Remaining rounds are on hold until it clears: {{CLIENT_PORTAL_URL}} Reply STOP to opt out.
```

**Email subject:** Final notice — invoice {{invoice_number}}

```
Hey {{contact.first_name}},

This is the final notice on invoice {{invoice_number}} for {{balance_due}}.

Your remaining funding rounds are on hold until this clears. That's not a
threat — it's just how the agreement works. We invoice per completed round so
neither side gets ahead of the other.

Pay here: {{CLIENT_PORTAL_URL}}

If there's a reason this can't be paid right now, reply and tell us. We'd
rather work out a date than let this sit.

After this notice, the account moves to our automated collections process and
no one here handles it directly.

{{sender_name}}
Fundhub Billing

fundhub.ai
{{unsubscribe}}
```

---

## G. Funding Paused (AX-07) — fires when a new negative appears on a CRS snapshot

Copy already exists and is seeded: `EMAIL-AX07-FUNDING-PAUSED` and
`SMS-AX07-FUNDING-PAUSED`. Both currently `compliance_passed = false`.

**No new copy needed.** Cursor turns the existing pair on once the detector is built.

---

## H. Round Start Notification — already exists

`SMS-ROUND-STARTED-NOTIFY` is live and approved. SMS-only by design — this is the
Twilio text your specialist's Start Round action fires.

**No new copy needed.**

---

## Summary — what's new here

| Lane | New templates |
|---|---|
| Welcome | 2 |
| No-book chase emails | 3 |
| No-show recovery 2–4 | 6 |
| Offer bucket delivery | 7 |
| Document collection | 5 |
| AR billing | 6 |
| **Total** | **29** |

Existing and reused, no new copy: `EMAIL-PORTAL-MAGIC-LINK`, `SMS-ROUND-STARTED-NOTIFY`,
`EMAIL/SMS-AX07-FUNDING-PAUSED`, all 6 `EMAIL-REPAIR-*`, `INVOICE-SENT-EMAIL`,
`SMS-NOBOOK-01/02/03`, `EMAIL/SMS-S05A-NOSHOW-RECOVERY`, `CONTRACT-SEND-EMAIL`,
`CONTRACT-REMIND-EMAIL`.
