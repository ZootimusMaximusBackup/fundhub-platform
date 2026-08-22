-- 007_portal_magic_link_template.sql — the copy for the portal sign-in email.
--
-- WHY THIS IS A SEED FILE AND NOT A STRING IN THE CODE. sendTemplated()
-- (src/workflows/messaging.mjs) looks its copy up by key and returns
-- { sent: false, reason: "template_pending" } when the key has no row. It does
-- not throw and it does not warn to anywhere a person reads. So a sign-in email
-- referencing a key with no row is a silent no-op: the client asks for a link,
-- the endpoint answers 200, and nothing is ever queued. From their side that is
-- indistinguishable from a portal that simply does not work.
--
-- Every other template in this system is parsed out of the fundhub-docs sources
-- by src/messaging/seed/seed.mjs. This one is not, and cannot be: it is not
-- ported CRM copy, it did not come from a source document, and it carries a
-- merge tag no ported template has. Authoring it here, in the repo, is the
-- honest home for it. source_doc is left NULL for the same reason — writing a
-- document name that does not contain this copy would be a false citation.
--
-- WHAT IT SAYS AND WHAT IT DOES NOT. It is transactional: somebody asked to
-- sign in, here is the link, it dies in fifteen minutes, ignore this if it was
-- not you. It makes NO claim about credit, scores, disputes, funding or
-- outcomes — nothing in CLAUDE.md §7's list is in scope for a sign-in email,
-- and nothing about a consumer's file belongs in one.
--
-- compliance_passed IS SET TRUE HERE, and 116_template_approval.sql is exact
-- about what that means: approved_by and approved_at stay NULL, which records
-- "sendable, and no person has signed this copy off" rather than manufacturing
-- an approver. That is the same standing every bulk-seeded row already has. An
-- owner or admin who opens public/app/template-editor.html and approves it puts
-- a real name and a body hash against it.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-PORTAL-MAGIC-LINK',
  'email',
  'Your Fundhub sign-in link',
  -- {{magic_link.url}} and {{magic_link.expires_minutes}} are supplied by
  -- src/auth/magic-link.mjs and by nothing else, which is why
  -- src/messaging/merge-tags-registry.mjs classifies the magic_link. root as
  -- context-supplied rather than resolvable — see the note there.
  -- {{contact.first_name}} comes off the client record like everywhere else and
  -- renders blank when it is not set, so the greeting reads fine without it.
  E'Hi {{contact.first_name}},\n\n'
  || E'Here is your link to sign in to your Fundhub portal:\n\n'
  || E'{{magic_link.url}}\n\n'
  || E'The link works once and expires in {{magic_link.expires_minutes}} minutes. '
  || E'If it has expired, go back to the sign-in page and ask for a new one.\n\n'
  || E'If you did not ask to sign in, you can ignore this email. '
  || E'Nobody can use the link without opening it from your inbox.\n\n'
  || E'— Josh',
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO NOTHING;
