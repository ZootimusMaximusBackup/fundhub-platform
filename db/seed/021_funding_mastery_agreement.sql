-- 021_funding_mastery_agreement.sql — Mastery contract wording for Present.
--
-- THE NARRATIVE TERMS ARE NOT THE REAL AGREEMENT AND NO LONGER PRETEND TO BE.
-- They are one loudly marked block for Chris to paste the executed Fundhub
-- Education enrollment agreement into. Everything around it is finished: the
-- parties, the date, the program fee, the no-promise paragraph and the
-- signature block.
--
-- THE SELLER IS WRITTEN INTO THE WORDS, NEVER TYPED. This template used to open
-- "Between: {{field.company_name}} ("we")", filled by a staff member at send
-- time. On 2026-09-03 a closer typed the CLIENT's own company into that box and
-- a $5,000 Fundhub education agreement went out saying the client's company was
-- selling the program to the client. Full reasoning:
-- db/migrations/287_contract_seller_signature_and_real_text.sql.
--
-- 287 IS THE OTHER HALF OF THIS FILE AND BOTH ARE NEEDED. db/ is applied
-- schema → migrations → seed, so this file creates the row on a FRESH database
-- and 287 corrects it on one that already ran the old version — db/migrate.mjs
-- never re-reads an applied file, so editing here alone fixes nothing live.
--
-- Idempotent per org+key.
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

  -- The program fee stays OUTSIDE the marked block: it is held against
  -- src/config/offers.mjs to the cent by src/contracts/offer-fee-language.test.mjs,
  -- and a price moved into free legal text is a price nothing is checking.
  --
  -- The no-promise paragraph also stays outside it. The walk log of 2026-09-03
  -- records it as the one thing the old placeholder got right and which must
  -- survive any rewrite — it is also the paragraph that contradicts the closer's
  -- spoken wrap script on the same sale (F23).
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
    E'Between: Fundhub LLC ("we"), 218 Bostick Rd 64, Bowling Green, FL 33834\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'AGREEMENT TERMS\n\n' ||
    E'>>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS. <<<\n\n' ||
    E'Replace this block, and only this block, with the executed Fundhub ' ||
    E'Education enrollment agreement for the Funding Mastery program. ' ||
    E'Everything outside it is already finished and must not change: the ' ||
    E'parties, the date, the program fee, the no-promise paragraph and the ' ||
    E'signature block. Open Contracts, choose this wording, paste the real text ' ||
    E'over these lines, and save.\n\n' ||
    E'>>> END OF PLACEHOLDER <<<\n\n' ||
    E'WHAT YOU PAY\n\n' ||
    E'You pay {{field.program_fee}} for the program described above. That is ' ||
    E'one payment and it is the whole price. Access starts after this fee is ' ||
    E'paid.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise funding, any approval amount, any credit score change, ' ||
    E'or any particular result. This is an education program. You do the work.\n\n' ||
    E'SIGNATURES\n\n' ||
    E'Fundhub LLC\n' ||
    E'218 Bostick Rd 64, Bowling Green, FL 33834\n' ||
    E'Signed by: an authorised signer of Fundhub LLC\n' ||
    E'Date: {{today}}\n\n' ||
    E'{{contact.full_name}}\n' ||
    E'{{contact.email}}\n' ||
    E'Signed by: ______________________________\n' ||
    E'Date: ______________________________\n\n' ||
    E'You sign by typing your name and ticking the box on the signing page. ' ||
    E'Your typed name, the date and time you signed, and the exact wording ' ||
    E'above are saved together as the signed record, and you can ask us for a ' ||
    E'copy at any time.',
    '[{"key":"program_fee","label":"Program fee","required":true,"help":"Filled automatically from the price list. Nobody types this."}]'::jsonb,
    true,
    'I have read this program agreement and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'Funding Mastery agreement seeded (or already present) for org %', v_org;
END $$;
