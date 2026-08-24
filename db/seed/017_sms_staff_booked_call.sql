-- 017_sms_staff_booked_call.sql
-- Staff ping when a call is booked. Body is filled by
-- src/staff/booked-call-alert.mjs ({{alert_body}}). Not a client text.
-- Owner asked for name / phone / email / score they typed / survey / context.
-- COMPLIANCE REVIEW REQUIRED: includes the score they typed.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'SMS-S04C-STAFF-BOOKED',
  'sms',
  NULL,
  '{{alert_body}}',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
