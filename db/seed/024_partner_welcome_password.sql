-- 024_partner_welcome_password.sql — the welcome mail told partners to use a
-- password they were never shown. Supersedes db/seed/022_partner_welcome.sql.
--
-- 022 is already recorded in schema_migrations, so editing it in place is a
-- silent no-op (CLAUDE.md §12). This file replaces the two bodies instead.
--
-- WHAT WAS WRONG. 022's line was "Use the password from the screen where you
-- applied." That was true while api/public/partner-apply.mjs minted a login on
-- submit and printed the first password on the success screen. It stopped being
-- true when white-label became invite-only: an application now writes one
-- 'invited' row and no login at all, and the password is created later, by
-- approvePartnerApplication(), which hands it to the EMPLOYEE approving — never
-- to the partner. So the first mail a new partner ever received pointed them at
-- a screen that no longer exists, for a password that was never theirs to see.
--
-- WHAT IT SAYS NOW. Sign in here, and set your password with "Forgot your
-- password?" on that same page. That door is real and already works for partner
-- logins: public/login.html has the link, POST /api/auth/reset action=request
-- sends the link, and src/auth/invite.mjs accepts accounts of kind 'partner'
-- (263_password_resets_account.sql). Nothing new is promised.
--
-- No dollar figures, no outcomes, no claim about what partnering earns.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-PARTNER-WELCOME',
  'email',
  'You are in — {{partner.brand}}',
  'Hi {{partner.first_name}},

You are approved as a Fundhub {{partner.kind_label}} partner.

Sign in here: {{partner.login_url}}

You do not have a password yet. On that page, click "Forgot your password?" and
we will email you a link to set one. The link lasts one hour.

Your page: {{partner.site_url}}

Reply to this email if anything does not work.

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
  'Fundhub: you are in, {{partner.first_name}}. Go to {{partner.login_url}} and use "Forgot your password?" to set your password. Reply STOP to opt out.',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
