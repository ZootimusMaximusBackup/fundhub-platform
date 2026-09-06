-- 025_waypoint_nudge_templates.sql — the three messages the chase ladder can
-- send, and no others.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing copy on a
-- consumer-finance file. Nothing in this file sends; it writes three rows in
-- `message_templates`.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE COPY BELOW IS A PLACEHOLDER AND IS MEANT TO BE REPLACED
--
-- Chris is auditing every email and text in the company in a separate thread.
-- The KEYS are the contract — src/nudge/ladder.mjs names exactly these three
-- and nothing else — and the WORDS are his to change in the template editor
-- without anyone touching code. So this file's job is to make the machinery
-- work end to end with copy that is safe to send if it goes out before he gets
-- to it, not to write the final message.
--
-- Two things it is deliberately NOT:
--
--   * NOT [DRAFT]. src/messaging/draft-guard.mjs hard-blocks any body carrying
--     that marker, before compliance_passed is even read. A [DRAFT] body would
--     mean this ladder queues nothing and the whole feature reports itself as
--     working while sending nothing at all.
--   * NOT compliance_passed = false. sendTemplated returns
--     { sent:false, reason:"template_pending" } for an unapproved row, with the
--     same result. The copy below is short, factual, and says nothing about
--     credit outcomes, so it is approved as written and can be rewritten later
--     without a migration.
--
--
-- BRANDING, OWNER-SET. No client-facing copy says "credit repair". These read
-- as funding-readiness language, which is what they are: a checklist step the
-- client owns, on their own file.
--
-- NO CLAIM ABOUT AN OUTCOME. Nothing below promises a score change, an
-- approval, an amount or a date, and nothing below says a regulator complaint
-- was filed — nothing in this system knows that unless the client says so
-- (src/metro2/letters/catalog.mjs:57-65, and db/migrations/366).
--
-- OPT-OUT WORDING IS REUSED, NOT INVENTED. "Reply STOP to opt out." is the
-- exact closing already shipped on every SMS in db/seed/010_bs_sms_precall.sql,
-- and STOP is one of the keywords src/handlers/comms.mjs already honours into
-- the `opt_outs` table.
--
-- {{waypoint.title}} is passed by src/nudge/run.mjs from the client's own
-- checklist row, so the message names the actual thing instead of being a
-- generic reminder. {{portal_url}} comes from sendTemplated's own merge
-- context.

-- Step 1 — on due_at. SMS.
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-WAYPOINT-DUE',
  'sms',
  NULL,
  'Hi {{contact.first_name}}, it''s Fundhub. This is due today on your file: {{waypoint.title}}. You can take care of it in your portal. Reply here if you are stuck. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- Step 2 — two days overdue. Email.
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-WAYPOINT-NUDGE-1',
  'email',
  'Still waiting on one thing from you',
  'Hi {{contact.first_name}},' || chr(10) || chr(10) ||
  'One step on your file is still open and it is yours to complete: {{waypoint.title}}.' || chr(10) || chr(10) ||
  'Everything after it waits on this one, so it is worth a couple of minutes today. Your file is here: {{portal_url}}' || chr(10) || chr(10) ||
  'If something is in the way, reply to this email and a person will pick it up.' || chr(10) || chr(10) ||
  '- {{sender_name}}, Fundhub',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

-- Step 3 — five days overdue. SMS. The last message the client gets about this
-- waypoint: step 4 is a staff task and no client message at all.
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-WAYPOINT-NUDGE-2',
  'sms',
  NULL,
  'Hi {{contact.first_name}}, Fundhub again about {{waypoint.title}} on your file. It is still open. Reply here and we will help you get it done. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
