-- 011_followup_sms_pack.sql
-- S-04B reminders, no-book chase, fixed AI-SET-04 handoff.
-- Owner approved copy 2026-08-15. compliance_passed=true.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, 'SMS-AISET04-HANDOFF', 'sms', NULL,
  'Hey {{contact.first_name}}, it''s Josh from Fundhub. Your call starts in 15 minutes. I''ve intro''d your advisor so you''re not walking in cold — link: {{appointment.meeting_location}}. See you soon. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, k.template_key, 'sms', NULL, k.body, true
FROM orgs o
CROSS JOIN (VALUES
  ('SMS-S04-01-CONFIRM',
   'Hey {{contact.first_name}}, it''s Fundhub. You''re booked for {{appointment.start_time}}. Reply CONFIRM so we know you''re set. Reschedule: {{custom_values.booking_link}} Reply STOP to opt out.'),
  ('SMS-S04-02-REMIND-24H',
   'Fundhub reminder, {{contact.first_name}}: your call is tomorrow at {{appointment.start_time}}. Reply CONFIRM if you''re still good. Reschedule: {{custom_values.booking_link}} Reply STOP to opt out.'),
  ('SMS-S04-03-REMIND-2H',
   'Fundhub reminder, {{contact.first_name}}: your call starts at {{appointment.start_time}}. Reply CONFIRM if you''re good to go. Reschedule: {{custom_values.booking_link}} Reply STOP to opt out.'),
  ('SMS-NOBOOK-01',
   'Hey {{contact.first_name}}, it''s Fundhub. Your file is ready — grab a time so we can walk you through what it supports: {{custom_values.booking_link}} Reply STOP to opt out.'),
  ('SMS-NOBOOK-02',
   'Hey {{contact.first_name}}, Fundhub here. Still worth a look — same file, wrong order of apps is usually the ceiling. Book here: {{custom_values.booking_link}} Reply STOP to opt out.'),
  ('SMS-NOBOOK-03',
   'Last nudge from Fundhub, {{contact.first_name}}. Want help mapping your cleanest path? {{custom_values.booking_link}} Reply STOP to opt out.')
) AS k(template_key, body)
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
