-- 015_live_template_backfill.sql
-- Live production dump (org slug fundhub) of 41 message_templates keys.
-- Copy is verbatim from live. Do not invent bodies.
-- compliance_passed copied per live row. Do not rewrite bodies.

-- EMAIL-AX07-FUNDING-PAUSED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-AX07-FUNDING-PAUSED',
  'email',
  $fh015$Funding paused — action needed$fh015$,
  $fh015$ Hi {{contact.first_name}},

 We detected a new negative item on your credit report while your funding file is in progress.
 To protect approvals, we’re pausing the funding sequence until this is handled.

 Next step: we need a quick call to approve the reduced-cost fix
 ( ${{contact.cf_negative_quote_amount}} ) so we can continue.

 Click below to book a quick call (or reply to this email if you can’t book right now).

 Book the quick call

 Note: this may extend your timeline until resolved. We’ll confirm next steps on the call.

 fundhub.ai • Funding Intelligence for Entrepreneurs

 {{unsubscribe}}$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-AX07-FUNDING-PAUSED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-AX07-FUNDING-PAUSED',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}} — we've briefly paused your file for a quick review to keep your approvals on track. Our team is on it and will reach out shortly. Questions? Reply HELP. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-C06-DECLINE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-C06-DECLINE',
  'email',
  $fh015$Your Fundhub review — what we found$fh015$,
  $fh015$Hey {{contact.first_name}},

We finished the review of your profile, and I want to be straight with you: going after capital today isn't the right move.

Here's why. Based on what came back on your pull, the approvals available to you right now would be small, expensive, and they'd burn inquiries you'll want later. We could submit anyway and collect a fee. We're not going to do that.

What we found instead is that your file has specific, fixable items sitting between you and real approval numbers. Not vague credit advice — specific items, with a specific order to address them.

That's the work we do in our optimization program. Same team, same engine, aimed at getting your profile to where the funding conversation is actually worth having.

Your advisor will walk you through what that looks like and what your projected position is on the other side of it. No pressure either way — but I'd rather you fund well in a few months than badly today.

{{sender_name}} FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-C06-DECLINE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-C06-DECLINE',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, it's Fundhub. We reviewed your file and this path isn't a fit right now. Reply if you have questions. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-DPC05-NO-PROGRESS-72H
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-DPC05-NO-PROGRESS-72H',
  'email',
  $fh015$72-hour no-progress escalation$fh015$,
  $fh015$ Internal alert — this record has had no progress for 72+ hours .

 Contact: {{contact.first_name}} {{contact.last_name}}

 Last Progress Action: {{custom_fields.cf_last_progress_action}}

 Last Progress Timestamp: {{custom_fields.cf_last_progress_timestamp}}

 Employee Next Action: {{custom_fields.employee_next_action}}

 Hard Stop Reason (if any): {{custom_fields.cf_hard_stop_reason}}

 Required: take one decisive action now — escalate + move the file forward, or close the file if appropriate.

 Open Client Record

 This is a mechanical control alert (72-hour rule). Do not leave records idle.

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-DPC05-NO-PROGRESS-72H
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-DPC05-NO-PROGRESS-72H',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub checking in — we haven't heard back. Reply here or book: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-DPC04-RESCHEDULE-REBOOKING
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-DPC04-RESCHEDULE-REBOOKING',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, it's Fundhub. Here's your link to pick a new time: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-DS01-REPAIR-REFERRAL
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-DS01-REPAIR-REFERRAL',
  'email',
  $fh015$The step that unlocks your funding$fh015$,
  $fh015$Hey {{contact.first_name}},

Following up on your review with a clear picture of where you stand.

Your profile isn't in a position to pull the funding numbers you're after — yet. What's in the way is a defined set of items on your report, and we've mapped them: which ones move the needle most, what order to work them in, and what your position looks like once they're handled.

That's our optimization program. Here's what it actually is:

We work your file directly with the bureaus and the furnishers. You get the correction requests, the tracking, and the reporting. You're not writing letters or sitting on hold — our team runs it.

And critically, we're not handing you off to a stranger at the end. The same engine that scored your file today re-scores it when the work is done, and the same team takes you into funding.

The realistic timeline is set at the start, not guessed at. Your advisor will walk you through what your file specifically needs and what the projection is on the other side.

Get started here: {{custom_values.booking_link}}

{{sender_name}} FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-DS01-REPAIR-REFERRAL
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-DS01-REPAIR-REFERRAL',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, it's Fundhub. Based on your review, profile optimization is the next step. Details are in your email. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-DS02-DIY-LETTERS-READY
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-DS02-DIY-LETTERS-READY',
  'email',
  $fh015$Your correction letters are ready$fh015$,
  $fh015$Hey {{contact.first_name}},

As promised — your correction letters are attached and ready to send.

These aren't templates. They were generated off your actual report: the specific items we identified, addressed to the specific bureaus reporting them, in the order that makes sense to work them.

How to use them:

Print and sign each one. Include a copy of your government-issued ID and one proof of current address — a utility bill or bank statement works.

Send them certified mail with return receipt. That gives you a timestamp, which matters if a bureau misses the response window.

Expect a response in about 30 days. Keep everything they send back.

If items come off and you want to see where that puts you, run your file through our analyzer again and we'll tell you straight: {{custom_values.booking_link}}

And if at any point you'd rather have our team run this instead of doing it yourself, that door's open.

{{sender_name}} FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-F02-ID-PORTAL-NEEDED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-F02-ID-PORTAL-NEEDED',
  'email',
  $fh015$One quick step before we can begin$fh015$,
  $fh015$ Hey {{contact.first_name}},

 Quick heads up — your onboarding isn’t fully complete yet, and we can’t start your funding rounds until it is.

 What we still need from you (one or both may apply):

 • Government ID uploaded 

 • Portal onboarding marked complete 

 Please use the button below to finish onboarding. Once that’s done, your file automatically moves forward.

 Finish Onboarding

 If the button doesn’t work, copy/paste this link into your browser:

 {{PORTAL_ONBOARDING_LINK}}

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-F02-ID-PORTAL-NEEDED-FOLLOWUP',
  'email',
  $fh015$P2 — ID / Portal Still Missing$fh015$,
  $fh015$ You’re stalling your own funding

 Hey {{contact.first_name}},

 Quick follow-up — your file is ready to move, but we’re still blocked.

 We still need your ID / portal onboarding completed before we can start Round 1.

 This is verification (lenders require it). Until it’s done, we can’t submit anything, and approvals can’t start.

 Knock this out here:

 Upload ID / Finish Onboarding

 If something’s stopping you, reply and tell us what it is — we’ll help fast.

 – {{sender_name}}
