-- 283_partner_license_template.sql — the document the partner payout gate has
-- been waiting for since 042.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this seeds customer-facing contract
-- copy covering fee timing, refund behaviour and payout behaviour on a regulated
-- consumer-finance product.
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE DEFECT THIS CLOSES.
--
-- 042_partners.sql created partner_payouts and a database trigger,
-- partner_payout_agreement_gate(), that RAISEs on any attempt to move a payout
-- run to 'processing' or 'paid' while partners.agreement_signed_at is NULL. The
-- comment on that column reads "mirroring the affiliate partner-license hold in
-- 033" — and 033_affiliates.sql really does hold affiliate money the same way
-- (affiliates.partner_license_signed_at, enforced in affiliate_payouts_guard()
-- at line ~587).
--
-- 030_documents.sql names the document those two holds are named after:
--
--     contract   partner_license   — the affiliate portal gates payouts on this one
--
-- Every piece of that chain shipped EXCEPT the document itself. There is no
-- PARTNER-LICENSE row in contract_templates, in db/migrations or in db/seed, and
-- src/documents/kinds.mjs lists the `partner_license` subtype with nothing that
-- ever produces one. So the state a partner can reach today is:
--
--     approved  →  produces  →  accrues partner_revenue  →  NEVER PAYABLE
--
-- because the only way past the gate is a timestamp that nothing can honestly
-- stamp. A gate whose key does not exist is not a control; it is an outage
-- waiting for the first partner who earns something. This file mints the key.
--
-- ══════════════════════════════════════════════════════════════════════════
-- WHAT THE COPY SAYS, AND WHY EACH NUMBER IS WHERE IT IS.
--
-- Every commercial term below is owner-set in docs/specs/W0-decisions.md
-- (2026-08-31). They are recorded here as fact.
--
--   50% of funding and repair, front end and back end, including half the 10%
--   success fee, and it never moves  ·  e-products excluded  ·  $10,000 once
--   with nothing ongoing  ·  the partner's own affiliates come out of the
--   PARTNER'S half  ·  10 funding clients per calendar month, with the
--   warning → final notice (30-day cure) → 50%-to-20%-on-new-business ladder
--   from W1-money-model.md §6  ·  fast payouts, no hold-back, no clawback  ·
--   a 3-day refund window on the joining fee  ·  no lender data, ever  ·
--   FundHub performs all fulfilment.
--
-- THE OWNER-SET NUMBERS ARE IN THE SENTENCES, NOT IN BLANKS. This is the direct
-- lesson of 273_repair_fee_charged_once.sql: a blank called `monthly_fee` sitting
-- in a sentence reading "per month", filled from a separate file, is how every
-- repair client came to sign for $1,000 a month against a $1,000 product. Two
-- halves, each correct, meeting wrongly, with nothing looking at the meeting.
--
-- W0 fixes 50, 20, 10, 30 and 10% for EVERY partner — they are not per-deal — so
-- putting them in blanks would create the same seam for no flexibility anybody
-- asked for. They are written into the words, and
-- src/contracts/partner-license-terms.test.mjs fails if the words stop matching
-- src/partners/floors.mjs (FLOOR_CLIENTS_PER_MONTH, DOWNGRADED_SHARE_PCT,
-- CURE_DAYS), src/config/offers.mjs (PARTNER_ENTRY.priceCents,
-- FUNDING_DFY.successFeePercent) or partners.revenue_share_pct's schema default.
-- Only what genuinely differs per partner is a blank: the legal entity name and
-- the partner's own brand.
--
-- NO EARNINGS FIGURE APPEARS ANYWHERE IN THIS DOCUMENT, and that is a hard rule
-- rather than an oversight: FundHub has zero measured paid closes
-- (W1-money-model.md F3). The dollar amounts here are what the partner PAYS and
-- the percentages are how a split is computed. Neither is a projection of what
-- anybody will make, and the copy states plainly that nothing in it is one.
-- src/contracts/partner-license-terms.test.mjs fails on an earnings-claim
-- pattern anywhere in the body, the blanks or the signature line.
--
-- THE FICO FLOOR IS DELIBERATELY NOT IN THE SIGNED WORDS. W0 records that entry
-- is financeable down to 405 FICO. That is a fact about a lender's current
-- appetite, not a term between FundHub and the partner, and a lender cutoff that
-- moves next quarter would leave a signed document saying something false. What
-- the document states instead is the term that actually binds: financing is a
-- way to PAY, never a qualification, and the review call decides who becomes a
-- partner. Absence recorded rather than filled in (CLAUDE.md §2).
--
-- ══════════════════════════════════════════════════════════════════════════
-- THE COPY DESCRIBES NO CHARGE THAT REPEATS, and the vocabulary is avoided
-- rather than negated. "No monthly fee" contains the word monthly; a screen, a
-- summariser or a person skimming can carry that word away from its negation.
-- The base program has nothing ongoing, so the document says so in words that
-- cannot be misread on their own, and the production floor is stated as "each
-- calendar month" so a production period is never read as a billing period.
-- The same RECURRING vocabulary offer-fee-language.test.mjs polices on client
-- contracts is held against this one.
--
-- ══════════════════════════════════════════════════════════════════════════
-- IDEMPOTENT (Rule 9), org-scoped, and non-destructive. ON CONFLICT DO NOTHING
-- on (org_id, template_key), exactly as 169 and db/seed/021 do. An org that has
-- already edited this copy on the Contracts screen keeps its own words. Nothing
-- already signed can be touched from here: 124_contracts.sql freezes
-- rendered_body / merge_values / signature_statement on the contracts row and
-- trg_contracts_frozen RAISEs on any change once status <> 'draft'.
--
-- DEPENDS ON: 124_contracts.sql (contract_templates), 125_contract_esign.sql
-- (source_kind defaults), 042_partners.sql (the gate this document unlocks),
-- 030_documents.sql (the `partner_license` subtype used below).

