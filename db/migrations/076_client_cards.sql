-- 076_client_cards.sql — the payment instrument on file. A TOKEN REFERENCE AND
-- NOTHING ELSE.
--
-- *** THIS TABLE CANNOT HOLD A CARD NUMBER, AND THAT IS ENFORCED BY THE
-- *** DATABASE RATHER THAN BY THIS COMMENT.
-- ***
-- *** There is no pan column, no card_number column, no cvv/cvc/security_code
-- *** column, no encrypted_pan column, and no jsonb blob a full payload could be
-- *** dropped into. The columns that exist are: an opaque token issued by the
-- *** processor, and the four display fields a human needs to recognise their
-- *** own card — brand, last4, expiry month, expiry year.
-- ***
-- *** Two CHECKs make the rule physical:
-- ***   client_cards_last4_shape  — last4 must be exactly four digits. Four
-- ***                               characters cannot hold a sixteen-digit PAN.
-- ***   client_cards_token_not_pan — a token that, once spaces and dashes are
-- ***                               removed, is 12 to 19 digits and nothing else
-- ***                               is REFUSED. That is the shape of every card
-- ***                               number in circulation.
-- ***
-- *** The token check is a SHAPE TEST, NOT PROOF. It cannot detect a PAN that
-- *** has been base64'd, and no CHECK can. It exists to fail loudly at the one
-- *** mistake that actually happens: a caller passing the raw number through to
-- *** the field labelled "token" because both are strings and it worked in
-- *** testing. If a processor ever issues a genuinely all-numeric token in that
-- *** length range, the answer is a prefix on the token or a superseding
-- *** migration written by a person — not relaxing this quietly.
-- ***
-- *** src/subscriptions/index.mjs mirrors both rules in normalizeCardMeta() so
-- *** the failure happens before the write, with a message a caller can act on.
-- *** The database is the backstop, not the only line.
--
--
-- WHY THIS EXISTS. A subscription (075) has to name the instrument that pays
-- for it, and nothing in the schema holds one. `transactions` (001_init.sql:152)
-- records payments after the fact with a `provider_ref` per payment; there is no
-- row that says "this client has a Visa ending 4242 on file, expiring 04/2029".
-- Without it the portal cannot show a client what will be charged, and nobody
-- can tell an expired card from an absent one until a payment fails.
--
--
-- THERE ARE NOW THREE CARD-SHAPED TABLES. Read this before writing a query:
--
--   cards         (001_init.sql)  — a PIPELINE KANBAN CARD. (client_id,
--                                   pipeline_id, stage_id, owner). Not a
--                                   payment anything.
--   tradelines    (054)           — CREDIT LINES off the soft pull: lender,
--                                   limit, balance, APR. What the funding
--                                   waterfall draws against. Read-only credit
--                                   data; not chargeable.
--   client_cards  (this file)     — THE PAYMENT INSTRUMENT. A token we can
--                                   charge, and four display fields.
--
-- 054_tradelines.sql:12 chose the name `tradelines` specifically to leave
-- `client_cards` free, because the two are different objects with different
-- trust levels: a tradeline is a card the client HAS, a client_card is a card
-- the client PAYS US WITH. A client can have twenty tradelines and no
-- client_card. There is deliberately no foreign key between them — matching a
-- payment instrument to a bureau tradeline would require comparing card numbers,
-- which is the one thing this table exists to make impossible.
--
--
-- NO BROWSER EXTENSION. NO CREDENTIAL SCRAPING. NO BANK LINKING. This table is
-- filled by a processor's tokenisation flow — the client enters their card into
-- the processor's own form and we receive a token. Any design that reads a card
-- out of a client's browser session or asks for bank credentials is
-- issuer-banned, breach-shaped, and not what this schema will accept: there is
-- nowhere here to put what such a thing would collect. Plaid/bank linking is a
-- v2 question with a SOC 2 programme attached and is out of scope entirely.
--
--
-- WHAT WAS DELIBERATELY NOT DONE (1): NO `is_default` FLAG. The subscription
-- names its own card (075.card_id), so "which card pays" already has exactly one
-- answer per arrangement. A default flag would be a second answer that can
-- disagree with the first, and the disagreement surfaces as a charge on a card
-- the client did not expect.
--
-- WHAT WAS DELIBERATELY NOT DONE (2): NO REINSTATE PATH. Removing a card sets
-- removed_at; storing the same token again refreshes its display fields and
-- LEAVES removed_at ALONE (see src/subscriptions/store.mjs). A refresh of card
-- metadata is not a customer saying "charge me again", and treating it as one is
-- how a cancelled instrument quietly comes back to life. Un-removing a card is a
-- deliberate act that needs its own path and its own consent record.
--
-- WHAT WAS DELIBERATELY NOT DONE (3): NO CARDHOLDER NAME, NO BILLING ADDRESS.
-- Neither is needed to recognise a card in a list, both are PII, and the AVS
-- decisions they would feed live at the processor.
--
-- WHAT WAS DELIBERATELY NOT DONE (4): NO EXPIRY-BASED STATE. There is no
-- `expired` boolean and no trigger that sets one. Expiry is a function of
-- (exp_month, exp_year) and today's date; storing the answer creates a second
-- one that is wrong from the next midnight onwards. 054 made the same call about
-- available credit.

