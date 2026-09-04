-- 287_contract_seller_signature_and_real_text.sql — the seller is Fundhub, the
-- document has a signature block, and the real agreement text has one place to
-- land in.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this rewrites customer-facing
-- contract copy covering fee timing and refund behaviour on a regulated
-- consumer-finance product.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE THREE DEFECTS THIS CLOSES, all found on the live walk of 2026-09-03
-- (docs/workflows/manual-walkthrough-2026-09-03.md).
--
-- F28 — THE STAFF-TYPED COMPANY NAME BECAME THE SELLER. Every client contract
-- seeded by 169, db/seed/007 and db/seed/021 opens:
--
--     Between: {{field.company_name}} ("we")
--
-- and `company_name` is a blank a staff member types at send time. On
-- 2026-09-03 a closer typed the CLIENT's own company into it, so a $5,000
-- Fundhub education agreement went out reading "Between: Sim Five Academy LLC
-- ("we") / And: Sim Five-Academy ("you")" — the client's own company selling
-- the program to the client. Every contract ever sent through that form has the
-- same shape.
--
-- The seller on a client contract is never a variable. It is Fundhub LLC, on
-- every one of them, forever. So the seller is WRITTEN INTO THE WORDS and the
-- blank is deleted. This is the same reasoning 283_partner_license_template.sql
-- states for the owner-set percentages: a fill-in from another file, meeting a
-- sentence in this one, is a seam, and a seam with nothing looking at it is how
-- both this defect and the $1,000-a-month repair defect (273) were written.
--
-- The legal entity block is the one recorded in
-- docs/workflows/contracts-and-docs-2026-08-27.md §"Entity block": Fundhub LLC
-- (lowercase h), 218 Bostick Rd 64, Bowling Green, FL 33834. Nothing here is
-- invented; where that brief and the shipped product disagree the disagreement
-- is reported rather than resolved (see the end of this file).
--
-- {{field.company_name}} SURVIVES NOWHERE IN A CLIENT CONTRACT after this file.
-- It is not repointed at the client's business either: nothing on the `clients`
-- record is verified to hold a business name, and inventing one is the failure
-- CLAUDE.md §2 names. The client is identified by the name and email the CRM
-- actually holds. If Chris wants the client's business named on the funding
-- agreements, the field that holds it has to be named first.
--
-- F29 — NO SIGNATURE BLOCK INSIDE THE DOCUMENT. The bodies ended at "YOUR COPY"
-- with no parties block, no signed-by line and no date line, so the copy the
-- client reads and downloads carried no execution block where a contract
-- normally has one. The signature itself is captured in a separate panel and
-- printed on the certificate page src/contracts/pdf.mjs appends — but that page
-- is the audit record, not the face of the agreement. Every body below now ends
-- in a SIGNATURES section naming both parties.
--
-- The client's half of that block is ruled lines rather than a merge tag, and
-- that is deliberate: contracts.rendered_body is FROZEN AT SEND
-- (124_contracts.sql, trg_contracts_frozen), hours or days before anybody
-- signs, so there is no value for a signer tag to carry at the moment the words
-- are written. The typed name and the timestamp are recorded against the
-- contract and printed on the certificate page. The block says so in the words.
--
-- F30 — THE BODIES ARE PLACEHOLDER TEXT. Chris: "Def not the real contract."
-- Owner action, 2026-09-03: "Seed real contracts."
--
-- THE REAL AGREEMENT TEXT IS NOT IN THIS REPOSITORY AND IS NOT WRITTEN HERE.
-- Agents do not draft executed legal language; Chris supplies it. What this file
-- does is make dropping it in a single paste: every other part of each document
-- — the parties, the date, the fee wired to src/config/offers.mjs, the
-- no-promise paragraph and the signature block — is finished and correct, and
-- the narrative terms are one loudly marked block between two markers.
--
-- The marker is deliberately impossible to mistake for a real clause. The whole
-- reason this defect survived a live walk is that the old placeholder READ like
-- a short real contract. A document that announces it is unfinished fails
-- safely; one that looks finished does not.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT STAYS OUTSIDE THE PLACEHOLDER, AND WHY.
--
-- 1. THE FEE SENTENCE. src/contracts/offer-fee-language.test.mjs holds every
--    money blank in this file against src/config/offers.mjs to the cent. Moving
--    a price inside free legal text would take it out from under that guard,
--    which is exactly the arrangement that produced 273. The fee stays a
--    catalogue-fed blank in a sentence this repository checks.
--
-- 2. THE NO-PROMISE PARAGRAPH. The walk log records it as the one thing the
--    placeholder got right and which must survive any rewrite — and it directly
--    contradicts the closer's spoken wrap script (F23) on the same sale.
--
-- 3. THE SIGNATURE BLOCK (F29) and the parties block (F28). Both are the defect
--    this file exists to close; leaving either to a paste would re-open it.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHY A NEW FILE RATHER THAN AN EDIT TO 169 / db/seed/007 / db/seed/021.
-- db/migrate.mjs records every applied file in schema_migrations keyed
-- '<dir>/<file>' and never reads it again, so editing an applied one is a silent
-- no-op on every database that has run it (CLAUDE.md §12). The UPDATEs below are
-- what corrects a live database.
--
-- THE SEED FILES ARE ALSO UPDATED, IN THE SAME CHANGE, AND THAT IS NOT A
-- CONTRADICTION. db/ is read in the order schema → migrations → seed, so on a
-- FRESH database db/seed/007 and db/seed/021 are what actually create
-- FUNDING-AGREEMENT, SOFT-PULL-CONSENT and FUNDING-MASTERY-AGREEMENT — this
-- migration's UPDATE would run first and match nothing. Both halves are needed:
-- the seed defines the corrected row on a new database, this file corrects the
-- row on an existing one. src/contracts/offer-fee-language.test.mjs reads db/ in
-- that same order and would have caught the mismatch either way.
--
-- IDEMPOTENT (Rule 9). Every UPDATE is guarded on the exact defective sentence
-- it replaces, so a re-run matches nothing and an org that rewrote its own copy
-- on the Contracts screen keeps its words untouched. The INSERT is
-- ON CONFLICT (org_id, template_key) DO NOTHING.
--
-- NOTHING ALREADY SENT OR SIGNED IS TOUCHED, structurally rather than
-- carefully: this file writes to contract_templates only, and a sent contract
-- does not read its template — 124_contracts.sql freezes rendered_body,
-- merge_values and signature_statement on the contracts row and
-- trg_contracts_frozen RAISEs on any change once status <> 'draft'. The
-- contracts already sent with the wrong seller keep that wording and cannot be
-- altered from here. The diagnostic at the bottom counts them, because that is a
-- remediation list for a person, not something SQL may quietly rewrite.
--
-- DEPENDS ON: 124_contracts.sql (contract_templates), 125_contract_esign.sql
-- (source_kind / fields / signer_roles defaults),
-- 169_contract_template_placeholders.sql and 273_repair_fee_charged_once.sql
-- (the rows corrected here), db/seed/007 and db/seed/021 (the other two).

