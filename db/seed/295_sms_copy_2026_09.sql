-- seed/295_sms_copy_2026_09.sql
--
-- The text messages a customer receives, rewritten. Drafts, reasoning and the
-- before/after of every line: docs/ads/sms-copy-2026-09.md.
--
-- IT LIVES IN db/seed/ AND NOT IN db/migrations/, AND THAT IS LOAD-BEARING.
-- db/migrate.mjs applies schema, THEN migrations, THEN seed, each in filename
-- order. `seed/011_followup_sms_pack.sql` and `seed/013_section4_message_templates.sql`
-- both re-write these same bodies with `ON CONFLICT DO UPDATE SET body`. Written
-- as a migration this file ran BEFORE them, and on any fresh database the old
-- copy simply overwrote the new — measured, not assumed: applied to a scratch
-- Postgres as `migrations/295` and every one of the nine bodies came out as the
-- old wording. Nothing failed and nothing warned. Production would have been
-- fine (011 and 013 are already recorded there and never re-run), so this would
-- have shipped and only broken the next clean environment somebody built.
--
-- THE NUMBER 295 IS OUT OF SEQUENCE FOR THIS DIRECTORY on purpose: the seeds run
-- to 024, and 295 was the number reserved for this work in a batch of parallel
-- lanes. It sorts last, which is exactly what is needed, and it cannot collide
-- with another lane's file.
--
-- WHY. On 2026-09-03 one phone took 69 texts in two and a half hours, 46 of them
-- the same one. Owner's verdict on his own product: "The SMS's are horrible and
-- confusing, we will fix those." Three faults, and this file fixes the third:
--   * how many were sent      — fixed in src/adapters/clickfunnels.mjs
--   * when they were sent     — fixed in src/workflows/s-04b-booking-reminders.mjs
--   * what they said          — here
--
-- EVERY KEY BELOW ALREADY EXISTS. Not one new template key is introduced, on
-- purpose: the code that sends these must work whether or not this file has been
-- applied, so that this commit can be held back for the owner to read the copy
-- first without breaking anything that ships alongside it. A key that existed
-- only here would silently send nothing (src/workflows/messaging.mjs returns
-- template_pending for an unseeded key).
--
-- WHAT DID NOT CHANGE. Every body still ends "Reply STOP to opt out." — the
-- exact wording carried on the application form (public/js/homepage-survey.js).
-- No message makes any claim about approval, an amount, or a credit outcome,
-- and none should ever be added here.
--
-- Editing 011/013 in place would have been a silent no-op (CLAUDE.md section 12),
-- so this supersedes them. Same ON CONFLICT DO UPDATE shape they use.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, k.template_key, 'sms', NULL, k.body, true
FROM orgs o
CROSS JOIN (VALUES
  -- Right after the application. Nothing has been reviewed yet, and it says so.
  ('SMS-S00-WELCOME',
   $c$Hi {{contact.first_name}} — Josh at Fundhub. Your application is in. Nothing is reviewed yet; that happens live with an advisor on your call. Pick a time here: {{custom_values.booking_link}} Reply STOP to opt out.$c$),

  -- Right after they book. Says who they are meeting and how long it takes.
  ('SMS-S04-01-CONFIRM',
   $c$You're booked, {{contact.first_name}}. {{appointment.start_time}} with a Fundhub funding advisor, about 20 minutes. Reply CONFIRM so we know you're set, or move it here: {{custom_values.booking_link}} Reply STOP to opt out.$c$),

  -- The day before. "Tomorrow" is only ever true now: the workflow refuses to
  -- send this when the call is not actually tomorrow (F47).
  ('SMS-S04-02-REMIND-24H',
   $c${{contact.first_name}} — your Fundhub call is tomorrow, at {{appointment.start_time}}. Bring your business details; your advisor goes through your numbers with you live. Reply CONFIRM if you're still good, or move it: {{custom_values.booking_link}} Reply STOP to opt out.$c$),

  -- Two hours before, and it now says so.
  ('SMS-S04-03-REMIND-2H',
   $c${{contact.first_name}} — your Fundhub call is in about two hours, at {{appointment.start_time}}. Reply CONFIRM if you're good to go, or move it: {{custom_values.booking_link}} Reply STOP to opt out.$c$),

  -- Fifteen minutes before. The link used to render empty and the message ended
  -- "link: ." (F49). The workflow now always supplies a real address, so the
  -- wording promises something that is always there.
  ('SMS-AISET04-HANDOFF',
   $c${{contact.first_name}}, it's Josh at Fundhub. Your call starts in 15 minutes, and I've briefed your advisor so you're not starting from scratch. Everything you need is here: {{appointment.meeting_location}} Reply STOP to opt out.$c$),

  -- After a missed call.
  ('SMS-S05A-NOSHOW-RECOVERY',
   $c${{contact.first_name}}, it's Fundhub — looks like we missed each other on your call. Nothing is lost and nothing is closed. Grab a new time whenever suits: {{custom_values.booking_link}} Reply STOP to opt out.$c$),

  -- Applied, never booked. THIS IS THE ONE THAT WENT OUT 46 TIMES SAYING
  -- "Your file is ready", two hours after an application, when no file exists.
  ('SMS-NOBOOK-01',
   $c${{contact.first_name}}, it's Josh at Fundhub. Your application is in, but there's no call on the calendar yet — and the call is where an advisor goes through your options with you. Pick a time: {{custom_values.booking_link}} Reply STOP to opt out.$c$),

  -- A day later. The old one said "wrong order of apps is usually the ceiling",
  -- which is company shorthand nobody outside the building understands.
  ('SMS-NOBOOK-02',
   $c${{contact.first_name}} — Josh at Fundhub again. Still nothing on the calendar. It's about 20 minutes with an advisor and you'll leave knowing where you stand. {{custom_values.booking_link}} Reply STOP to opt out.$c$),

  -- Three days later, and the last one.
  ('SMS-NOBOOK-03',
   $c$Last one from me, {{contact.first_name}} — Josh at Fundhub. If now isn't the time, no problem, your application stays saved. If it is, the calendar is here: {{custom_values.booking_link}} Reply STOP to opt out.$c$)
) AS k(template_key, body)
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- The same untruth, in an email subject line. Subject only; the body of that
-- email is not touched here.
UPDATE message_templates
   SET subject = 'Your application is in — the call isn''t booked yet',
       updated_at = now()
 WHERE template_key = 'EMAIL-NOBOOK-01'
   AND subject = 'Your file is ready — the call isn''t booked yet';