FundHub.ai

 FundHub.ai • Onboarding Support

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-F02-ID-PORTAL-NEEDED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-F02-ID-PORTAL-NEEDED',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub needs your ID upload to keep onboarding moving. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-F03-ROUND-SUBMITTED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-F03-ROUND-SUBMITTED',
  'email',
  $fh015$Funding Round {{custom_fields.funding_round_number}} has been submitted$fh015$,
  $fh015$ Hey {{contact.first_name}},

 Quick update — we’ve submitted Funding Round {{custom_fields.funding_round_number}} for your file.

 What happens next:

 • Lenders review the submission and return decisions on their timelines.

 • If anything is needed to finalize this round (identity, verification, or additional documentation), we’ll notify you as soon as it’s requested.

 You can monitor round status and next steps inside your client portal.

 View Funding Round Status

 If the button doesn’t work, copy/paste this link into your browser:

 {{CLIENT_PORTAL_URL}}

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-F03-ROUND-SUBMITTED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-F03-ROUND-SUBMITTED',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub — your round was submitted. We'll update you as lenders respond. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-F04-ROUND-APPROVALS
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-F04-ROUND-APPROVALS',
  'email',
  $fh015$Approvals are in for Funding Round {{custom_fields.funding_round_number}}$fh015$,
  $fh015$ Hey {{contact.first_name}},

 Quick update — approvals for Funding Round {{custom_fields.funding_round_number}} have started coming back and have been posted to your file.

 Next steps are simple:

 • Review the approved offers associated with this round

 • Complete any lender verification steps if requested (identity / security / address confirmation)

 • Follow the activation / access instructions tied to each approval

 You can view the current approvals and the exact next steps inside your client portal.

 View Approvals & Next Steps

 If the button doesn’t work, copy/paste this link into your browser:

 {{CLIENT_PORTAL_URL}}

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-F04-ROUND-APPROVALS
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-F04-ROUND-APPROVALS',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub — you have an approval update. Check your email for details. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-F06-MISSING-DOCS
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-F06-MISSING-DOCS',
  'email',
  $fh015$Funding is now locked — here’s what happens next$fh015$,
  $fh015$ Hey {{contact.first_name}},

 Quick update — your funding outcome is now marked Funding Locked . That means your results for this sequence have been finalized and your file is moving into the next operational step.

 Next steps:

 • Review the final approvals and any remaining activation / verification steps

 • Follow the access instructions tied to each approval (logins, identity checks, etc.)

 • Track completion inside your client portal so we can keep things moving cleanly

 Billing note: since this round is locked, your invoice will be issued based on the locked fee settings tied to your file.

 View Next Steps

 If the button doesn’t work, copy/paste this link into your browser:

 {{CLIENT_PORTAL_URL}}

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-F06-MISSING-DOCS
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-F06-MISSING-DOCS',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub — lenders need a few documents to keep your file moving. Check your email. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-F07-FUNDING-LOCKED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-F07-FUNDING-LOCKED',
  'email',
  $fh015$FR22 – Total Funding Locked$fh015$,
  $fh015$ Your total funding is locked 🔓

 Hey {{contact.first_name}},

 You made it. 
 After 10 rounds of strategic submissions, lender sequencing, inquiry spacing, 
 and profile management — your total funding is now locked in. 

 Total funding secured:

 ${{total_funding_locked}}

 This includes the combined approvals from:

 Your personal funding rounds

 Your business funding rounds

 All premium-tier banks that appeared in late rounds

 This number is the result of discipline, timing, structure, 
 and following the process exactly the way it was designed.

 IMPORTANT: 
 Do not activate any cards yet. 
 We still need to finalize your post-funding instructions to protect your profile and 
 ensure smooth usage of new lines.

 Over the next few days, we’ll send you:

 Activation & optimization instructions

 Zero-percent usage strategies

 Reporting & monitoring guidance

 How to prepare for the next funding cycle

 Your next email will be: 
 FR23 – Post-Funding Monitoring 

 You executed this perfectly. 
 Let’s finish strong.

 – {{sender_name}}

 FundHub.ai

 FundHub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-F07-FUNDING-LOCKED
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-F07-FUNDING-LOCKED',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub — funding is locked. Next steps are in your email. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-F10-INBOX-SETUP
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-F10-INBOX-SETUP',
  'email',
  $fh015$Your funding inbox is ready$fh015$,
  $fh015$ Hey {{contact.first_name}},

 We’ve created your dedicated FundHub funding inbox:

 {{client_funding_inbox_email}} 

 This inbox is used to keep your funding process organized and help us track lender updates, verification requests, and decision emails as they come in.

 What to do now (quick): 

 • Set up an email rule to forward lender/bank emails to {{client_funding_inbox_email}} 

 • If you use multiple inboxes, add forwarding from each one

 • If you have an assistant helping, make sure forwarding/delegation is set correctly so nothing gets missed

 Use the button below to follow the setup steps.

 Set Up Forwarding

 Your dedicated funding inbox: {{client_funding_inbox_email}} 

 Once forwarding is set, your file can move faster with fewer missed steps.

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-F10-INBOX-SETUP
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-F10-INBOX-SETUP',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub — your funding inbox is ready. Check your email for setup. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-N01-COLD-NURTURE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-N01-COLD-NURTURE',
  'email',
  $fh015$A quick insight most people miss$fh015$,
  $fh015$ Hey {{contact.first_name}},

 One thing we’ve learned after reviewing thousands of credit and funding profiles is this:

 Most people think approvals are about a single number — a score.
 In reality, lenders look at patterns, structure, and behavior over time .

 That’s why two people with similar scores can receive completely different outcomes.

 At FundHub, our job is to help entrepreneurs understand how those decisions are actually made — and how to position themselves correctly when the timing is right.

 Learn More About Funding Strategy

 No pressure — just insight you can use when you’re ready.

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-N01-COLD-NURTURE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-N01-COLD-NURTURE',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub here. Most owners we talk to assume their credit profile is the problem. Usually it's the order they applied in. Same file, different sequence, very different result. If you want to see what yours actually supports: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-N02-WARM-NURTURE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-N02-WARM-NURTURE',
  'email',
  $fh015$A small shift that makes a big difference$fh015$,
  $fh015$ Hey {{contact.first_name}},

 One thing we see over and over again is that outcomes usually change *before* people feel “ready.”

 It’s rarely about doing everything at once. Instead, approvals tend to improve when a few key variables line up — timing, structure, and how lenders interpret recent activity.

 That’s why many strong profiles don’t get optimal results right away, while others see meaningful movement after making only a handful of targeted adjustments.

 When the timing is right, understanding *where* to focus matters more than doing more.

 See How Profiles Are Evaluated

 No rush — this is here whenever you want to explore further.

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-N02-WARM-NURTURE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-N02-WARM-NURTURE',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, it's Fundhub. You looked at funding with us a while back. Profiles move — and so do the banks. What your file supported then isn't what it supports now. Worth a fresh look: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-N03-HOT-NURTURE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-N03-HOT-NURTURE',
  'email',
  $fh015$Knowing when to move forward$fh015$,
  $fh015$ Hey {{contact.first_name}},

 At this stage, the question usually isn’t if funding or credit optimization can help — it’s when it makes the most sense to act.

 We typically see the best outcomes when three things align:

