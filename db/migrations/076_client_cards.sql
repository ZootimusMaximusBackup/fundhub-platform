-- 076_client_cards.sql — A CARD ON FILE. A stored payment credential belonging
-- to a client: a provider token plus the few display details a human needs to
-- recognise which card they are looking at.
--
-- ===========================================================================
-- READ THIS FIRST: THREE TABLES IN THIS SCHEMA HAVE "CARD" IN THE NAME AND
-- THEY ARE THREE COMPLETELY DIFFERENT THINGS.
-- ===========================================================================
--
--   public.cards          (001_init.sql) — a PIPELINE KANBAN CARD. A client's
--                         position in a sales pipeline: (client_id, pipeline_id,
--                         stage_id, owner). Nothing to do with payment or credit.
--
--   public.tradelines     (054_tradelines.sql) — CREDIT-REPORT CARD DATA. A
--                         lender, a credit limit, a balance and an APR, read off
--                         a soft pull or typed in by staff. It is what the
--                         funding waterfall draws against. It is a description
--                         of a card the client already has SOMEWHERE ELSE, and
--                         it carries no ability to move money.
--
--   public.client_cards   (this file) — A STORED PAYMENT CREDENTIAL. A card the
--                         client has authorised US to bill. It holds a provider
--                         token that could, in the presence of a processor,
--                         actually take money.
--
-- WHY THE TWO ARE NOT THE SAME TABLE, stated plainly because someone will try to
-- merge them: a tradeline is an OBSERVATION and a client_card is a CAPABILITY.
-- A client typically has fifteen tradelines and one card on file. The tradelines
-- arrive from a bureau and are refreshed wholesale on the next pull — 054's
-- ingest upserts and can overwrite. Running that same ingest over a table that
-- also held billing credentials would rewrite or drop the card we bill, from a
-- code path whose author was thinking about credit limits. They are separated so
-- that cannot happen, and so the credential table can carry the far stricter
-- access rules a credential needs and a bureau observation does not.
--
-- A NAMING NOTE, because 054 says the opposite and will be read later:
-- 054's header says "the name collision is why this table is `tradelines` and
-- not `client_cards`". That sentence was about rejecting `client_cards` as a
-- name for BUREAU data, to keep it distinct from the kanban `cards`. It was not
-- a reservation. This file takes the name for the thing it literally describes —
-- cards belonging to a client, on file, billable. 054 is not edited (editing an
-- applied migration is a silent no-op), so the three COMMENT ON TABLE statements
-- at the bottom of this file are what a future reader will actually see in the
-- database.
--
-- ===========================================================================
-- WHAT IS NOT STORED HERE. THIS IS THE POINT OF THE TABLE.
-- ===========================================================================
-- NO PAN. NO CVV. NO EXPIRY-PLUS-PAN. NOTHING FROM WHICH A CARD NUMBER COULD BE
-- RECONSTRUCTED. There is no column for a card number, and there is deliberately
-- no column a card number could be hidden in:
--
--   * `last4` is CHECKed against ^[0-9]{4}$. A sixteen-digit PAN typed into it
--     is rejected by the database, not by a code path somebody might skip.
--   * `token_enc` is CHECKed to look like this repo's AES-256-GCM envelope
--     (`v<n>:<iv>:<tag>:<ciphertext>`, base64 parts). A raw PAN written there is
--     rejected too. The constraint is not decoration: it is the last line that
--     holds when an application bug tries to write plaintext.
--   * There is no CVV column and there never can be one. A CVV may not be stored
--     after authorisation under the card network rules, full stop, encrypted or
--     otherwise.
--
-- src/billing/card-tokens.mjs adds the matching guard one layer up: it REFUSES
-- to encrypt a value that looks like a PAN (13–19 digits passing the Luhn
-- check), so "we encrypted it, so it's fine" cannot happen either. Encrypting a
-- PAN is still storing a PAN.
--
-- What we DO store is a token: an opaque string issued by a payment processor
-- that stands in for the card and is useless anywhere except that processor's
-- API. Treated as a secret anyway, because a token IS the ability to charge.
--
-- ===========================================================================
-- ENCRYPTED AT REST, BOUND TO ONE CLIENT
-- ===========================================================================
-- AES-256-GCM, key from CARD_TOKEN_ENC_KEY (32 bytes, base64, environment only),
-- with the CLIENT ID as additional authenticated data — the same construction as
-- src/adplatforms/tokens.mjs (partner id) and src/pii/index.mjs (client id).
--
-- The AAD binding is the part worth reading: a ciphertext copied from client A's
-- row into client B's row FAILS TO DECRYPT rather than quietly becoming a
-- working credential for the wrong person's card. A mis-joined UPDATE or a bad
-- backfill would otherwise let us bill one client for another client's plan,
-- and every check downstream would pass, because the token really is valid.
--
-- WHY THE CLIENT ID AND NOT THE ROW ID: the row id does not exist until the
-- INSERT returns. Binding it would mean encrypting with a placeholder and
-- re-encrypting afterwards, leaving a window in which the stored ciphertext is
-- bound to nothing. The client id is known before the insert and is the boundary
-- that actually matters — the thing we must never cross is one client's card
-- becoming another client's.
--
-- An unset key stops the feature. It never falls back to plaintext.
--
-- ===========================================================================
-- SCOPE — WHAT THIS FILE DOES NOT BUILD
-- ===========================================================================
-- No processor HTTP client, no charge path, no scheduler, no billing engine, no
-- endpoint, no UI. NOTHING TRANSMITS. There is no outbound fetch in
-- src/adapters/ or src/lib/ and this migration adds no reason for one. The
-- provider seam in src/billing/card-tokens.mjs is documented and empty.
--
-- NO PROCESSOR IS NAMED ANYWHERE IN THIS REPOSITORY. Not in the schema, not in
-- the docs, not in .env.example. `provider` is therefore free text with no
-- CHECK: writing a list of allowed processors here would decide a vendor
-- question nobody has decided, in a migration, which is the worst place to
-- decide it. That absence is a finding, not a gap to fill.

