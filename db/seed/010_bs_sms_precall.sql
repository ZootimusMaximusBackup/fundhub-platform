-- 010_bs_sms_precall.sql
-- BS-01 SMS companion (owner 2026-08-15): three pre-call texts, no video links.
-- Keys match src/workflows/bs-01-precall-launcher.mjs.
-- compliance_passed=true: owner approved this copy in-session.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-BS01-01-BOOKED',
  'sms',
  NULL,
  'Hey {{contact.first_name}}, it''s Fundhub. You''re booked — we''ll text you again before the call. Need to move it? Just reply here. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-BS01-02-PRECALL',
  'sms',
  NULL,
  'Hey {{contact.first_name}}, Josh from Fundhub here. Quick check-in before your call — reply if you have questions or need to reschedule. Looking forward to it. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-BS01-03-DAYOF',
  'sms',
  NULL,
  'Hey {{contact.first_name}}, Fundhub — your call is coming up soon. Reply if you need anything before we start. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
