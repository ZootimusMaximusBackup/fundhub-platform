-- 275_decline_autopsy.sql — the $27 Decline Autopsy: two tables, and a sixth
-- retention class that is registered but never purged.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this holds consumer data that
-- belongs to somebody else's customers, it touches credit-pull type (by making
-- one impossible), and it touches fee timing.
--
-- Spec: docs/specs/W3-decline-autopsy.md §5.4 and §8.5.
-- Owner decisions: docs/specs/W0-decisions.md.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DESIGN, IN ONE SENTENCE: there are NO CONTACT COLUMNS on the row table, so
-- there is nothing to leak, nothing to mail, and nothing to match against any
-- other dataset in this database.
--
-- A broker uploads his declined deals with the names taken off. Those consumers
-- never agreed to give FundHub anything, so FundHub never learns who they are.
-- decline_autopsy_rows carries a label the BROKER chose, a FICO BAND (not a
-- score), a state, some counts and some amounts. No name column. No SSN column.
-- No e-mail, phone, address or date-of-birth column. The refusal is also
-- enforced in code before a byte reaches storage (src/autopsy/parse.mjs), but
-- the table shape is the part that cannot be bypassed by a future caller.
--
-- NEVER JOINED TO clients. There is no client_id here and there must never be
-- one. An autopsy row is not a lead, is not a client, and must never enter the
-- campaign or mail pipeline.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A NEW FILE. db/migrate.mjs records each file in schema_migrations keyed
-- '<dir>/<file>'. An applied file is never read again, so editing
-- 100_retention_policy.sql would be a silent no-op on every database that has
-- already run it. Everything this needs from 100 is done here by ALTER and
-- CREATE OR REPLACE.
-- ═══════════════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------------------
-- A. The upload — one row per $27 purchase
-- ---------------------------------------------------------------------------
-- The BUYER's details live here, and only here. He consented: he bought. The
-- people on his list did not, and their data is in the child table, which has
-- no contact columns at all.