CREATE TABLE IF NOT EXISTS client_cards (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- THE CREDENTIAL. AES-256-GCM ciphertext of the processor's token, in this
  -- repo's self-describing envelope `v<n>:<iv>:<tag>:<ct>` (base64 parts, stored
  -- as bytea exactly as pii_identity.ssn_enc is). NEVER SELECT this into a
  -- response body, a log line or an error message — src/billing/card-tokens.mjs
  -- exports redactCard() for the shape that is safe to return.
  --
  -- Nullable, and the presence constraint below explains when: a removed card
  -- keeps its display metadata (so a past charge stays explicable) and loses its
  -- token (so it can never be charged again).
  token_enc     bytea,

  -- DISPLAY METADATA. Enough for a human to say "the Visa ending 4242", and not
  -- one digit more.
  --
  -- brand: 'visa', 'mastercard', 'amex', 'discover', … Free text, no CHECK — a
  -- network we have not met yet should not need a migration. NULL = UNKNOWN.
  brand         text,

  -- Exactly four digits, enforced. NULL = UNKNOWN (the processor did not return
  -- it); the constraint allows NULL and rejects anything that is not four
  -- digits, which is what stops a PAN landing here.
  last4         text
                CONSTRAINT client_cards_last4_check
                CHECK (last4 IS NULL OR last4 ~ '^[0-9]{4}$'),

  -- Expiry, for display and for "this card is about to lapse" screens. NULL on
  -- either means UNKNOWN — it does NOT mean expired, and code must not treat it
  -- as either expired or valid. Expiry is NOT a status column: whether a card has
  -- lapsed is (exp_year, exp_month) against today, computed at read time, for the
  -- same reason 075 has no 'expired' status and 031 has no 'overdue'.
  exp_month     smallint
                CONSTRAINT client_cards_exp_month_check
                CHECK (exp_month IS NULL OR (exp_month BETWEEN 1 AND 12)),
  exp_year      smallint
                CONSTRAINT client_cards_exp_year_check
                CHECK (exp_year IS NULL OR (exp_year BETWEEN 2000 AND 2100)),

  -- Which processor issued the token. 'internal' is the honest placeholder while
  -- nothing transmits — same value and same reasoning as
  -- soft_pull_requests.provider (077). No CHECK: see the header.
  provider              text NOT NULL DEFAULT 'internal',

  -- The processor's handle for the CUSTOMER (its vault/customer id), where the
  -- processor needs one alongside the token. Not a secret in the way the token
  -- is — it cannot charge on its own — but not published either. NULL = UNKNOWN
  -- or not applicable to that processor.
  provider_customer_ref text,

  -- ONE DEFAULT CARD PER CLIENT, enforced by the partial unique index below.
  is_default            boolean NOT NULL DEFAULT false,

  -- CONSENT. Storing a card for repeat billing requires the cardholder's
  -- authorisation, and "we have their card" is not the same fact as "they agreed
  -- we may bill it again". This column records WHEN that authorisation was
  -- captured. NULL means NO RECORDED CONSENT — which is UNKNOWN, and unknown
  -- must never be read as permission. There is deliberately no default and no
  -- NOT NULL: forcing a value would manufacture consent for cards migrated in
  -- from somewhere else, which is precisely the record an audit would want to
  -- be honest.
  consent_captured_at   timestamptz,
  -- Where that consent came from, in words a human can check later ("checkout
  -- form", "recorded call 2026-03-04"). Free text; NULL = unknown.
  consent_source        text,

  -- REMOVAL IS A STAMP, NOT A DELETE. The row survives so a past charge stays
  -- explicable ("the Visa ending 4242, removed on the 3rd"). NULL = still on
  -- file. The constraint below makes removal actually mean something.
  removed_at            timestamptz,
  removal_reason        text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  -- THE PRESENCE RULE, in one line: a card is on file IF AND ONLY IF it holds a
  -- token.
  --   removed_at IS NULL  ->  token_enc must be present. A "live" card with no
  --                           credential is a row that looks chargeable and is
  --                           not; every screen showing it would be lying.
  --   removed_at IS NOT NULL -> token_enc must be NULL. Removing a card has to
  --                           destroy the ability to charge it, not just hide
  --                           the row from a list. A soft-delete that leaves the
  --                           credential in place is not a removal.
  CONSTRAINT client_cards_token_presence CHECK (
    (removed_at IS NULL) = (token_enc IS NOT NULL)
  ),

  -- THE PLAINTEXT TRIPWIRE. The stored value must look like this repo's
  -- encryption envelope: a key id, then three base64 fields. A raw PAN, a raw
  -- token, a JSON blob or anything else a well-meaning bug might write is
  -- rejected by the database. This does not prove the value is encrypted — only
  -- that it is shaped like our ciphertext — but it makes the specific accident
  -- we are afraid of (plaintext card data reaching disk) impossible to commit.
  CONSTRAINT client_cards_token_is_ciphertext CHECK (
    token_enc IS NULL
    OR encode(token_enc, 'escape') ~ '^v[0-9]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$'
  )
);