• The profile is structured correctly

• Recent activity supports lender confidence

• The timing matches the objective (growth, leverage, or cleanup)

 When those pieces are in place, results tend to compound. When they’re not, waiting is often the smarter move.

 If you’re considering next steps, the goal is clarity — understanding where your file stands and what direction actually makes sense right now.

 Explore Your Options

 Whether you act now or later, understanding the landscape is always the first step.

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-N03-HOT-NURTURE
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-N03-HOT-NURTURE',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub. You were one step from moving on your funding and it stalled out. Your analysis is still on file and still good. Want to pick it back up? {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-N04-POST-FUNDING
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-N04-POST-FUNDING',
  'email',
  $fh015$What comes after funding$fh015$,
  $fh015$ Hey {{contact.first_name}},

 Once funding is in place, the biggest determinant of future outcomes isn’t access — it’s how things are handled *after* the fact.

 We see profiles perform best when people focus on:

• Maintaining clean utilization patterns 

• Avoiding unnecessary account noise 

• Letting structure and timing do the heavy lifting

 The goal post-funding isn’t speed — it’s stability. That’s what preserves optionality and keeps doors open down the line.

 Learn How to Protect Your Position

 Small decisions now shape what’s possible later.

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-N04-POST-FUNDING
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-N04-POST-FUNDING',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, it's Fundhub. Checking in now that your capital's in place — how's the deployment going? When you're ready to look at the next round, your file is already built and the second pass moves faster. Just reply here or grab time: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-N06-RENEWAL
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-N06-RENEWAL',
  'email',
  $fh015$When “second-wave” funding makes sense$fh015$,
  $fh015$ Hey {{contact.first_name}},

 A lot of entrepreneurs assume funding is a one-time event. In reality, the strongest outcomes often come from a second wave — executed with the right timing and structure.

 Second-wave funding tends to work best when:

