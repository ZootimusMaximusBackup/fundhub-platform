-- Placeholder contract templates for repair trial, full repair, and repair+funding.
-- Starter copy only — edit from the Contracts screen. Idempotent per org+key.

DO $$
DECLARE
  v_org   uuid;
  v_staff uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skipped contract placeholder seed: no org fundhub';
    RETURN;
  END IF;

  SELECT id INTO v_staff FROM staff
   WHERE org_id = v_org AND lower(btrim(role)) = 'owner'
   ORDER BY created_at LIMIT 1;
  IF v_staff IS NULL THEN
    SELECT id INTO v_staff FROM staff WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  END IF;
  IF v_staff IS NULL THEN
    RAISE NOTICE 'skipped contract placeholder seed: no staff';
    RETURN;
  END IF;

  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'REPAIR-TRIAL-AGREEMENT',
    'Credit Repair Trial ($200)',
    'contract',
    'repair_trial',
    E'CREDIT REPAIR TRIAL AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: {{field.company_name}} ("we")\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'WHAT THIS IS\n\n' ||
    E'{{field.scope}}\n\n' ||
    E'WHAT YOU PAY\n\n' ||
    E'You pay {{field.trial_fee}} for the first done-for-you dispute round described above.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any score change, any deletion, or any particular result. ' ||
    E'Outcomes depend on your file and how bureaus and creditors respond.\n\n' ||
    E'AFTER THE TRIAL\n\n' ||
    E'If you continue with full done-for-you repair, separate terms apply. ' ||
    E'You are not locked in beyond this trial unless you sign up for more.\n\n' ||
    E'YOUR COPY\n\n' ||
    E'When you sign, the exact wording above is saved with the time you signed it.',
    '[{"key":"company_name","label":"Company name","required":true,"help":"Legal entity name"},
      {"key":"scope","label":"What the trial includes","required":true,"help":"Plain sentences — first round, bureaus/creditors covered"},
      {"key":"trial_fee","label":"Trial fee","required":true,"help":"For example: $200"}]'::jsonb,
    true,
    'I have read this trial agreement and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'CREDIT-REPAIR-AGREEMENT',
    'Credit Repair Agreement',
    'contract',
    'credit_repair',
    E'CREDIT REPAIR AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: {{field.company_name}} ("we")\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'SERVICES\n\n' ||
    E'{{field.scope}}\n\n' ||
    E'FEES\n\n' ||
    E'You pay {{field.monthly_fee}} per month while services are active, starting on the date above.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any score change, any deletion, or any particular result. ' ||
    E'We describe the process; bureaus and creditors decide outcomes.\n\n' ||
    E'CANCELLATION\n\n' ||
    E'Either of us may end this agreement in writing. Fees already paid are handled per ' ||
    E'{{field.company_name}} policy in effect when you signed.\n\n' ||
    E'TERM\n\n' ||
    E'This agreement runs for {{field.term_days}} days from the date above unless ended sooner in writing.\n\n' ||
    E'YOUR COPY\n\n' ||
    E'When you sign, the exact wording above is saved with the time you signed it.',
    '[{"key":"company_name","label":"Company name","required":true,"help":"Legal entity name"},
      {"key":"scope","label":"What we will do","required":true,"help":"Disputes, rounds, dashboard access — plain language"},
      {"key":"monthly_fee","label":"Monthly fee","required":true,"help":"For example: $1,000"},
      {"key":"term_days","label":"Agreement length (days)","required":true,"help":"For example: 180"}]'::jsonb,
    true,
    'I have read this credit repair agreement and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'REPAIR-AND-FUNDING-AGREEMENT',
    'Credit Repair + Funding Agreement',
    'contract',
    'repair_and_funding',
    E'CREDIT REPAIR + FUNDING AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: {{field.company_name}} ("we")\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'CREDIT REPAIR\n\n' ||
    E'{{field.repair_scope}}\n\n' ||
    E'FUNDING\n\n' ||
    E'{{field.funding_scope}}\n\n' ||
    E'WHAT IT COSTS\n\n' ||
    E'You pay {{field.deposit}} to start funding work. Credit repair fees: {{field.repair_fee}}. ' ||
    E'If we get you funded, you pay a success fee of {{field.success_fee}}, due {{field.fee_due}}.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any score change, any deletion, any funding amount, any rate, or any particular result. ' ||
    E'Bureaus, creditors, and lenders decide outcomes.\n\n' ||
    E'TERM\n\n' ||
    E'This agreement runs for {{field.term_days}} days from the date above unless ended sooner in writing.\n\n' ||
    E'YOUR COPY\n\n' ||
    E'When you sign, the exact wording above is saved with the time you signed it.',
    '[{"key":"company_name","label":"Company name","required":true,"help":"Legal entity name"},
      {"key":"repair_scope","label":"Credit repair scope","required":true,"help":"Disputes, rounds, parallel bureaus if needed"},
      {"key":"funding_scope","label":"Funding scope","required":true,"help":"Applications, rounds, inquiry sweeps — plain language"},
      {"key":"deposit","label":"Funding deposit","required":true,"help":"For example: $3,000"},
      {"key":"repair_fee","label":"Credit repair fee","required":true,"help":"For example: $1,000/month or bundled amount"},
      {"key":"success_fee","label":"Funding success fee","required":true,"help":"For example: 10% of funded amount"},
      {"key":"fee_due","label":"Success fee due","required":true,"help":"For example: within 7 days of funding"},
      {"key":"term_days","label":"Agreement length (days)","required":true,"help":"For example: 180"}]'::jsonb,
    true,
    'I have read this combined agreement and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'contract placeholder templates seeded (or already present) for org %', v_org;
END $$;