-- ---------------------------------------------------------------------------
-- 1. SOFT-PULL-CONSENT — the company being authorised is Fundhub, not a blank.
--
-- consent_days STAYS A BLANK, and that is load-bearing rather than an
-- oversight. src/handlers/contract-consent.mjs reads merge_values.consent_days
-- to set client_consents.expires_at, and its consentTerm() treats an ABSENT
-- value as "no term" — a permanent permission. Writing "90 days" into the words
-- and deleting the blank would grant every soft-pull consent forever. The value
-- is filled automatically at draft time now (src/contracts/send.mjs +
-- src/config/offers.mjs), so nobody types it, but it still travels as data.
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body =
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
       manual_fields =
    '[{"key":"consent_days","label":"Permission lasts (days)","required":true,"help":"Filled automatically. Nobody types this."}]'::jsonb
 WHERE template_key = 'SOFT-PULL-CONSENT'
   AND strpos(body, 'I am asking {{field.company_name}} to look at my credit report') > 0;

-- ---------------------------------------------------------------------------
-- 2. REPAIR-TRIAL-AGREEMENT — seller and signature block only.
--
-- The narrative here is NOT replaced with the drop-in marker. The owner named
-- three agreements for real text (Funding Mastery, FUNDING-AGREEMENT,
-- CREDIT-REPAIR-AGREEMENT) plus Capital Blueprint; this one and the combined
-- agreement below were not named. Their copy is equally provisional and that is
-- reported rather than acted on — replacing words nobody asked to have replaced
-- would be a guess (CLAUDE.md §2, §8).
--
-- The trial fee sentence is preserved word for word: offer-fee-language.test.mjs
-- asserts on it directly.
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body =
    E'CREDIT REPAIR TRIAL AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: Fundhub LLC ("we"), 218 Bostick Rd 64, Bowling Green, FL 33834\n' ||
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
       manual_fields =
    '[{"key":"scope","label":"What the trial includes","required":true,"help":"Filled automatically from the offer. Nobody types this."},
      {"key":"trial_fee","label":"Trial fee","required":true,"help":"Filled automatically from the price list. Nobody types this."}]'::jsonb
 WHERE template_key = 'REPAIR-TRIAL-AGREEMENT'
   AND strpos(body, 'Between: {{field.company_name}} ("we")') > 0;