DO $$
DECLARE
  v_org   uuid;
  v_staff uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE slug = 'fundhub' LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE 'skipped partner license seed: no org fundhub';
    RETURN;
  END IF;

  -- created_by is NOT NULL by design (124): unattributed contract copy that
  -- somebody signed is not evidence of anything.
  SELECT id INTO v_staff FROM staff
   WHERE org_id = v_org AND lower(btrim(role)) = 'owner'
   ORDER BY created_at LIMIT 1;
  IF v_staff IS NULL THEN
    SELECT id INTO v_staff FROM staff WHERE org_id = v_org ORDER BY created_at LIMIT 1;
  END IF;
  IF v_staff IS NULL THEN
    RAISE NOTICE 'skipped partner license seed: no staff';
    RETURN;
  END IF;

  INSERT INTO contract_templates
    (org_id, template_key, name, kind, subtype, body, manual_fields,
     signature_required, signature_statement, created_by)
  VALUES (
    v_org,
    'PARTNER-LICENSE',
    'White-Label Partner License',
    'contract',
    'partner_license',

    E'WHITE-LABEL PARTNER LICENSE\n\n' ||
    E'Date: {{today}}\n' ||
    E'Between: {{field.company_name}} ("FundHub", "we")\n' ||
    E'And: {{contact.full_name}} ("you")\n' ||
    E'Your email: {{contact.email}}\n' ||
    E'Your brand: {{field.partner_brand}}\n\n' ||

    E'WHAT THIS IS\n\n' ||
    E'You run your own brand. We do the work behind it. You bring people who ' ||
    E'want funding help and credit repair help. We serve those people under ' ||
    E'your brand name, and you and we split what they pay.\n\n' ||

    E'WHO DOES THE WORK\n\n' ||
    E'We do. FundHub performs all fulfilment — the whole of the funding work ' ||
    E'and the whole of the credit repair work, from the first call to the last ' ||
    E'step. You are not asked to deliver any part of it yourself.\n\n' ||

    E'WHAT YOU PAY TO JOIN\n\n' ||
    E'You pay $10,000 to join. You pay it one time. There is nothing ongoing: ' ||
    E'the partner program itself carries no repeating charge of any kind, and ' ||
    E'you are never billed again for it.\n\n' ||
    E'You may pay the joining fee in full, or over time through a payment plan. ' ||
    E'A payment plan is a way to pay. It is not a test you have to pass, and no ' ||
    E'lender decides whether you become a partner. The review call decides that.\n\n' ||

    E'CHANGING YOUR MIND ABOUT THE JOINING FEE\n\n' ||
    E'You have 3 days from the day you pay to ask for the joining fee back. ' ||
    E'Write to us inside those 3 days and we return it. After the third day the ' ||
    E'joining fee is not refundable.\n\n' ||

    E'HOW THE MONEY IS SPLIT\n\n' ||
    E'You keep 50%. We keep 50%.\n\n' ||
    E'That is half of what the clients on your book pay for funding work, and ' ||
    E'half of what they pay for credit repair work. It covers the money paid at ' ||
    E'the start — the front end — and the money paid later — the back end. It ' ||
    E'includes half of the 10% success fee a client pays when they get funded.\n\n' ||
    E'This split does not change. Nothing you add on, buy, or stop buying moves ' ||
    E'it, in either direction.\n\n' ||

    E'WHAT THE SPLIT DOES NOT COVER\n\n' ||
    E'Courses, training and other digital products are not split. Those stay ' ||
    E'with FundHub in full, whoever the buyer came from.\n\n' ||

    E'YOUR OWN AFFILIATES\n\n' ||
    E'You may bring on your own affiliates. What we pay them comes out of your ' ||
    E'half, not out of ours. FundHub''s 50% never moves.\n\n' ||

    E'HOW YOU GET PAID\n\n' ||
    E'We pay you as fast as we can, and we do not sit on your money.\n\n' ||
    E'There is no hold-back. Once your share is recorded it goes into the next ' ||
    E'payout run — we do not park a percentage of it somewhere to be released ' ||
    E'later, and we do not hold your payout because one of your affiliates has ' ||
    E'a client who has not bought yet.\n\n' ||
    E'There is no clawback. Money we have already paid you is yours. If a client ' ||
    E'later refunds or reverses a charge, that is our loss and we do not take it ' ||
    E'back out of you or out of a future payout.\n\n' ||

    E'STAYING A PARTNER: THE PRODUCTION MINIMUM\n\n' ||
    E'You need at least 10 funding clients in each calendar month. A funding ' ||
    E'client is a person on your book who paid the funding deposit and kept it — ' ||
    E'a deposit that came all the way back to them does not count.\n\n' ||
    E'This is the only bar you have to clear, so here is exactly what happens if ' ||
    E'you fall under it:\n\n' ||
    E'1. Miss it once. We write to you. That letter is a warning. It names the ' ||
    E'number you reached and the date of the next check.\n' ||
    E'2. Miss it twice in a row. We write again. That letter is your final ' ||
    E'notice, and it starts a 30-day period to put it right.\n' ||
    E'3. Miss it three times in a row. Your share moves from 50% to 20%, and ' ||
    E'that applies to NEW business only. Everything you already earned stays ' ||
    E'exactly as it was: nothing already paid is taken back and nothing already ' ||
    E'recorded is recalculated.\n' ||
    E'4. Clear the minimum again for one full check. Your share goes back to ' ||
    E'50% on new business from that point.\n\n' ||

    E'WHAT YOU CAN SEE, AND WHAT YOU CANNOT\n\n' ||
    E'You get your own partner screens. You do not get the client management ' ||
    E'system, and you cannot open, move or edit a client file inside it.\n\n' ||
    E'You are never shown lender data. Not which lenders we use, not their ' ||
    E'names, not their rules, not their appetite, and not what any of them said ' ||
    E'about anybody''s file. The same applies to every affiliate you bring on.\n\n' ||

    E'WHAT WE DO NOT PROMISE\n\n' ||
    E'We do not promise you any amount of money, any number of clients, any ' ||
    E'sale, any funding approval, any credit score change, or any particular ' ||
    E'outcome — not for you and not for anybody on your book. Nothing written ' ||
    E'above is a forecast of what you will be paid. Lenders, credit bureaus and ' ||
    E'creditors decide outcomes, and the people you bring decide whether they ' ||
    E'buy anything at all.\n\n' ||

    E'ENDING THIS\n\n' ||
    E'Either of us may end this agreement in writing. Money already earned is ' ||
    E'still paid to you after it ends, on the same terms as above.\n\n' ||

    E'YOUR COPY\n\n' ||
    E'When you sign, the exact wording above is saved with the time you signed it.',

    -- Only what genuinely differs from one partner to the next. Neither blank
    -- holds money, a percentage or a period, which is the whole point: there is
    -- no seam here for a fill-in from another file to drift through.
    '[{"key":"company_name","label":"Company name","required":true,"help":"Legal entity name — the FundHub side of this agreement"},
      {"key":"partner_brand","label":"Partner brand name","required":true,"help":"The name this partner''s own clients will see"}]'::jsonb,

    true,
    'I have read this partner license and I agree to it. Typing my name here is my signature.',
    v_staff
  )
  ON CONFLICT (org_id, template_key) DO NOTHING;

  RAISE NOTICE 'partner license template seeded (or already present) for org %', v_org;