-- The screen's query: this client's cards still on file, default first.
CREATE INDEX IF NOT EXISTS idx_client_cards_client
  ON client_cards (client_id, is_default DESC, created_at DESC)
  WHERE removed_at IS NULL;

-- ONE DEFAULT PER CLIENT. Two rows both claiming to be the default is a coin
-- flip over which card gets billed, resolved differently by every query that
-- does not happen to ORDER BY the same thing. Partial on both is_default and
-- removed_at, so removed cards keep whatever flag they had and do not block a
-- new default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_cards_one_default
  ON client_cards (client_id)
  WHERE is_default AND removed_at IS NULL;

COMMENT ON TABLE client_cards IS
  'STORED PAYMENT CREDENTIAL — a card on file, billable. Holds an encrypted processor TOKEN plus display metadata (brand, last four, expiry). NEVER a PAN or a CVV. NOT a credit-report tradeline (see public.tradelines) and NOT a pipeline kanban card (see public.cards).';
COMMENT ON COLUMN client_cards.token_enc IS
  'AES-256-GCM ciphertext of the processor token, client_id bound as AAD. Never return it, never log it. NULL only on a removed card.';
COMMENT ON COLUMN client_cards.last4 IS
  'Last four digits, for display. Exactly four digits or NULL (unknown). The CHECK is what stops a full card number being stored here.';
