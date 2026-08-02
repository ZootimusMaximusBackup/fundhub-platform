-- 007_contract_templates.sql — two starter contract templates.
--
-- WHY SEED ANY AT ALL. A template screen with nothing in it does not prove the
-- feature works, and the brief named soft-pull consent as a case that must be
-- real ("consent capture with timestamp is a first-class case"). These two make
-- it real on a fresh database instead of theoretical.
--
-- THE WORDS BELOW ARE A STARTING POINT, NOT APPROVED LEGAL COPY. They are
-- deliberately plain and short. The whole point of this feature is that the
-- wording is edited from the CRM by a person, so nothing here is precious —
-- open the Contracts screen and rewrite it.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): the soft-pull authorization below
-- is consent capture. Recorded as a marker.
--
-- ATTRIBUTION. contract_templates.created_by is NOT NULL, so this needs a staff
-- row to attribute the seed to. It picks the org's owner, falling back to any
-- staff member. A database with no staff at all inserts nothing and says so —
-- inventing a staff row here would put a person in the audit trail who does not
-- exist, which is worse than an empty template list.
--
-- IDEMPOTENT (Rule 9): ON CONFLICT on (org_id, template_key) DO NOTHING, so a
-- re-run cannot duplicate or — importantly — overwrite copy somebody has since
-- edited on the screen.

DO $$
DECLARE
  v_org   uuid;
  v_staff uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skipped contract template seed: no org with slug fundhub';
    RETURN;
  END IF;

  SELECT id INTO v_staff FROM staff
   WHERE org_id = v_org AND lower(btrim(role)) = 'owner'
   ORDER BY created_at LIMIT 1;
  IF v_staff IS NULL THEN
    SELECT id INTO v_staff FROM staff WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  END IF;
  IF v_staff IS NULL THEN
    RAISE NOTICE 'skipped contract template seed: no staff row to attribute it to';
    RETURN;
  END IF;

  -- ── 1. Soft pull authorization ──────────────────────────────────────────
  -- kind = 'authorization', subtype = 'soft_pull_consent' — the same pair
  -- src/documents/kinds.mjs already names for the C-00 consent gate.
  --
  -- READ docs/CONTRACTS-SPEC.md §9 BEFORE WIRING THIS TO ANYTHING. Signing this
  -- does NOT write a client_consents row and does NOT unlock the credit-pull
  -- gate in api/finance/soft-pull.mjs. That bridge is a compliance decision, not
  -- an engineering one, and it is deliberately not guessed here.
  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'SOFT-PULL-CONSENT',
    'Soft Pull Authorization',
    'authorization',
    'soft_pull_consent',
    E'SOFT PULL AUTHORIZATION\n\n' ||
    E'Date: {{today}}\n' ||
    E'Name: {{contact.full_name}}\n' ||
    E'Email: {{contact.email}}\n\n' ||
    E'I am asking {{field.company_name}} to look at my credit report so they can ' ||
    E'tell me what funding I may qualify for.\n\n' ||
    E'I understand all of the following.\n\n' ||
    E'1. This is a soft pull. It does not lower my credit score and lenders do ' ||
    E'not see it as an application for credit.\n\n' ||
    E'2. I am giving permission for one pull, for the purpose written above. ' ||
    E'This permission lasts {{field.consent_days}} days from the date above ' ||
    E'unless I withdraw it sooner.\n\n' ||
    E'3. I can withdraw this permission at any time by telling ' ||
    E'{{field.company_name}} in writing at {{field.company_email}}.\n\n' ||
    E'4. No promise of funding has been made to me. What I qualify for is ' ||
    E'decided later, by the lender, not by this form.\n\n' ||
    E'5. A copy of what I signed, and the time I signed it, is kept on file and ' ||
    E'I can ask for it at any time.',
    '[{"key":"company_name","label":"Company name","required":true,"help":"The name the client will recognise"},
      {"key":"consent_days","label":"Permission lasts (days)","required":true,"help":"For example: 90"},
      {"key":"company_email","label":"Withdrawal email address","required":true,"help":"Where a client writes to withdraw"}]'::jsonb,
    true,
    'I have read this authorization and I give my permission. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  -- ── 2. Funding agreement ────────────────────────────────────────────────
  -- kind = 'contract', subtype = 'funding_agreement' — 030's vocabulary again.
  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'FUNDING-AGREEMENT',
    'Funding Agreement',
    'contract',
    'funding_agreement',
    E'FUNDING AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: {{field.company_name}} ("we")\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n' ||
    E'Your phone: {{contact.phone}}\n\n' ||
    E'WHAT WE WILL DO\n\n' ||
    E'{{field.scope}}\n\n' ||
    E'WHAT IT COSTS\n\n' ||
    E'You pay {{field.deposit}} to start. If we get you funded, you pay a ' ||
    E'success fee of {{field.success_fee}}, due {{field.fee_due}}.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any amount of funding, any interest rate, or any ' ||
    E'particular result. Lenders decide that, not us.\n\n' ||
    E'HOW LONG THIS LASTS\n\n' ||
    E'This agreement runs for {{field.term_days}} days from the date above. ' ||
    E'Either of us can end it in writing before then.\n\n' ||
    E'YOUR COPY\n\n' ||
    E'When you sign, the exact wording above is saved with the time you signed ' ||
    E'it. You can ask us for a copy at any time.',
    '[{"key":"company_name","label":"Company name","required":true,"help":"Your legal entity name"},
      {"key":"scope","label":"What we will do","required":true,"help":"Plain sentences. This is the part that changes per client."},
      {"key":"deposit","label":"Deposit","required":true,"help":"For example: $997"},
      {"key":"success_fee","label":"Success fee","required":true,"help":"For example: 10% of funded amount"},
      {"key":"fee_due","label":"Success fee due","required":true,"help":"For example: within 7 days of funding"},
      {"key":"term_days","label":"Agreement length (days)","required":true,"help":"For example: 180"}]'::jsonb,
    true,
    'I have read this agreement and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'contract templates seeded (or already present) for org %', v_org;
END $$;
