-- 253_repair_email_templates.sql — six repair-lane client emails (WS-D).
--
-- Email only (owner 2026-08-21 §2.4). Copy describes the process; it never
-- promises removals, score changes, or outcomes. compliance_passed=true so
-- sendTemplated can queue them; approved_by stays NULL (same standing as
-- other seeded transactional rows — see 007_portal_magic_link_template.sql).
--
-- Keys match src/repair/notify.mjs. Merge tags under repair.* are supplied by
-- that module through sendTemplated's context argument.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-REPAIR-WELCOME',
  'email',
  'Welcome — here is what happens next in your repair program',
  E'Hi {{contact.first_name}},\n\n'
  || E'Welcome to your Fundhub repair program. Here is what happens next.\n\n'
  || E'1. We prepare dispute letters from your credit file when your agreement is on file.\n'
  || E'2. When letters mail, we email you which accounts and bureaus were included.\n'
  || E'3. When a bureau writes back, upload that letter in your portal under '
  || E'"Upload your bureau response." Clear photos of the full page work best.\n\n'
  || E'Sign in here: {{portal_login_url}}\n\n'
  || E'This email explains the process only. It does not promise any removal, '
  || E'score change, or result.\n\n'
  || E'— The Fundhub Team',
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
  'EMAIL-REPAIR-LETTERS-SENT',
  'email',
  'Your dispute letters are on the way',
  E'Hi {{contact.first_name}},\n\n'
  || E'Good news — your dispute letters for this round are on the way.\n\n'
  || E'This round covers:\n{{repair.accounts_list}}\n\n'
  || E'Bureaus included: {{repair.bureaus_list}}\n\n'
  || E'What a bureau response looks like: a letter (or PDF) from Experian, '
  || E'Equifax, or TransUnion that names the accounts and says what they did '
  || E'(for example verified, updated, or no longer listed). When it arrives, '
  || E'upload it in your portal under "Upload your bureau response."\n\n'
  || E'Portal: {{portal_login_url}}\n\n'
  || E'This email describes the process. It does not promise any removal, '
  || E'score change, or result.\n\n'
  || E'— The Fundhub Team',
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
  'EMAIL-REPAIR-RESPONSE-RESULTS',
  'email',
  'We reviewed your bureau response',
  E'Hi {{contact.first_name}},\n\n'
  || E'We reviewed the bureau response you uploaded. Here is what that letter '
  || E'says for each account, in plain words:\n\n'
  || E'{{repair.outcomes_list}}\n\n'
  || E'What we do next: accounts the bureau verified or left open may move into '
  || E'the next dispute round when your program allows it. Accounts no longer '
  || E'listed or updated are closed on our side for this step.\n\n'
  || E'Portal: {{portal_login_url}}\n\n'
  || E'This is a read of their letter — not a promise about future results.\n\n'
  || E'— The Fundhub Team',
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
  'EMAIL-REPAIR-ROUND-ADVANCED',
  'email',
  'Round {{repair.round}} is out',
  E'Hi {{contact.first_name}},\n\n'
  || E'Round {{repair.round}} is out. These accounts are moving forward because '
  || E'the prior bureau answer left them open for another step:\n\n'
  || E'{{repair.escalated_list}}\n\n'
  || E'We will prepare the next letters when they are ready to send. You will '
  || E'get another email when they mail.\n\n'
  || E'Portal: {{portal_login_url}}\n\n'
  || E'This email describes the process only. It does not promise any removal, '
  || E'score change, or result.\n\n'
  || E'— The Fundhub Team',
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
  'EMAIL-REPAIR-RETAKE-PHOTO',
  'email',
  'Please retake your bureau letter photo',
  E'Hi {{contact.first_name}},\n\n'
  || E'We could not read the photo you uploaded. Please take a new one and '
  || E'upload it again under "Upload your bureau response."\n\n'
  || E'What to fix:\n{{repair.retake_message}}\n\n'
  || E'Tips: full page in frame, good light, no glare, text sharp enough to read.\n\n'
  || E'Portal: {{portal_login_url}}\n\n'
  || E'— The Fundhub Team',
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
  'EMAIL-REPAIR-TRIAL-COMPLETE-UPSELL',
  'email',
  'Your trial rounds are complete — next steps',
  E'Hi {{contact.first_name}},\n\n'
  || E'Your trial repair rounds are complete.\n\n'
  || E'Recap of what we worked through:\n{{repair.results_recap}}\n\n'
  || E'A Fundhub team member will reach out about continuing into the full '
  || E'program where you left off — not starting over. Reply to this email if '
  || E'you have questions before then.\n\n'
  || E'Portal: {{portal_login_url}}\n\n'
  || E'This email describes your program status. It does not promise any '
  || E'removal, score change, or result.\n\n'
  || E'— The Fundhub Team',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  compliance_passed = EXCLUDED.compliance_passed,
  updated_at = now();
