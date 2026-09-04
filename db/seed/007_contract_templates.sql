-- 007_contract_templates.sql — two starter contract templates.
--
-- WHY SEED ANY AT ALL. A template screen with nothing in it does not prove the
-- feature works, and the brief named soft-pull consent as a case that must be
-- real ("consent capture with timestamp is a first-class case"). These two make
-- it real on a fresh database instead of theoretical.
--
-- THE NARRATIVE TERMS ARE STILL NOT APPROVED LEGAL COPY. What changed on
-- 2026-09-03 is that they no longer pretend to be: the funding agreement's terms
-- are one loudly marked block for Chris to paste the executed text into, and
-- everything around that block — the parties, the date, the fee, the no-promise
-- paragraph and the signature block — is finished.
--
-- THE SELLER IS WRITTEN INTO THE WORDS, NEVER TYPED. These templates used to
-- open "Between: {{field.company_name}} ("we")", filled by a staff member at
-- send time, and on 2026-09-03 a closer typed the CLIENT's company into it, so
-- the agreement said the client's own company was selling to the client. The
-- seller on a client contract is Fundhub LLC on every one of them, so it is a
-- sentence and not a blank. Full reasoning:
-- db/migrations/287_contract_seller_signature_and_real_text.sql.
--
-- 287 IS THE OTHER HALF OF THIS FILE AND BOTH ARE NEEDED. db/ is applied
-- schema → migrations → seed, so this file is what creates these rows on a
-- FRESH database; 287 is what corrects them on one that already ran the old
-- version, because db/migrate.mjs never re-reads an applied file. Editing here
-- alone would change nothing anywhere that matters.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): the soft-pull authorization below
-- is consent capture, and the funding agreement states fee timing.
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
  --
  -- consent_days IS THE ONE BLANK LEFT, and it has to stay one.
  -- src/handlers/contract-consent.mjs reads merge_values.consent_days to set how
  -- long the permission lasts, and it treats an absent value as no term at all —
  -- a permanent permission. Writing "90 days" into the sentence and deleting the
  -- blank would quietly make every soft-pull consent permanent. Nobody types it:
  -- src/contracts/send.mjs fills it from src/config/offers.mjs at draft time.
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
    E'I am asking Fundhub LLC to look at my credit report so they can tell me ' ||
    E'what funding I may qualify for.\n\n' ||
    E'I understand all of the following.\n\n' ||
    E'1. This is a soft pull. It does not lower my credit score and lenders do ' ||
    E'not see it as an application for credit.\n\n' ||
    E'2. I am giving permission for one pull, for the purpose written above. ' ||
    E'This permission lasts {{field.consent_days}} days from the date above ' ||
    E'unless I withdraw it sooner.\n\n' ||
    E'3. I can withdraw this permission at any time by telling Fundhub LLC in ' ||
    E'writing at support@fundhub.ai.\n\n' ||
    E'4. No promise of funding has been made to me. What I qualify for is ' ||
    E'decided later, by the lender, not by this form.\n\n' ||
    E'5. A copy of what I signed, and the time I signed it, is kept on file and ' ||
    E'I can ask for it at any time.\n\n' ||
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
    '[{"key":"consent_days","label":"Permission lasts (days)","required":true,"help":"Filled automatically. Nobody types this."}]'::jsonb,
    true,
    'I have read this authorization and I give my permission. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  -- ── 2. Funding agreement ────────────────────────────────────────────────
  -- kind = 'contract', subtype = 'funding_agreement' — 030's vocabulary again.
  --
  -- The deposit, the success fee and when it falls due stay OUTSIDE the marked
  -- block on purpose: src/contracts/offer-fee-language.test.mjs holds each of
  -- them against src/config/offers.mjs to the cent, and money moved into free
  -- legal text is money nothing is checking any more. That is the arrangement
  -- that produced the $1,000-a-month repair defect (273).
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
    E'Between: Fundhub LLC ("we"), 218 Bostick Rd 64, Bowling Green, FL 33834\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n' ||
    E'Your phone: {{contact.phone}}\n\n' ||
    E'AGREEMENT TERMS\n\n' ||
    E'>>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS. <<<\n\n' ||
    E'Replace this block, and only this block, with the executed Fundhub LLC ' ||
    E'funding agreement. Everything outside it is already finished and must not ' ||
    E'change: the parties, the date, the deposit, the success fee, the ' ||
    E'no-promise paragraph and the signature block. Open Contracts, choose this ' ||
    E'wording, paste the real text over these lines, and save.\n\n' ||
    E'>>> END OF PLACEHOLDER <<<\n\n' ||
    E'WHAT IT COSTS\n\n' ||
    E'You pay {{field.deposit}} to start. That deposit is charged one time. ' ||
    E'If we get you funded, you pay a success fee of {{field.success_fee}}, ' ||
    E'due {{field.fee_due}}.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any amount of funding, any interest rate, or any ' ||
    E'particular result. Lenders decide that, not us.\n\n' ||
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
    '[{"key":"deposit","label":"Deposit","required":true,"help":"Filled automatically from the price list. Nobody types this."},
      {"key":"success_fee","label":"Success fee","required":true,"help":"Filled automatically from the price list. Nobody types this."},
      {"key":"fee_due","label":"Success fee due","required":true,"help":"Filled automatically. Nobody types this."}]'::jsonb,
    true,
    'I have read this agreement and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'contract templates seeded (or already present) for org %', v_org;
END $$;