COMMENT ON COLUMN client_cards.exp_month IS
  'Expiry month 1-12. NULL means UNKNOWN — not expired, not valid.';
COMMENT ON COLUMN client_cards.exp_year IS
  'Expiry year. NULL means UNKNOWN. Whether a card has lapsed is computed at read time, never stored.';
COMMENT ON COLUMN client_cards.consent_captured_at IS
  'When the cardholder authorised repeat billing. NULL means NO RECORDED CONSENT, which is unknown and must never be read as permission.';
COMMENT ON COLUMN client_cards.removed_at IS
  'When the card was taken off file. NULL means still on file. Removal must also clear token_enc — enforced by client_cards_token_presence.';
COMMENT ON COLUMN client_cards.provider IS
  'Processor that issued the token. Free text, defaulted to internal: no processor is named anywhere in this repository.';

-- ---------------------------------------------------------------------------
-- Defensive comments on the two OTHER "card" tables, so the distinction is
-- visible from inside the database (\d+ and any schema browser) and not only in
-- a migration file nobody re-reads. Guarded: neither is created here, neither is
-- altered here, and this file must still apply if one is absent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.cards') IS NOT NULL THEN
    COMMENT ON TABLE cards IS
      'PIPELINE KANBAN CARD — a client''s position in a pipeline stage. NOT a payment card (see public.client_cards) and NOT a credit-report tradeline (see public.tradelines).';
  END IF;

  IF to_regclass('public.tradelines') IS NOT NULL THEN
    COMMENT ON TABLE tradelines IS
      'CREDIT-REPORT TRADELINE — an observed credit line (lender, limit, balance, APR) from a soft pull or manual entry. Cannot move money. NOT a stored payment credential (see public.client_cards) and NOT a pipeline kanban card (see public.cards).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The foreign key 075 could not declare.
--
-- 075 created subscriptions.default_card_id as a bare uuid because this table
-- did not exist yet at that point in the migration order. Now it does, so the
-- constraint gets added here — guarded on both tables existing and on the
-- constraint not already being present, so the file is re-runnable.
--
-- ON DELETE SET NULL: rows here are removed by stamping removed_at, not by
-- DELETE, so this fires only on a hard delete somebody performs deliberately. In
-- that case the subscription must survive with no card rather than vanish with
-- it — losing the plan because a credential was purged is a far worse outcome
-- than a plan with nothing to bill.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.subscriptions') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint
                      WHERE conname = 'subscriptions_default_card_fk'
                        AND conrelid = 'subscriptions'::regclass) THEN
    ALTER TABLE subscriptions
      ADD CONSTRAINT subscriptions_default_card_fk
      FOREIGN KEY (default_card_id) REFERENCES client_cards(id) ON DELETE SET NULL;
  END IF;
END $$;

-- updated_at, via 001_init.sql's trigger function. Guarded, as 051 and 065 do.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname = 'trg_client_cards_updated_at'
                        AND tgrelid = 'client_cards'::regclass) THEN
    CREATE TRIGGER trg_client_cards_updated_at
      BEFORE UPDATE ON client_cards
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
