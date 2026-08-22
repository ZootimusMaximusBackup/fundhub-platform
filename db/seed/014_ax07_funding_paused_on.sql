-- 014_ax07_funding_paused_on.sql
-- AX-07 templates already exist (templates-seed / 006 pack) with
-- compliance_passed = false. Spec 4.11: turn them on when the detector works.
-- Copy is not rewritten.

UPDATE message_templates
   SET compliance_passed = true,
       updated_at = now()
 WHERE template_key IN ('EMAIL-AX07-FUNDING-PAUSED', 'SMS-AX07-FUNDING-PAUSED');