CREATE TABLE IF NOT EXISTS decline_autopsy_uploads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- The random public handle carried on the checkout success URL and in the
  -- signed report link. Not guessable, and never a sequence: a countable id
  -- would let anyone measure how many brokers bought.
  autopsy_ref        text NOT NULL UNIQUE
                       CONSTRAINT decline_autopsy_ref_shape
                       CHECK (autopsy_ref ~ '^[a-z0-9]{24,64}$'),

  -- The buyer. A customer, kept normally.
  buyer_email        text NOT NULL CHECK (position('@' in buyer_email) > 1),
  buyer_name         text,

  -- Fee timing: pay first, upload second. An upload is refused until paid_at is
  -- stamped, so we are never holding somebody else's consumer records from a
  -- person who did not become a customer.
  payment_link_ref   text,
  checkout_session   text,
  paid_at            timestamptz,

  -- The merchant attestation (spec §8.1). NOT a consumer consent, and
  -- deliberately NOT in client_consents: CONSENT_KINDS is a closed CHECKed set
  -- meaning "a consumer gave us permission about their own file", and a
  -- broker's warranty about somebody else's file is a different record.
  -- Widening that set would blur the one record an auditor most needs clean.
  attestation_version text,
  attestation_name    text,
  attestation_ip      text,
  attestation_at      timestamptz,

  -- What the boundary did, kept so the broker can be shown it and an auditor
  -- can read it back.
  rows_submitted     integer NOT NULL DEFAULT 0 CHECK (rows_submitted >= 0),
  columns_dropped    integer NOT NULL DEFAULT 0 CHECK (columns_dropped >= 0),

  -- The RAW uploaded file. Held only until parsing succeeds, then deleted from
  -- blob storage and stamped here. This is the single highest-value
  -- minimisation step in the design (spec §8.3): we keep the parsed, cleaned
  -- rows, not the original.
  raw_storage_key    text,
  raw_deleted_at     timestamptz,

  scored_at          timestamptz,

  -- The buyer's own delete button, and a refund. Both stamp a reason; neither
  -- removes the record that a $27 sale happened, because a financial record is
  -- not erasable and pretending otherwise would be worse. Same posture as
  -- eraseClient()'s KEPT_WITH_REASON.
  deleted_at         timestamptz,
  deleted_reason     text,
  CONSTRAINT decline_autopsy_delete_has_reason
    CHECK (deleted_at IS NULL OR deleted_reason IS NOT NULL),

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decline_autopsy_uploads_org
  ON decline_autopsy_uploads (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_decline_autopsy_uploads_email
  ON decline_autopsy_uploads (org_id, lower(buyer_email));

COMMENT ON TABLE decline_autopsy_uploads IS
  'One $27 Decline Autopsy purchase. Holds the BUYER''s details (he consented — he bought) and the merchant attestation about the list he uploaded. Never joined to clients.';
COMMENT ON COLUMN decline_autopsy_uploads.raw_storage_key IS
  'Blob key of the file as uploaded. Cleared and stamped in raw_deleted_at as soon as parsing succeeds — the cleaned rows are what we keep.';
COMMENT ON COLUMN decline_autopsy_uploads.attestation_version IS
  'The exact wording the broker agreed to. NOT a consumer consent and deliberately not in client_consents.';

-- ---------------------------------------------------------------------------
-- B. The rows — somebody else's declined consumers, as numbers only
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS decline_autopsy_rows (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  autopsy_id                uuid NOT NULL
                              REFERENCES decline_autopsy_uploads(id) ON DELETE CASCADE,

  -- The broker's OWN key, his wording, capped. He owns the join back to a
  -- person. We never see it.
  row_label                 text NOT NULL CHECK (char_length(row_label) BETWEEN 1 AND 32),

  -- A BAND, not a score. Bands are not credit-file values, which is the whole
  -- reason the field list looks like this.
  fico_band                 text NOT NULL CHECK (fico_band IN
                              ('<560','560-599','600-639','640-679','680-719','720+','unknown')),

  state                     char(2) CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  business_age_months       integer CHECK (business_age_months IS NULL OR business_age_months >= 0),

  -- Money is INTEGER CENTS everywhere (src/commissions/money.mjs). NULL means
  -- unknown and must survive; it is never defaulted to 0.
  annual_revenue_cents      bigint CHECK (annual_revenue_cents IS NULL OR annual_revenue_cents >= 0),
  requested_amount_cents    bigint CHECK (requested_amount_cents IS NULL OR requested_amount_cents >= 0),
  highest_revolving_limit_cents bigint
                              CHECK (highest_revolving_limit_cents IS NULL OR highest_revolving_limit_cents >= 0),

  declined_by               text,
  decline_reason            text,

  -- MONTH AND YEAR ONLY, always stored on the first of the month. A full date
  -- plus a state plus an amount is a re-identification handle (spec §8.3).
  declined_on_month         date CHECK (declined_on_month IS NULL OR extract(day from declined_on_month) = 1),
  revolving_opened_month    date CHECK (revolving_opened_month IS NULL OR extract(day from revolving_opened_month) = 1),

  bureaus_pulled            text,
  open_tradelines           integer CHECK (open_tradelines IS NULL OR open_tradelines >= 0),
  revolving_utilization_pct numeric(5,2)
                              CHECK (revolving_utilization_pct IS NULL
                                     OR (revolving_utilization_pct >= 0 AND revolving_utilization_pct <= 100)),

  -- What the scoring said. estimated_capacity_cents IS NULLABLE ON PURPOSE:
  -- "not enough information" is a real answer and it must never arrive as 0.
  bucket                    text CHECK (bucket IS NULL OR bucket IN
                              ('fundable_now','fundable_after_repair','not_fundable','not_enough_information')),
  estimated_capacity_cents  bigint CHECK (estimated_capacity_cents IS NULL OR estimated_capacity_cents >= 0),
  estimated_fee_cents       bigint CHECK (estimated_fee_cents IS NULL OR estimated_fee_cents >= 0),
  estimated_partner_share_cents bigint
                              CHECK (estimated_partner_share_cents IS NULL OR estimated_partner_share_cents >= 0),
  lender_match_count        integer CHECK (lender_match_count IS NULL OR lender_match_count >= 0),

  -- Every assumption used to fill a gap, stored next to the number it produced.
  -- That is the difference between an estimate and a guess.
  assumptions               jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_decline_autopsy_rows_scope
  ON decline_autopsy_rows (org_id, autopsy_id);

COMMENT ON TABLE decline_autopsy_rows IS
  'Declined deals a broker uploaded, as NUMBERS ONLY. There is deliberately no name, SSN, date-of-birth, address, e-mail, phone or account column, and no client_id — so there is nothing to leak, nothing to mail, and nothing to match against any other dataset. Never add one.';
COMMENT ON COLUMN decline_autopsy_rows.estimated_capacity_cents IS
  'NULL means we could not model this row. It is shown as "not enough information", counted, and excluded from every total. It must never become 0.';

-- ---------------------------------------------------------------------------
-- C. Retention — REGISTERED, COUNTED, AUDITABLE. NOT PURGED.
-- ---------------------------------------------------------------------------
-- Owner-set 2026-08-31 (docs/specs/W0-decisions.md): "Retain in full. No purge."
-- This supersedes W3 A3's 30-day proposal.
--
-- So the class is registered, the counting machinery exists, and NO PERIOD IS
-- SET. loadPolicy() returns retain_days as ABSENT, the runner skips the class,
-- and nothing is ever destroyed on a clock. The mechanism being present and
-- unscheduled is the auditable state the owner asked for.
--
-- A NEW action VALUE, 'retain'. The existing two, de_identify and delete, both
-- describe something the purge runner DOES. This class needs a third meaning:
-- "kept in full, on purpose, forever". Without it the gaps view would report
-- this class as an undecided NULL every day for the rest of the product's life,
-- and a report that always shows a false alarm is a report nobody reads — the
-- exact failure 052/088/089 are shaped to avoid.

ALTER TABLE retention_policy DROP CONSTRAINT IF EXISTS retention_policy_data_class_check;
ALTER TABLE retention_policy ADD CONSTRAINT retention_policy_data_class_check
  CHECK (data_class IN (
    'crs_raw_payloads',
    'pii_access_log',
    'soft_pull_ledger',
    'bank_transactions',
    'mock_data',
    'broker_upload_rows'
  ));

ALTER TABLE retention_policy DROP CONSTRAINT IF EXISTS retention_policy_action_check;
ALTER TABLE retention_policy ADD CONSTRAINT retention_policy_action_check
  CHECK (action IN ('de_identify', 'delete', 'retain'));

-- Seed the class for every org that already has policy rows, so the class is
-- not invisible to the policy reader. Signed off as owner-set, because it IS a
-- decision — "keep it" — rather than an unanswered question.
INSERT INTO retention_policy (org_id, data_class, action, retain_days, signed_off_at, signed_off_by, notes)
SELECT o.id,
       'broker_upload_rows',
       'retain',
       NULL,
       now(),
       'owner',
       'OWNER-SET 2026-08-31: broker Decline Autopsy uploads are RETAINED IN FULL. No purge schedule. '
       'The class is registered so it is counted and auditable. Deletion happens only on the buyer''s own '
       'delete button or a refund, both of which stamp a reason.'
  FROM orgs o
ON CONFLICT (org_id, data_class) DO NOTHING;

-- The gaps view, replaced so that:
--   * branch 1 does not report a class whose action is 'retain' AND which a
--     human has signed off. An unset period on a retain-forever class is the
--     FINAL state, not a missing decision. A 'retain' row that nobody has signed
--     is still reported — the sign-off is what turns it from a guess into a call.
--   * branch 3 knows about the sixth class, so an org with no row for it is
--     still told.
-- Everything else is byte-for-byte the view from 100_retention_policy.sql.

CREATE OR REPLACE VIEW v_retention_policy_gaps AS
-- 1. Set to nothing at all.
SELECT p.org_id,
       p.data_class,
       'retention_policy.retain_days' AS setting,
       'null' AS value,
       p.action,
       'UNSET — nobody has decided how long this is kept, so the purge runner skips this class entirely and removes nothing' AS status,
       CASE p.data_class
         WHEN 'crs_raw_payloads'   THEN 'full bureau credit reports on named people accumulate forever'
         WHEN 'pii_access_log'     THEN 'a permanent record of whose SSN was disclosed, and when, grows without limit'
         WHEN 'soft_pull_ledger'   THEN 'a permanent consumer-credit request ledger outlives every consumer record it describes'
         WHEN 'bank_transactions'  THEN 'verbatim merchant detail and raw provider payloads are kept indefinitely'
         WHEN 'mock_data'          THEN 'demo rows stay mixed in with real ones and every audit has to tell them apart by hand'
         WHEN 'broker_upload_rows' THEN 'declined-deal rows uploaded by brokers, about consumers who never agreed to anything, are kept with no stated position'
       END AS consequence
  FROM retention_policy p
 WHERE p.retain_days IS NULL
   AND NOT (p.action = 'retain' AND p.signed_off_at IS NOT NULL)

UNION ALL

-- 2. Has a number, but no human has agreed to it. Still reported — this is the
--    branch that stops a provisional value hardening into a fact.
SELECT p.org_id,
       p.data_class,
       'retention_policy.retain_days',
       p.retain_days::text,
       p.action,
       'SET to ' || p.retain_days::text || ' days — AWAITING SIGN-OFF. The purge runner WILL act on this number under --apply.',
       'a retention period nobody signed off is a legal position nobody took; too short destroys records that must be kept, too long keeps consumer data that should be gone'
  FROM retention_policy p
 WHERE p.retain_days IS NOT NULL
   AND p.signed_off_at IS NULL

UNION ALL

-- 3. No policy row at all — a class this org has never been given a position on.
SELECT o.id,
       c.data_class,
       'retention_policy',
       'no row',
       NULL,
       'UNSET — this org has no policy row for this data class at all',
       'the class is invisible to both the policy reader and the purge runner; data accumulates and nothing reports it'
  FROM orgs o
 CROSS JOIN (VALUES
   ('crs_raw_payloads'), ('pii_access_log'), ('soft_pull_ledger'),
   ('bank_transactions'), ('mock_data'), ('broker_upload_rows')
 ) AS c(data_class)
 WHERE NOT EXISTS (
   SELECT 1 FROM retention_policy p
    WHERE p.org_id = o.id AND p.data_class = c.data_class
 );

COMMENT ON VIEW v_retention_policy_gaps IS
  'Every data class whose retention period is unset, or set but not signed off, or missing a policy row entirely — with what being wrong about it costs. A class whose action is ''retain'' and which has been signed off is NOT reported: keeping it in full is the decision. See db/migrations/275_decline_autopsy.sql.';

-- ---------------------------------------------------------------------------
-- D. updated_at trigger, guarded the same way 088 section F guards it
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_decline_autopsy_uploads_updated ON decline_autopsy_uploads;
    CREATE TRIGGER trg_decline_autopsy_uploads_updated
      BEFORE UPDATE ON decline_autopsy_uploads
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- E. Grants — the app role, not a superuser
-- ---------------------------------------------------------------------------
-- 104_app_role.sql gives the app an unprivileged fundhub_app role. New tables
-- need explicit grants or every query from the app fails with permission denied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON decline_autopsy_uploads TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON decline_autopsy_rows TO fundhub_app;
  END IF;
END $$;
