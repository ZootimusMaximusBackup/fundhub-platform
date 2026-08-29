-- 023_ds02_letters_portal_copy.sql
-- COMPLIANCE REVIEW REQUIRED — credit-repair messaging, customer-facing copy.
--
-- Owner 2026-08-29: no attachments and no per-document download links in this
-- email. The client signs in to their portal.
--
-- Owner 2026-08-29, second call: PUT THE PORTAL LINK IN. The sentence above
-- said "log into your client portal" and named no address, which left the
-- client to find it. A link now sits on its own line under it. The owner's two
-- sentences are unchanged — not one word moved.
--
-- Owner 2026-08-29, third call: "JUST SEND IT TO THE PORTAL." The first attempt
-- pointed at /portal-login.html, so EVERY client — including one already signed
-- in — was handed a sign-in form first. The link is now {{portal_url}}, the
-- portal itself. A signed-in client lands on their own file. A signed-out one is
-- bounced to the sign-in page WITH THEIR EMAIL ALREADY FILLED IN, which is
-- exactly where the previous link put them, so nobody is worse off.
--
-- WHICH TAG, AND WHY THIS ONE. Four tags now exist, all filled by
-- clientContext() in src/workflows/messaging.mjs:
--   {{portal_url}}                  <- chosen: /app/client-portal.html?email=…
--   {{portal_login_url}}               the sign-in form, /portal-login.html?email=…
--   {{CLIENT_PORTAL_URL}}              an alias of portal_login_url
--   {{custom_values.portal_link}}      an alias of portal_login_url
-- src/messaging/merge-tags-registry.mjs is what the template editor checks a
-- save against, and it is the tie-breaker. portal_url was ADDED to
-- RESOLVABLE_TAGS and AVAILABLE_TAGS in the same change, so the editor accepts
-- it and offers it. CLIENT_PORTAL_URL is warn-only and the editor tells a person
-- it "will send as blank". custom_values.* is classified UNKNOWN, and
-- classifyChange() BLOCKS an unknown tag that a save introduces — so writing
-- custom_values.portal_link here would mean no staff member could ever save an
-- edit to this template again without deleting it first.
-- (custom_values.booking_link further down is grandfathered: it was in the
-- stored copy already, so the editor warns instead of refusing.)
--
-- portal_login_url WAS NOT REPOINTED, IT WAS LEFT ALONE. db/seed/009 and
-- db/migrations/253 already send six other emails to the sign-in page. Changing
-- what that tag means would have moved all of them silently. portal_url is a
-- second destination, not a rename.
--
-- NO ANCHOR TAG. This body is plain text. src/messaging/providers/resend.mjs
-- only sends html when the body matches <!DOCTYPE html|<html|<table, so an <a>
-- here would reach the client as visible angle brackets. A bare URL on its own
-- line is what mail clients auto-link, and it is the same shape the
-- booking_link line below already uses.
--
-- WHERE IT LANDS THE CLIENT.
--   Signed in  -> /app/client-portal.html, their own file, no sign-in form.
--   Signed out -> public/app/shell.js signInUrl() bounces them to
--                 /portal-login.html?email=<theirs>, address pre-filled. They
--                 press the button, get a one-time link, and that returns them
--                 to /app/client-portal.html.
-- Either way the letters are inside the closed "Account & history" drawer on
-- that page, third tab. There is still no deep link to the Documents tab, so
-- this is not one click to the letters — it is one click to the portal, which
-- is what was asked for.
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

{{portal_url}}

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
