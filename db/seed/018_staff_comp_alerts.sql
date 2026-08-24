-- 018_staff_comp_alerts.sql
-- COMPLIANCE REVIEW REQUIRED — commission timing / staff payout notice.
-- Owner-set 2026-08-23: email on Mark paid; SMS win ping when a deal closes.
-- Bodies filled by src/staff/comp-alerts.mjs ({{alert_body}} / merge tags).

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-COMMISSION-PAID',
  'email',
  'You got paid — {{amount_display}} is on the way',
  E'Hey {{staff_first_name}},\n\nYou''re paid.\n\nAmount: {{amount_display}}\nHow it''s going out: {{payout_rail}}\nReference: {{payout_ref}}\n\nExpect that money to hit your account today (ACH usually same day or next bank day).\n\n— Fundhub',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-DEAL-CLOSE-WIN',
  'sms',
  NULL,
  '{{alert_body}}',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
