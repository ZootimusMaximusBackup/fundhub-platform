-- 273_repair_fee_charged_once.sql — the repair fee is ONE payment, and the
-- contract has to say so.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): fee timing on a regulated
-- consumer-finance product.
--
-- THE DEFECT. src/config/offers.mjs prices REPAIR_DFY at 100000 integer cents —
-- $1,000, charged once. The seeded CREDIT-REPAIR-AGREEMENT body from
-- 169_contract_template_placeholders.sql reads:
--
--     You pay {{field.monthly_fee}} per month while services are active …
--
-- and defaultContractValues() fills that blank with the SAME $1,000 price, plus
-- a 180-day term. So the document a client signed said one thousand dollars a
-- month for a hundred and eighty days — six thousand dollars — against a
-- product that costs one thousand dollars, one time. Owner decision 2026-08-31:
-- the PRICE is right, the WORDING is wrong. This file fixes the wording.
--
-- The same product's fee is stated a second time, in
-- REPAIR-AND-FUNDING-AGREEMENT. Its body sentence ("Credit repair fees:
-- {{field.repair_fee}}.") does not say "per month", but its staff-facing help
-- text reads "For example: $1,000/month or bundled amount", which is where the
-- first defect was written from. Both are corrected here so the repair fee
-- reads the same way everywhere it appears.
--
-- WHY A NEW FILE RATHER THAN AN EDIT TO 169. db/migrate.mjs records each file in
-- schema_migrations keyed '<dir>/<file>'. An applied file is never read again,
-- so editing 169 is a silent no-op on every database that already ran it.
--
-- NOTHING ALREADY SIGNED IS TOUCHED, AND THAT IS STRUCTURAL RATHER THAN
-- CAREFUL. This file writes to contract_templates and to nothing else. A sent
-- contract does not read its template: 124_contracts.sql freezes the words on
-- the contracts row itself (rendered_body, merge_values, signature_statement)
-- and trg_contracts_frozen RAISEs on any UPDATE that changes them once
-- status <> 'draft', with a second refusal covering everything about a
-- signature once signed_at is set. document_versions.checksum is the
-- independent proof. So a template edit cannot reach back into a signed
-- agreement even deliberately, which is the property that makes editing
-- contract copy from a screen safe at all (src/contracts/templates.mjs says the
-- same at its header).
--
-- Consequence, stated plainly rather than fixed here: the clients who already
-- signed the monthly wording still hold that document, unchanged and
-- unchangeable. This migration ends the defect for every future send; it does
-- not remediate the past ones. The diagnostic at the bottom counts them so the
-- list is visible instead of assumed.
--
-- IDEMPOTENT (Rule 9). Each UPDATE is guarded on the defective text it
-- replaces, so a re-run matches nothing. The same guard means an org that
-- rewrote this copy on the Contracts screen keeps its own words — only the
-- untouched, defective copy is corrected.
--
-- DEPENDS ON: 124_contracts.sql (contract_templates),
-- 169_contract_template_placeholders.sql (the rows corrected here).

-- ---------------------------------------------------------------------------
-- 1. CREDIT-REPAIR-AGREEMENT — one payment, and a blank named for what it is.
--
-- The placeholder is renamed monthly_fee → one_time_fee deliberately. A blank
-- called "monthly_fee" invites the next person to write a monthly sentence
-- around it; the name is half of how this defect happened. src/config/offers.mjs
-- fills the new name, and src/contracts/offer-fee-language.test.mjs fails if the
-- two ever disagree again.
--
-- Every org that holds the defective row is corrected, not just 'fundhub' —
-- the WHERE clause identifies the copy by its wording, so which org it belongs
-- to is not the question that matters.
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body =
    E'CREDIT REPAIR AGREEMENT\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: {{field.company_name}} ("we")\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n\n' ||
    E'SERVICES\n\n' ||
    E'{{field.scope}}\n\n' ||
    E'FEES\n\n' ||
    E'You pay {{field.one_time_fee}} one time for the services described above. ' ||
    E'That is the whole price. You are not billed again under this agreement.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any score change, any deletion, or any particular result. ' ||
    E'We describe the process; bureaus and creditors decide outcomes.\n\n' ||
    E'CANCELLATION\n\n' ||
    E'Either of us may end this agreement in writing. Fees already paid are handled per ' ||
    E'{{field.company_name}} policy in effect when you signed.\n\n' ||
    E'TERM\n\n' ||
    E'This agreement runs for {{field.term_days}} days from the date above unless ended sooner in writing. ' ||
    E'The fee above does not change with the length of that term.\n\n' ||
    E'YOUR COPY\n\n' ||
    E'When you sign, the exact wording above is saved with the time you signed it.',
       manual_fields =
    '[{"key":"company_name","label":"Company name","required":true,"help":"Legal entity name"},
      {"key":"scope","label":"What we will do","required":true,"help":"Disputes, rounds, dashboard access — plain language"},
      {"key":"one_time_fee","label":"One-time fee","required":true,"help":"For example: $1,000. The whole price, charged once."},
      {"key":"term_days","label":"Agreement length (days)","required":true,"help":"For example: 180"}]'::jsonb
-- strpos, not LIKE: `_` is a LIKE wildcard and these blanks are full of them.
-- The match is the sentence 169 seeded, word for word, so a body somebody
-- rewrote on the Contracts screen is left alone here and handled by statement 3.
 WHERE template_key = 'CREDIT-REPAIR-AGREEMENT'
   AND strpos(body, 'You pay {{field.monthly_fee}} per month while services are active') > 0;

