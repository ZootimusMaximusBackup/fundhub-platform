-- 076_client_cards.sql — the payment methods a client pays US with.
--
-- *** READ THIS BEFORE YOU USE THIS TABLE. THERE ARE NOW THREE CARD-SHAPED
-- *** TABLES IN THIS SCHEMA AND THEY MEAN COMPLETELY DIFFERENT THINGS.
--
--   cards          (001_init.sql:208)  — a PIPELINE KANBAN CARD. Not a payment
--                                        instrument at all. The name is a
--                                        historical port from GHL.
--   tradelines     (054)               — a CREDIT LINE THE CLIENT HOLDS, read
--                                        off a bureau soft pull. Limits,
--                                        balances, APRs. This is what the
--                                        funding waterfall draws against.
--   client_cards   (this file)         — A CARD ON FILE THAT PAYS FUNDHUB.
--                                        Our accounts receivable, not their
--                                        credit profile.
--
-- 054's header called this collision out and chose the name `tradelines`
-- specifically to avoid it. This table takes the name it left free, and the
-- distinction is the first thing in the file because getting it wrong means
-- showing a client their own subscription card in a list of their credit
-- limits, or worse, drawing funding against a debit card.
--
--
-- *** COMPLIANCE REVIEW REQUIRED — PAYMENT RAILS. ***
-- This is card data on a regulated consumer-finance product. Two rules are
-- encoded here as constraints rather than left to convention:
--
--   1. NO PRIMARY ACCOUNT NUMBER EVER TOUCHES THIS TABLE. There is no column
--      for one and there must never be. The processor holds the card; we hold
--      a token that means nothing away from the processor. `last4` and `brand`
--      exist because a human has to be able to say "the Visa ending 4242", and
--      for no other reason.
--   2. NO CVV, EVER, ANYWHERE, IN ANY FORM. Storing a card verification value
--      after authorisation is prohibited outright — not "discouraged", not
--      "unless encrypted". There is no column and there is no exception.
--
-- The CHECK on last4 is a backstop, not the control: it accepts exactly four
-- digits, so a full PAN written into that column is refused by the database
-- rather than discovered in a log six months later. It cannot stop a PAN in a
-- text column that has no CHECK, which is why there are no other free-text
-- columns here that a careless writer could reach for.
--
-- ENCRYPTION AT REST is the database's, not this file's. The token column
-- holds a processor reference, which is useless without the processor's own
-- credentials — those live in environment variables (Netlify env, --secret)
-- and never in the schema, a fixture or a log.
--
-- NOTHING HERE CHARGES ANYTHING. Same as 075: no scheduler, no outbound fetch,
-- no provider call anywhere in src/adapters/ or src/lib/. This records what a
-- processor already holds.

CREATE TABLE IF NOT EXISTS client_cards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The processor's token for this instrument. NOT NULL: a payment method we
  -- cannot charge is not a payment method, it is a display artifact, and a row
  -- here that no processor recognises would silently become one.
  provider     text NOT NULL DEFAULT 'commas',
  provider_ref text NOT NULL,

  --   card — credit or debit, distinguished by `funding` below
  --   ach  — bank debit; last4 is the account's, brand is the bank name
  method_kind  text NOT NULL DEFAULT 'card'
               CHECK (method_kind IN ('card', 'ach')),

  -- Display only. See the header: these two exist so a person can identify the
  -- instrument in conversation, and for nothing else.
  brand        text,
  last4        text CHECK (last4 ~ '^[0-9]{4}$'),

  --   credit | debit | prepaid | unknown
  -- 'unknown' is the DEFAULT and it is a real answer. Processors do not
  -- reliably report funding type, and guessing 'credit' would be a guess that
  -- shows up in a cash-flow projection as available credit that does not exist.
  funding      text NOT NULL DEFAULT 'unknown'
               CHECK (funding IN ('credit', 'debit', 'prepaid', 'unknown')),

  -- Expiry, as the processor reports it. Both NULL for ACH, and both NULL for
  -- a card whose expiry we were never told. NULL is not "expired" and is not
  -- "never expires" — it is unknown, and a screen must say so rather than
  -- render a card as good or as dead on no evidence.
  exp_month    smallint CHECK (exp_month BETWEEN 1 AND 12),
  exp_year     smallint CHECK (exp_year BETWEEN 2000 AND 2100),

  -- The card the client wants used. Enforced to at most one per client by the
  -- partial unique index below, because "two default cards" is not a state
  -- anyone can bill against.
  is_default   boolean NOT NULL DEFAULT false,

  -- Set instead of deleting. A removed card must stay readable: it is the
  -- instrument that paid the transactions already on file, and deleting it
  -- would orphan the answer to "what did they pay with".
  removed_at   timestamptz,

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One row per processor token. Re-importing a payment method cannot duplicate
-- it, so a client's card list does not grow a copy on every webhook replay.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_cards_provider_ref
  ON client_cards (provider, provider_ref);

-- At most one default per client, and only among cards still on file. A
-- removed card keeps is_default as a record of what it was without blocking
-- the replacement from becoming the new default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_cards_one_default
  ON client_cards (client_id) WHERE is_default AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_client_cards_client
  ON client_cards (client_id) WHERE removed_at IS NULL;

COMMENT ON TABLE client_cards IS
  'Payment methods that pay FUNDHUB — accounts receivable, NOT the client credit profile. Do not confuse with tradelines (credit lines the client holds, 054) or cards (pipeline kanban cards, 001_init). NO PAN AND NO CVV IS EVER STORED HERE: the processor holds the instrument, this table holds a token plus brand/last4 for human identification. See db/migrations/076_client_cards.sql.';

COMMENT ON COLUMN client_cards.last4 IS
  'Display only, exactly four digits — the CHECK exists so a full card number is refused by the database rather than found in a log later.';

COMMENT ON COLUMN client_cards.funding IS
  'credit | debit | prepaid | unknown. Defaults to unknown because processors do not reliably report this, and guessing credit invents available credit in a cash-flow projection.';

COMMENT ON COLUMN client_cards.exp_month IS
  'NULL = unknown, which is neither expired nor valid. Never render a NULL expiry as a verdict on the card.';
