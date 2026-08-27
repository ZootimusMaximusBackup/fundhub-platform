-- 022_partner_welcome.sql
-- White-label / affiliate partner welcome copy. Filled by
-- src/partners/welcome.mjs. The apply form used to show "you are in" and
-- send nothing, so the new partner never heard from us again.
-- No password in the copy — they get that once on the screen.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-PARTNER-WELCOME',
  'email',
  'You are in — {{partner.brand}}',
  'Hi {{partner.first_name}},

You are approved as a Fundhub {{partner.kind_label}} partner.

Sign in here: {{partner.login_url}}
Your page: {{partner.site_url}}

Use the password from the screen where you applied. Reply to this email if you need a new one.

— Fundhub',
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
  'SMS-PARTNER-WELCOME',
  'sms',
  NULL,
  'Fundhub: you are in, {{partner.first_name}}. Sign in at {{partner.login_url}}. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