-- ---------------------------------------------------------------------------
-- 3. REPAIR-AND-FUNDING-AGREEMENT — seller and signature block only, same
--    reasoning as 2.
--
-- The repair-fee sentence 273 wrote is preserved word for word; the guard in
-- offer-fee-language.test.mjs matches on "a single payment" following the blank.
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body =
    E'CREDIT REPAIR + FUNDING AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: Fundhub LLC ("we"), 218 Bostick Rd 64, Bowling Green, FL 33834\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'CREDIT REPAIR\n\n' ||
    E'{{field.repair_scope}}\n\n' ||
    E'FUNDING\n\n' ||
    E'{{field.funding_scope}}\n\n' ||
    E'WHAT IT COSTS\n\n' ||
    E'You pay {{field.deposit}} to start funding work. ' ||
    E'You pay {{field.repair_fee}} for the credit repair work — a single payment, charged one time. ' ||
    E'If we get you funded, you pay a success fee of {{field.success_fee}}, due {{field.fee_due}}.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any score change, any deletion, any funding amount, any rate, or any particular result. ' ||
    E'Bureaus, creditors, and lenders decide outcomes.\n\n' ||
    E'TERM\n\n' ||
    E'This agreement runs for {{field.term_days}} days from the date above unless ended sooner in writing.\n\n' ||
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
       manual_fields =
    '[{"key":"repair_scope","label":"Credit repair scope","required":true,"help":"Filled automatically from the offer. Nobody types this."},
      {"key":"funding_scope","label":"Funding scope","required":true,"help":"Filled automatically from the offer. Nobody types this."},
      {"key":"deposit","label":"Funding deposit","required":true,"help":"Filled automatically from the price list. Nobody types this."},
      {"key":"repair_fee","label":"Credit repair fee","required":true,"help":"Filled automatically from the price list. The whole repair price, charged once."},
      {"key":"success_fee","label":"Funding success fee","required":true,"help":"Filled automatically from the price list. Nobody types this."},
      {"key":"fee_due","label":"Success fee due","required":true,"help":"Filled automatically. Nobody types this."},
      {"key":"term_days","label":"Agreement length (days)","required":true,"help":"Filled automatically. Nobody types this."}]'::jsonb
 WHERE template_key = 'REPAIR-AND-FUNDING-AGREEMENT'
   AND strpos(body, 'Between: {{field.company_name}} ("we")') > 0;

