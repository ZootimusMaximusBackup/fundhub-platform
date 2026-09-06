-- 362_waypoint_definitions_seed.sql — the six client tasks, and only the six.
--
-- SOURCE. These are the client's own tasks as the Credit Optimization Roadmap
-- (scripts/black-reports/fundhub_gen.py) actually states them, minus everything
-- the owner has ruled out or the platform cannot stand behind:
--
--   fundhub_gen.py:1369  Step 1  the paydown table, per revolving account
--   fundhub_gen.py:1404  Step 5  file the LLC, open a business checking account
--   fundhub_gen.py:1411  Step 6  take the personal loan NOW, open no new credit
--   fundhub_gen.py:1480  Month 5 get the EIN from the IRS
--
-- NOT SEEDED, ON PURPOSE:
--   * DUNS / Dun & Bradstreet (fundhub_gen.py:1481) — "we dont do DUNS",
--     Chris 2026-09-05.
--   * Net-30 vendor accounts and Paydex (fundhub_gen.py:1483) — same decision,
--     and there is no vendor list, no Paydex field and no business-credit
--     tracking anywhere in the platform, so the row could never be closed.
--   * The dispute rounds and the inquiry-removal letters (Steps 2, 3, 4). Those
--     are our work, not the client's.
--
-- DUE DATES, and why three of them are NULL. The roadmap contradicts itself on
-- the business steps: Step 5 puts "open a business checking account" in Month 1
-- and Month 5 puts it at Month 5, and the whole six-month sequence is recorded
-- as NOT FINALISED (TODO.md item 0). Inventing a date so a screen has something
-- to draw would mean chasing a real client against a deadline nobody set. So
-- the three Month-1 items the roadmap states unambiguously get a deadline, and
-- the unsettled ones get NULL, which is never overdue. When the strategy is
-- settled these are one UPDATE.
--
-- NO PAID ALTERNATIVES. Every price in this column is NULL, and that is a
-- measurement, not a placeholder: the only priced self-serve product this
-- platform has is a dispute round (src/waypoints/pricing.mjs, $100 flat), and a
-- dispute round is not on this list because it is not the client's job. We do
-- not file LLCs, we do not get EINs and we do not open bank accounts, so
-- offering to do any of them for money would be a promise nothing behind the
-- button can keep. The column and the whole path through the seeder are built
-- and tested; the day one of these is priced it is an UPDATE.
--
-- SAFETY. Additive. Six rows into a table 361 just created. ON CONFLICT DO
-- NOTHING, so re-running changes nothing and so does applying this to a
-- database where somebody has already edited the copy.

INSERT INTO public.waypoint_definitions
  (key, expands, title, detail, position, owner_kind,
   due_offset_days, verify_kind, notes)
VALUES

  -- 1. THE PAYDOWN TABLE. One waypoint per revolving account on the freshest
  -- credit file. {creditor} and {target} are filled per account by the seeder,
  -- and {target} is formatted from integer cents held in the waypoint's params.
  ('paydown_revolving_account', 'per_revolving_account',
   'Pay {creditor} down to {target}',
   'This is the single biggest lever on your score. You do not have to do it all at once — every payment that lands moves the number.',
   10, 'client', 30, 'paydown',
   'Roadmap Month 1 Step 1. Verifiable: a re-pull reports the balance, so the row closes itself when the balance reaches the target and stays open when it does not.'),

  -- 2. DO NOT OPEN NEW CREDIT. An ongoing rule rather than a task, so it has no
  -- deadline and it is never auto-completed — the check can only ever find
  -- evidence that it was BROKEN, never evidence that it was kept.
  ('no_new_credit', 'once',
   'Do not open new credit until your funding is secured',
   'A new card lowers your average account age and adds a hard inquiry, and both of those work against the pre-approval you are building toward. Get the funding first.',
   20, 'client', NULL, 'no_new_credit',
   'Roadmap Month 1 Step 6. Verifiable in one direction only: a re-pull showing a revolving account that was not on the file at enrolment is positive evidence the rule was broken. Nothing is evidence that it was kept, so this row never closes on its own.'),

  -- 3. THE PERSONAL LOAN, FIRST. Fourteen days because the roadmap's whole
  -- argument is that this one is time-critical: it is worth less after the
  -- optimisation work starts moving accounts around.
  ('personal_loan', 'once',
   'Secure your personal loan now',
   'You qualify today, before any of the optimization work lands. Take it first — anything you open after this point costs you more than it gives you.',
   30, 'client', 14, NULL,
   'Roadmap Month 1 Step 6. NOT verifiable. A new loan on a re-pull is indistinguishable from any other new account, and reading one as "they took our advice" would be a guess.'),

  -- 4. THE LLC. {state_clause} is " in Texas" when we know the state and
  -- nothing at all when we do not, so the sentence reads either way.
  ('form_llc', 'once',
   'File your LLC',
   'File online with the Secretary of State{state_clause}. Once it is filed the clock starts, and lenders count how old the entity is.',
   40, 'client', 30, NULL,
   'Roadmap Month 1 Step 5. NOT verifiable — no Secretary of State feed exists in this platform, and the businesses table records what somebody typed, not what was filed.'),

  -- 5. THE EIN. No deadline: the roadmap files it under Month 5 and the
  -- six-month sequence is not settled.
  ('get_ein', 'once',
   'Get your EIN from the IRS',
   'It is free at IRS.gov and it takes about ten minutes. Your business bank account will ask for it.',
   50, 'client', NULL, NULL,
   'Roadmap Month 5. NOT verifiable — nothing in the platform can see an IRS record, so this stays open until a person says otherwise.'),

  -- 6. THE BUSINESS BANK ACCOUNT. Same: no deadline until the sequence is
  -- settled.
  ('business_checking', 'once',
   'Open a business checking account',
   'Under the LLC name, using the EIN. Even a hundred dollars in it is enough to start.',
   60, 'client', NULL, NULL,
   'Roadmap Month 1 Step 5 and Month 5 — the document says both, which is one of the reasons the six-month sequence is recorded as unfinalised. NOT verifiable: no bank feed.')

ON CONFLICT (key) DO NOTHING;