END $$;

-- ---------------------------------------------------------------------------
-- What is still true after this file runs, said out loud rather than assumed.
--
-- Read-only. Seeding the template does not sign anything, so any partner who was
-- approved before today is still sitting behind 042's gate with revenue accruing
-- and nothing releasing. That is correct — a payout gate is supposed to hold —
-- but it is a list of people somebody has to send this document to, not a state
-- the migration can clear on their behalf. Stamping agreement_signed_at without
-- a signed document is exactly the hole this file exists to close, so it is not
-- done here and src/contracts/partner-license.mjs refuses to do it either.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_unsigned integer;
  v_holding  integer;
BEGIN
  SELECT count(*) INTO v_unsigned
    FROM partners WHERE status IN ('invited', 'active') AND agreement_signed_at IS NULL;

  SELECT count(*) INTO v_holding
    FROM partner_revenue r
    JOIN partners p ON p.id = r.partner_id
   WHERE r.status = 'accrued' AND p.agreement_signed_at IS NULL;

  IF v_unsigned > 0 THEN
    RAISE NOTICE
      '283: % partner(s) have not signed a partner license. Their payouts stay held by 042''s gate until they do — send them PARTNER-LICENSE from the Contracts screen.',
      v_unsigned;
  END IF;
  IF v_holding > 0 THEN
    RAISE NOTICE
      '283: % accrued partner_revenue row(s) belong to partners with no signed license. The money is recorded and is NOT payable yet.',
      v_holding;
  END IF;

  RAISE NOTICE '283: PARTNER-LICENSE is the document 042''s payout gate holds out for (owner terms: docs/specs/W0-decisions.md, 2026-08-31)';
END $$;