-- ---------------------------------------------------------------------------
-- 2. REPAIR-AND-FUNDING-AGREEMENT — the same fee, said the same way.
--
-- The client-facing sentence was ambiguous rather than wrong ("Credit repair
-- fees: {{field.repair_fee}}."), and the help text under the blank was where a
-- staff member was told to type a monthly figure. Both now say a single
-- payment. The blank keeps its name — `repair_fee` carries no recurrence in it,
-- so renaming would change src/config/offers.mjs for no gain.
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body =
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
    E'You pay {{field.deposit}} to start funding work. ' ||
    E'You pay {{field.repair_fee}} for the credit repair work — a single payment, charged one time. ' ||
    E'If we get you funded, you pay a success fee of {{field.success_fee}}, due {{field.fee_due}}.\n\n' ||
    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise any score change, any deletion, any funding amount, any rate, or any particular result. ' ||
    E'Bureaus, creditors, and lenders decide outcomes.\n\n' ||
    E'TERM\n\n' ||
    E'This agreement runs for {{field.term_days}} days from the date above unless ended sooner in writing.\n\n' ||
    E'YOUR COPY\n\n' ||
    E'When you sign, the exact wording above is saved with the time you signed it.',
       manual_fields =
    '[{"key":"company_name","label":"Company name","required":true,"help":"Legal entity name"},
      {"key":"repair_scope","label":"Credit repair scope","required":true,"help":"Disputes, rounds, parallel bureaus if needed"},
      {"key":"funding_scope","label":"Funding scope","required":true,"help":"Applications, rounds, inquiry sweeps — plain language"},
      {"key":"deposit","label":"Funding deposit","required":true,"help":"For example: $3,000"},
      {"key":"repair_fee","label":"Credit repair fee","required":true,"help":"For example: $1,000. The whole repair price, charged once."},
      {"key":"success_fee","label":"Funding success fee","required":true,"help":"For example: 10% of funded amount"},
      {"key":"fee_due","label":"Success fee due","required":true,"help":"For example: within 7 days of funding"},
      {"key":"term_days","label":"Agreement length (days)","required":true,"help":"For example: 180"}]'::jsonb
 WHERE template_key = 'REPAIR-AND-FUNDING-AGREEMENT'
   AND strpos(body, 'Credit repair fees: {{field.repair_fee}}') > 0;

-- ---------------------------------------------------------------------------
-- 3. A row whose sentence somebody rewrote, but that still names the old blank.
--
-- Statement 1 only rewrites copy that is still word-for-word what 169 seeded.
-- An org that edited the sentence and kept the blank would be left holding
-- {{field.monthly_fee}}, which nothing fills any more — a fee that renders
-- empty is worse than a fee that is wrong. So the blank is renamed on its own,
-- wherever it survives. The wording of such a row is NOT guessed at: statement
-- 4 reports it instead.
-- ---------------------------------------------------------------------------
UPDATE contract_templates
   SET body = replace(body, '{{field.monthly_fee}}', '{{field.one_time_fee}}'),
       -- COALESCE because jsonb_agg over an empty array returns NULL, and
       -- manual_fields is NOT NULL. A template with no blanks keeps the empty
       -- array it already has rather than failing the migration.
       manual_fields = COALESCE((
         SELECT jsonb_agg(
                  CASE WHEN e->>'key' = 'monthly_fee'
                       THEN jsonb_build_object(
                              'key', 'one_time_fee',
                              'label', 'One-time fee',
                              'required', COALESCE(e->'required', 'true'::jsonb),
                              'help', 'For example: $1,000. The whole price, charged once.')
                       ELSE e END
                  ORDER BY ord)
           FROM jsonb_array_elements(contract_templates.manual_fields)
                WITH ORDINALITY AS a(e, ord)), contract_templates.manual_fields)
 WHERE template_key = 'CREDIT-REPAIR-AGREEMENT'
   AND strpos(body, '{{field.monthly_fee}}') > 0;

-- ---------------------------------------------------------------------------
-- 4. What this file could not fix, said out loud.
--
-- Read-only. Two counts, both of which a person has to act on rather than a
-- migration:
--
--   * repair contract copy that still describes a recurring fee in words this
--     file did not recognise. Nothing is guessed at — the copy is reported, not
--     rewritten.
--   * contracts ALREADY SENT OR SIGNED carrying the monthly wording. These are
--     frozen by trg_contracts_frozen and must stay that way; the number is the
--     size of the remediation, not something to repair in SQL.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_copy   integer;
  v_signed integer;
BEGIN
  SELECT count(*) INTO v_copy
    FROM contract_templates
   WHERE template_key IN ('CREDIT-REPAIR-AGREEMENT', 'REPAIR-AND-FUNDING-AGREEMENT')
     AND body ILIKE '%per month%';
  IF v_copy > 0 THEN
    RAISE NOTICE '273: % repair template(s) still describe a recurring fee in wording this migration did not recognise — open the Contracts screen and correct them by hand', v_copy;
  END IF;

  SELECT count(*) INTO v_signed
    FROM contracts
   WHERE template_key IN ('CREDIT-REPAIR-AGREEMENT', 'REPAIR-AND-FUNDING-AGREEMENT')
     AND status IN ('sent', 'viewed', 'signed')
     AND rendered_body ILIKE '%per month%';
  IF v_signed > 0 THEN
    RAISE NOTICE '273: % contract(s) already sent or signed carry the monthly repair wording. They are frozen and are NOT altered here — this is a remediation list for a person, not a schema problem', v_signed;
  END IF;

  RAISE NOTICE '273: repair fee wording is a single payment (owner decision 2026-08-31)';
END $$;
