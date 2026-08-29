-- 023_ds02_letters_portal_copy.sql
-- COMPLIANCE REVIEW REQUIRED — credit-repair messaging, customer-facing copy.
--
-- Owner 2026-08-29: no attachments and no download links in this email. The
-- client signs in to their portal.
--
-- WHY A NEW FILE AND NOT AN EDIT. The copy this replaces lives in
-- db/seed/015_live_template_backfill.sql, which is already applied on live.
-- migrate.mjs records each file in schema_migrations keyed '<dir>/<file>', so
-- editing 015 in place would change nothing anywhere (CLAUDE.md section 12).
-- This supersedes it.
--
-- WHAT WAS WRONG. The old body opened "your correction letters are attached and
-- ready to send" and then told the client to print and sign them. Nothing was
-- ever attached: sendTemplated writes a messages row and the attachment system
-- carries only fixed asset keys, never a client's own PDF. The letters were
-- generated and discarded. They are now saved to the documents registry
-- (src/workflows/ds-02-diy-letters.mjs, src/sales/closer-deck.mjs), which is
-- what makes the new wording true.
--
-- MERGE ORDER. This copy should land with, or after, the portal-summary signing
-- change. public/app/client-portal.html paintDocs() already renders a download
-- link when a row carries download.url, and src/documents/retrieve.mjs already
-- produces that shape; api/read/portal-summary.mjs just does not sign its rows
-- yet. Until it does, a client following this email sees their letters listed
-- as On file and cannot open them.
--
-- compliance_passed is deliberately NOT in the DO UPDATE list: an existing row
-- keeps whatever approval state it already has.

INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT
  o.id,
  'EMAIL-DS02-DIY-LETTERS-READY',
  'email',
  $fh023$Your correction letters are ready$fh023$,
  $fh023$Hey {{contact.first_name}},

Your correction letters are ready. Log into your client portal to view and download them.

These aren't templates. They were generated off your actual report: the specific items we identified, addressed to the specific bureaus reporting them, in the order that makes sense to work them.

How to use them:

Download each one from your portal, then print and sign it. Include a copy of your government-issued ID and one proof of current address — a utility bill or bank statement works.

Send them certified mail with return receipt. That gives you a timestamp, which matters if a bureau misses the response window.

Expect a response in about 30 days. Keep everything they send back.

If items come off and you want to see where that puts you, run your file through our analyzer again and we'll tell you straight: {{custom_values.booking_link}}

And if at any point you'd rather have our team run this instead of doing it yourself, that door's open.

{{sender_name}} FundHub.ai

FundHub.ai • Funding Intelligence for Entrepreneurs

Unsubscribe$fh023$,
  true
FROM orgs o
ON CONFLICT (org_id, template_key) DO UPDATE SET
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  updated_at = now();