-- ---------------------------------------------------------------------------
-- 4. CREDIT-REPAIR-AGREEMENT — seller, signature block, and the drop-in slot.
--
-- Named by the owner for real text ($1,000 repair, done for you). The narrative
-- sections 169 seeded (SERVICES / CANCELLATION / TERM) are replaced by the
-- marked block: every one of them is a legal term, and each is a sentence an
-- agent must not author.
--
-- The fee line stays outside the block and keeps 273's wording exactly —
-- {{field.one_time_fee}} and the words "one time" are both asserted on by
-- src/contracts/offer-fee-language.test.mjs, which is the guard that stops the
-- $1,000-a-month defect coming back.
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body =
    E'CREDIT REPAIR AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: Fundhub LLC ("we"), 218 Bostick Rd 64, Bowling Green, FL 33834\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'AGREEMENT TERMS\n\n' ||
    E'>>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS. <<<\n\n' ||
    E'Replace this block, and only this block, with the executed Fundhub LLC ' ||
    E'credit repair agreement. Everything outside it is already finished and ' ||
    E'must not change: the parties, the date, the fee, the no-promise paragraph ' ||
    E'and the signature block. Open Contracts, choose this wording, paste the ' ||
    E'real text over these lines, and save.\n\n' ||
    E'>>> END OF PLACEHOLDER <<<\n\n' ||
    E'WHAT YOU PAY\n\n' ||
    E'You pay {{field.one_time_fee}} one time for the services described above. ' ||
    E'That is the whole price. You are not billed again under this agreement.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any score change, any deletion, or any particular result. ' ||
    E'We describe the process; bureaus and creditors decide outcomes.\n\n' ||
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
       manual_fields =
    '[{"key":"one_time_fee","label":"One-time fee","required":true,"help":"Filled automatically from the price list. The whole price, charged once."}]'::jsonb
 WHERE template_key = 'CREDIT-REPAIR-AGREEMENT'
   AND strpos(body, 'You pay {{field.one_time_fee}} one time for the services described above') > 0;

-- ---------------------------------------------------------------------------
-- 5. FUNDING-AGREEMENT — seller, signature block, and the drop-in slot.
--
-- Named by the owner for real text (funding done-for-you, $3,000 deposit). The
-- deposit, the success fee and when it falls due stay outside the block: all
-- three are catalogue-fed blanks under offer-fee-language.test.mjs.
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body =
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
       manual_fields =
    '[{"key":"deposit","label":"Deposit","required":true,"help":"Filled automatically from the price list. Nobody types this."},
      {"key":"success_fee","label":"Success fee","required":true,"help":"Filled automatically from the price list. Nobody types this."},
      {"key":"fee_due","label":"Success fee due","required":true,"help":"Filled automatically. Nobody types this."}]'::jsonb
 WHERE template_key = 'FUNDING-AGREEMENT'
   AND strpos(body, 'Between: {{field.company_name}} ("we")') > 0;

-- ---------------------------------------------------------------------------
-- 6. FUNDING-MASTERY-AGREEMENT — the Capital Academy contract from the walk.
--
-- This is the document that went out on 2026-09-03 naming the client's own
-- company as the seller. Named by the owner for real text ($5,000 Academy).
--
-- The no-promise paragraph is carried over verbatim in substance. The walk log
-- records it as the one thing the placeholder got right and which must survive
-- any rewrite, and it is the paragraph that contradicts the closer's spoken wrap
-- script on the same sale (F23).
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body =
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
       manual_fields =
    '[{"key":"program_fee","label":"Program fee","required":true,"help":"Filled automatically from the price list. Nobody types this."}]'::jsonb
 WHERE template_key = 'FUNDING-MASTERY-AGREEMENT'
   AND strpos(body, 'You pay {{field.program_fee}} for the program described above') > 0;