CREATE TABLE IF NOT EXISTS client_cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Who issued the token. Matches the transactions convention
  -- (001_init.sql:159) so the two tables name the same processor the same way.
  provider     text NOT NULL DEFAULT 'commas' CHECK (btrim(provider) <> ''),

  -- THE TOKEN. Opaque, issued by the processor, meaningless to anyone who
  -- steals it without also holding the processor credentials. This is the only
  -- column with which anything can be charged, and it is not a card number —
  -- see client_cards_token_not_pan below.
  provider_token text NOT NULL CHECK (btrim(provider_token) <> ''),

  -- DISPLAY ONLY. These exist so a client recognises their own card in a list
  -- and so staff can say "the Visa ending 4242" out loud. Nothing is charged
  -- with them and nothing routes on them.
  --
  -- All four are NULLABLE and NULL means UNKNOWN. A processor that returns a
  -- token and no metadata is ordinary. NULL is never filled in with 0, '' or a
  -- guessed brand: an expiry of 0/0 reads as a real date to a comparison, and
  -- 'unknown' as a brand reads as a brand.
  brand        text,
  last4        text,
  exp_month    integer,
  exp_year     integer,

  -- Retired, not deleted. A card that paid for something must stay resolvable
  -- from the subscription that used it, forever.
  removed_at   timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Exactly four digits, or nothing. This is the constraint that makes "we only
  -- store the last four" a fact about the column rather than a promise about the
  -- code.
  CONSTRAINT client_cards_last4_shape CHECK (
    last4 IS NULL OR last4 ~ '^[0-9]{4}$'
  ),

  -- A PAN, with or without the separators people type, is 12-19 digits. If the
  -- token is that and only that, refuse the write. See the block at the top of
  -- this file: shape test, not proof, and deliberately strict.
  CONSTRAINT client_cards_token_not_pan CHECK (
    translate(provider_token, ' -', '') !~ '^[0-9]{12,19}$'
  ),

  -- A four-digit year, so a comparison against date_part('year', now()) is
  -- right. '29' would compare as the year 29 and every card would read expired.
  CONSTRAINT client_cards_expiry CHECK (
    (exp_month IS NULL OR (exp_month >= 1 AND exp_month <= 12))
    AND (exp_year IS NULL OR (exp_year >= 2000 AND exp_year <= 2100))
  )
);

-- ---------------------------------------------------------------------------
-- One row per instrument, scoped to the org.
--
-- SCOPED PER ORG, NEVER GLOBALLY UNIQUE — the same rule as 075's provider_ref.
-- A global unique on provider_token would mean the first org to store a token
-- owns that string against every other tenant forever, and under white-label
-- that is one partner silently blocking another's client from paying.
--
-- Not partial on removed_at: a removed card KEEPS its slot, so re-storing the
-- same token updates the existing row rather than growing a second copy of the
-- same instrument with a different id. That is what makes the store's write an
-- upsert instead of an accumulating insert.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS client_cards_token_uq
  ON client_cards (org_id, provider, provider_token);

-- The portal's read: this client's usable cards.
CREATE INDEX IF NOT EXISTS client_cards_client_idx
  ON client_cards (org_id, client_id)
  WHERE removed_at IS NULL;

-- ---------------------------------------------------------------------------
-- The composite key that makes the cross-client charge impossible.
--
-- (id, client_id) is redundant as a key — id is already the primary key — and
-- it exists solely so 075's foreign key can carry client_id too. With it, a
-- subscription row physically cannot name a card belonging to a different
-- client: the pair (card_id, client_id) has to exist in this table.
--
-- A plain FK on card_id alone would accept it, and "charged the wrong client's
-- card" is not a defect anyone should be relying on a code review to catch.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS client_cards_id_client_uq
  ON client_cards (id, client_id);

DROP TRIGGER IF EXISTS trg_client_cards_updated ON client_cards;
CREATE TRIGGER trg_client_cards_updated BEFORE UPDATE ON client_cards
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- The forward reference 075 could not make.
--
-- 075_subscriptions.sql declares `card_id uuid` with no foreign key, because
-- db/migrate.mjs applies files in filename order and client_cards did not exist
-- yet. This is the other half of that, and it is composite for the reason above.
--
-- ON DELETE RESTRICT, not SET NULL: cards are retired with removed_at and never
-- deleted, so a DELETE here is already a mistake — and SET NULL would answer it
-- by silently detaching the instrument from a live subscription, which reads
-- downstream as "this client never had a card on file".
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_card_fk'
  ) THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_card_fk
      FOREIGN KEY (card_id, client_id)
      REFERENCES client_cards (id, client_id)
      ON DELETE RESTRICT;
  END IF;
END $$;
