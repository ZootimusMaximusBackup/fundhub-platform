-- 007_payment_link_template.sql — the SMS template "send via existing
-- messaging path" (src/workflows/messaging.mjs sendTemplated) renders for a
-- payment link.
--
-- compliance_passed is FALSE on purpose. sendTemplated refuses to render any
-- template where it is not true (WHERE compliance_passed = true), so a link
-- sent through the messaging path today no-ops with reason 'template_pending'
-- until a human reviews this copy and flips the flag — the same gate every
-- other template in this table goes through, and the reason "copy link"
-- exists as the other option on the CRM screen. See
-- docs/PAYMENT-LINKS-SPEC.md and CLAUDE.md §7 (COMPLIANCE REVIEW REQUIRED —
-- this touches payment rails).
INSERT INTO message_templates (org_id, template_key, channel, subject, body, compliance_passed)
SELECT o.id, 'payment_link_notice', 'sms', NULL,
       'Hi {{contact.first_name}}, here is your payment link for {{payment_link.description}}: {{payment_link.url}}',
       false
FROM orgs o
WHERE o.slug = 'fundhub'
ON CONFLICT (org_id, template_key) DO NOTHING;
