-- 095_tradeline_card_identity.sql — the two facts a HAND-ENTERED credit card has
-- that a bureau file does not carry: which card it is, and when it was opened.
--
-- WHY THIS IS NEEDED NOW. 054 built `tradelines` for one origin — lines read out
-- of a soft pull by src/tradelines/index.mjs — and every column in it is a field
-- a bureau payload actually contains. The card-stack screen adds the second
-- origin 054's own header promised ("manual entry for the metadata a bureau file
-- does not carry", 054:15) and it needs two things that origin has and the
-- bureau one does not:
--
--   last4      — a person types "the Chase ending 4417", not an internal
--                account reference. `account_ref` is NOT the place for this and
--                putting it there would be a data-loss bug rather than a style
--                choice: uq_tradelines_account is UNIQUE on
--                (client_id, account_ref), so a client holding two cards that
--                both end 4417 — two Amex products on one account number is the
--                ordinary case — would have the second entry silently UPDATE the
--                first, and one of the two cards would disappear from the stack
--                along with its limit. account_ref stays what 054 says it is:
--                the bureau's identifier, used to recognise the same card across
--                successive pulls.
--
--   opened_on  — account age is a real fact about a credit line and the client
--                is the only one who can tell us on a manual entry. NOT
--                `created_at`: that is when this row was typed, which for a card
--                opened in 2014 and entered today is off by a decade. NOT
--                `as_of`, which is when the figures were last true.
--
-- BOTH ARE NULLABLE AND NULL MEANS UNKNOWN, the same rule every other measure in
-- 054 and 083 follows. A card whose opening date nobody remembers has an unknown
-- opening date; it does not have one of today, and it does not have one of the
-- epoch. The screen renders each as an em dash.
--
-- THE last4 CHECK IS THE SAME PHYSICAL GUARD 076 PUTS ON client_cards.last4, and
-- it is here for the stronger of the two reasons that applies there: four
-- characters cannot hold a sixteen-digit card number. `tradelines` describes a
-- card the client HAS rather than one we can charge, so there is no token and
-- nothing here is chargeable — but a form with a box labelled "last 4" is a form
-- somebody will eventually paste a full PAN into, and the database refusing it
-- is worth more than a comment asking them not to.
--
-- SUPERSEDING, NOT EDITING. 054 is applied everywhere and db/migrate.mjs keys
-- schema_migrations on <dir>/<file>, so an edit to 054 would be a silent no-op
-- on every database that already has it (CLAUDE.md §12). New file.

ALTER TABLE tradelines ADD COLUMN IF NOT EXISTS last4     text;
ALTER TABLE tradelines ADD COLUMN IF NOT EXISTS opened_on date;

-- DROP-then-ADD because Postgres has no ADD CONSTRAINT IF NOT EXISTS, and a
-- migration that cannot be re-run by hand against a half-built database is a
-- migration somebody will eventually run twice and get a hard error from.
ALTER TABLE tradelines DROP CONSTRAINT IF EXISTS tradelines_last4_shape;
ALTER TABLE tradelines ADD  CONSTRAINT tradelines_last4_shape
  CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$');