• Your profile has stayed stable since the last activity 

• Utilization and payment behavior have been clean 

• There’s a clear business objective (growth, liquidity, leverage)

 If you’re considering another round, the goal isn’t to “apply more” — it’s to re-enter the market when the signals are strongest.

 Check Second-Wave Readiness

 The right timing can change everything — this is about strategy, not speed.

 fundhub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-N06-RENEWAL
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-N06-RENEWAL',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub here. Your profile has had time to season since your last round, which usually means a higher ceiling this time. We can re-run it and tell you where you'd land: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-S02-FINISH-APPLICATION
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-S02-FINISH-APPLICATION',
  'email',
  $fh015$You were halfway through — finish what you started$fh015$,
  $fh015$Hey {{contact.first_name}},

I saw you start on Fundhub and then stop before finishing. That happens — life gets loud.

That form is what we use to map what funding looks realistic for you, or what to fix first if you're not fundable yet.

Finish here while it's fresh:
{{custom_values.booking_link}}

Talk soon,
Fundhub$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-S05A-NOSHOW-RECOVERY
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-S05A-NOSHOW-RECOVERY',
  'email',
  $fh015$We missed you — your analysis is still here$fh015$,
  $fh015$Hey {{contact.first_name}},

We had you down for {{appointment.start_time}} and didn't connect. No problem, things come up.

Worth saying: the work on your file is already done. Your profile has been run and your funding position is sitting in front of us — we just need fifteen minutes to walk you through what it says.

That's the whole call. What your file supports today, what's holding back the rest, and what the path looks like. No pitch deck.

Pick a time that actually works: {{custom_values.booking_link}}

If your situation changed and now isn't the right time, just reply and let me know — I'll close out the file so we're not chasing you.

{{sender_name}} FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-S05A-NOSHOW-RECOVERY
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-S05A-NOSHOW-RECOVERY',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, it's Fundhub. Looks like we missed each other. No problem — grab a new time whenever works: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- EMAIL-U02-ANALYZER-REPAIR-DELIVERY
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-U02-ANALYZER-REPAIR-DELIVERY',
  'email',
  $fh015$EMAIL — Analyzer Repair Delivery$fh015$,
  $fh015$ Your Repair Letter Pack is ready ✅

 Hey {{contact.first_name}},

 Your UnderwriteIQ results are complete. Below are your dispute letters organized by bureau + round.

 Personal Info Dispute

 Experian 

 Equifax 

 TransUnion 

 Round 1

 Experian 

 Equifax 

 TransUnion 

 Round 2

 Experian 

 Equifax 

 TransUnion 

 Round 3

 Experian 

 Equifax 

 TransUnion 

 Credit Suggestions

 {{REPLACE_CREDIT_SUGGESTIONS}}

 View My Letter Pack

 – {{sender_name}}

 FundHub.ai

 FundHub.ai • Funding Intelligence for Entrepreneurs

 Unsubscribe$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-AISET03-MSG1
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-AISET03-MSG1',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, it's Josh from Fundhub — just tried you. Still good for your call? Reply YES or grab a new time: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-AISET03-MSG2
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-AISET03-MSG2',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Josh again from Fundhub. Wanted to make sure we connect. Reply YES or reschedule here: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-AISET03-MSG3
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-AISET03-MSG3',
  'sms',
  NULL,
  $fh015$Last try from Josh at Fundhub, {{contact.first_name}}. Happy to hold a spot when you're ready: {{custom_values.booking_link}} Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- SMS-ROUND-STARTED-NOTIFY
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-ROUND-STARTED-NOTIFY',
  'sms',
  NULL,
  $fh015$Hey {{contact.first_name}}, Fundhub — your funding round is underway. We'll keep you posted. Reply STOP to opt out.$fh015$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