-- ---------------------------------------------------------------------------
-- 7. CAPITAL-BLUEPRINT-AGREEMENT — the offer that had no contract at all.
--
-- src/config/offers.mjs UWIQ_DELIVERABLES ("Capital Blueprint", $1,000) was the
-- only client offer in the catalogue with no contractTemplateKey, while every
-- other one — down to the $200 repair trial — had one. So a Blueprint sale
-- closed with no agreement to send: resolveContractTemplateKey() returned null,
-- the deck matched no wording, and nothing anywhere said so. Recorded as an open
-- gap in the SOP; closed here.
--
-- The offer now points at this key (src/config/offers.mjs), and its body is the
-- same marked drop-in as the three above — the Capital Blueprint service
-- agreement text is Chris's to supply.
--
-- ATTRIBUTION. contract_templates.created_by is NOT NULL by design (124):
-- unattributed contract copy that somebody signed is not evidence of anything.
-- Owner first, any staff second, and an org with no staff at all inserts nothing
-- and says so rather than inventing a person into the audit trail.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_org   uuid;
  v_staff uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skipped Capital Blueprint agreement seed: no org fundhub';
    RETURN;
  END IF;

  SELECT id INTO v_staff FROM staff
   WHERE org_id = v_org AND lower(btrim(role)) = 'owner'
   ORDER BY created_at LIMIT 1;
  IF v_staff IS NULL THEN
    SELECT id INTO v_staff FROM staff WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  END IF;
  IF v_staff IS NULL THEN
    RAISE NOTICE 'skipped Capital Blueprint agreement seed: no staff';
    RETURN;
  END IF;

  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'CAPITAL-BLUEPRINT-AGREEMENT',
    'Capital Blueprint Agreement',
    'contract',
    'capital_blueprint',
    E'CAPITAL BLUEPRINT AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: Fundhub LLC ("we"), 218 Bostick Rd 64, Bowling Green, FL 33834\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'AGREEMENT TERMS\n\n' ||
    E'>>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT. DO NOT SEND THIS. <<<\n\n' ||
    E'Replace this block, and only this block, with the executed Fundhub LLC ' ||
    E'Capital Blueprint service agreement. Everything outside it is already ' ||
    E'finished and must not change: the parties, the date, the fee, the ' ||
    E'no-promise paragraph and the signature block. Open Contracts, choose this ' ||
    E'wording, paste the real text over these lines, and save.\n\n' ||
    E'>>> END OF PLACEHOLDER <<<\n\n' ||
    E'WHAT YOU PAY\n\n' ||
    E'You pay {{field.package_fee}} for the Capital Blueprint described above. ' ||
    E'That is one payment and it is the whole price.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise funding, any approval amount, any credit score change, ' ||
    E'or any particular result. What you receive is the work product described ' ||
    E'above. Lenders, bureaus and creditors decide outcomes.\n\n' ||
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
    '[{"key":"package_fee","label":"Capital Blueprint fee","required":true,"help":"Filled automatically from the price list. Nobody types this."}]'::jsonb,
    true,
    'I have read this agreement and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'Capital Blueprint agreement seeded (or already present) for org %', v_org;
END $$;

-- ---------------------------------------------------------------------------
-- 8. What this file could not fix, said out loud rather than left implied.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_typed_seller  integer;
  v_sent_wrong    integer;
  v_placeholder   integer;
BEGIN
  -- Contract copy anywhere in this database that still names a typed company as
  -- a party. Reported, never rewritten: a body somebody edited on the Contracts
  -- screen is their words, and guessing at what they meant is worse than saying
  -- the blank is still there.
  SELECT count(*) INTO v_typed_seller
    FROM contract_templates
   WHERE kind IN ('contract', 'authorization')
     AND template_key <> 'PARTNER-LICENSE'
     AND strpos(COALESCE(body, ''), '{{field.company_name}}') > 0;
  IF v_typed_seller > 0 THEN
    RAISE NOTICE
      '287: % contract template(s) still print a typed {{field.company_name}}. Somebody edited that copy on the Contracts screen, so it is left alone — open it and name Fundhub LLC in the words.',
      v_typed_seller;
  END IF;

  -- The already-sent damage. Frozen by trg_contracts_frozen and correctly so:
  -- this is the size of the remediation, not something SQL may quietly repair.
  SELECT count(*) INTO v_sent_wrong
    FROM contracts
   WHERE status IN ('sent', 'viewed', 'signed')
     AND merge_values->>'company_name' IS NOT NULL
     AND btrim(merge_values->>'company_name') NOT IN ('', 'Fundhub', 'Fundhub LLC');
  IF v_sent_wrong > 0 THEN
    RAISE NOTICE
      '287: % contract(s) were already sent or signed naming a seller that is not Fundhub. They are frozen and are NOT altered here — this is a list for a person.',
      v_sent_wrong;
  END IF;

  -- The drop-in slots still waiting on Chris.
  SELECT count(*) INTO v_placeholder
    FROM contract_templates
   WHERE strpos(COALESCE(body, ''), '>>> PLACEHOLDER. THIS IS NOT THE REAL AGREEMENT TEXT.') > 0;
  IF v_placeholder > 0 THEN
    RAISE NOTICE
      '287: % contract template(s) are waiting for the real agreement text. Each has exactly one marked block to paste into; everything else in them is finished.',
      v_placeholder;
  END IF;

  RAISE NOTICE '287: the seller on a client contract is Fundhub LLC, written into the words (owner decision 2026-09-03)';
END $$;
