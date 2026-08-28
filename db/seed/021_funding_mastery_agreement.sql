-- 021_funding_mastery_agreement.sql — Mastery contract wording for Present.
--
-- Starter copy only. Edit from the Contracts screen. Idempotent per org+key.
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): fee timing / consent. No credit
-- outcome claims. This is an education program, not a funding promise.

DO $$
DECLARE
  v_org   uuid;
  v_staff uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skipped Mastery agreement seed: no org fundhub';
    RETURN;
  END IF;

  SELECT id INTO v_staff FROM staff
   WHERE org_id = v_org AND lower(btrim(role)) = 'owner'
   ORDER BY created_at LIMIT 1;
  IF v_staff IS NULL THEN
    SELECT id INTO v_staff FROM staff WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  END IF;
  IF v_staff IS NULL THEN
    RAISE NOTICE 'skipped Mastery agreement seed: no staff';
    RETURN;
  END IF;

  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'FUNDING-MASTERY-AGREEMENT',
    'Funding Mastery Program Agreement',
    'contract',
    'funding_mastery',
    E'FUNDING MASTERY PROGRAM AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: {{field.company_name}} ("we")\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'WHAT THIS IS\n\n' ||
    E'{{field.scope}}\n\n' ||
    E'WHAT YOU PAY\n\n' ||
    E'You pay {{field.program_fee}} for the program described above. Access starts after this fee is paid.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise funding, any approval amount, any credit score change, or any particular result. ' ||
    E'This is an education program. You do the work.\n\n' ||
    E'HOW LONG THIS LASTS\n\n' ||
    E'Access runs for {{field.term_days}} days from the date you pay, unless we write a different end date.\n\n' ||
    E'YOUR COPY\n\n' ||
    E'When you sign, the exact wording above is saved with the time you signed it.',
    '[{"key":"company_name","label":"Company name","required":true,"help":"Legal entity name"},
      {"key":"scope","label":"What the program includes","required":true,"help":"Plain sentences — education, not done-for-you funding"},
      {"key":"program_fee","label":"Program fee","required":true,"help":"For example: $5,000"},
      {"key":"term_days","label":"Access length (days)","required":true,"help":"For example: 365"},
      {"key":"company_email","label":"Company email","required":true,"help":"Where they write with questions"}]'::jsonb,
    true,
    'I have read this program agreement and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'Funding Mastery agreement seeded (or already present) for org %', v_org;
END $$;
