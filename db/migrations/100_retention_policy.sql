-- 100_retention_policy.sql — how long each class of data is kept, per org, and
-- what happens to it when that period runs out.
--
-- *** THIS FILE DELETES NOTHING AND SCHEDULES NOTHING. ***
-- There is no trigger that expires a row, no cron, no job, no activation flag.
-- It is a table, a seed, and a view. The only thing that can act on this policy
-- is scripts/retention-purge.mjs, which is a command a person types, runs as a
-- DRY RUN by default, and removes nothing without an explicit --apply. Same
-- posture as 077 ("nothing in this file pulls anybody's credit") and 085
-- ("this file connects to nothing and fetches nothing").
--
--
-- ============================================================================
-- WHY THIS EXISTS
-- ============================================================================
--
-- Five things in this schema grow without bound and nothing has ever removed a
-- row from any of them:
--
--   crs_results.result      the raw credit-report payload, one jsonb blob per
--                           pull, per client, forever (001_init.sql:310)
--   pii_access_log          one row every time somebody revealed an SSN
--                           (001_init.sql:93, written by src/pii/index.mjs)
--   soft_pull_requests      the consumer-credit request ledger (077)
--   bank_transactions       every transaction on every linked account (085)
--   mock data               demo and smoke rows, mixed in with the real ones
--
-- Three of those five are consumer-credit or PII records in a regulated
-- product. "We keep it forever because nobody wrote the delete" is not a
-- retention policy, it is the absence of one, and the absence is a liability
-- that grows every day the platform runs.
--
-- 077's own header already reached this conclusion for its own table: "a table
-- of 'we pulled this person's credit' that outlives the erasure of the person is
-- a liability, not an audit trail." This file generalises that sentence into a
-- policy the whole schema can be measured against.
--
--
-- ============================================================================
-- *** THE RETENTION WINDOWS ARE OWNER-SET. NULL STILL MEANS UNSET, NOT ZERO. ***
-- ============================================================================
--
-- This is the most important section in the file. Read section B before changing
-- any number in it.
--
-- How long a consumer-credit record must be kept is a LEGAL question, and this
-- file does not answer it by inference. The owner answered it directly, on the
-- record, as the decision-maker for this business:
--
--     credit reports        25 months
--     SSN access log        25 months
--     credit-check ledger   25 months
--     bank transactions     24 months
--     demo / test data       7 days
--
-- Those are carried below as owner-set and signed off, with counsel review
-- recorded as a condition the owner stated: reviewed before real customers are
-- onboarded. They are NOT derived, NOT defaults, and NOT this file's invention —
-- the provenance is written into every notes column so a later reader can see
-- where the numbers came from without asking anybody.
--
-- ONLY THE DEFAULT ORG IS SET. Every other org — a white-label tenant, anything
-- created after this migration — still gets its row with retain_days NULL, and
-- v_retention_policy_gaps keeps reporting it. One business's retention decision
-- is not another business's, and silently applying the owner's numbers to a
-- tenant nobody has spoken to would be exactly the invention this file avoids.
--
-- NULL CONTINUES TO MEAN UNSET AND MUST NEVER BECOME ZERO. src/retention/policy.mjs
-- maps a NULL to an ABSENT key rather than to a number, exactly as
-- src/banking/settings.mjs does for the cash-flow thresholds, and for the same
-- reason: clearing a value has to return the system to "nobody has decided this",
-- never to "somebody decided zero". Zero would mean "purge everything
-- immediately", which is the single worst thing a NULL could silently become in
-- this table. The CHECK is `retain_days >= 1` and not `>= 0` for that reason.
--
-- *** THE CONSEQUENCE, STATED PLAINLY: the purge runner will now act on the
-- *** default org under --apply. It still removes nothing without --apply, and
-- *** still removes nothing for any org whose window is NULL.
--
--
-- ============================================================================
-- MONTHS ARE NOT DAYS. THE CONVERSION ROUNDS UP, AND HERE IS WHY.
-- ============================================================================
--
-- retain_days is an integer number of DAYS, because "older than N days" is a
-- comparison Postgres can make against a timestamp without a calendar argument.
-- The owner specified MONTHS, and months are 28 to 31 days long, so a month
-- figure has to be converted and the direction of the rounding is a real
-- decision.
--
-- *** IT ROUNDS UP, TO THE LONGEST POSSIBLE SPAN. ***
--
-- A retention window stated in months is a FLOOR — "keep it for at least this
-- long". The two directions of error are not equal:
--
--   rounded up   → a handful of records are held a few days longer than the
--                  minimum before being purged. Cost: a few days of storage.
--   rounded down → records are destroyed BEFORE the window they were supposed to
--                  cover has elapsed. Cost: the record you needed for a dispute
--                  is gone, permanently, and no later decision can bring it back.
--
-- That asymmetry is the same shape as 088's settlement_lead_days, and it gets the
-- same answer: sit on the safe side of realistic.
--
--   25 months → 762 days. The longest 25 consecutive months run 762 days: two
--               years including a leap February (366 + 365 = 731) plus a 31-day
--               month. 760 (25 x 30.4) would be SHORT for a window starting in
--               the wrong month, which is precisely the silent failure to avoid.
--   24 months → 731 days. Two years including a leap February.
--    7 days   →   7 days. No conversion; a day is a day.
--
-- These are ceilings, not averages. Every window is guaranteed to be at least as
-- long as the owner specified, in every starting month, in every leap year.
--
--
-- ============================================================================
-- WHAT HAPPENS AT EXPIRY: DE-IDENTIFY, OR DELETE. ONE PER CLASS, ARGUED.
-- ============================================================================
--
-- The rule applied throughout: DE-IDENTIFY where deleting the row would destroy
-- a legitimate record; DELETE where there is no legitimate record to destroy.
-- The `action` column carries the answer per class and is seeded, because unlike
-- the retention PERIOD this one is an engineering question about what the schema
-- can actually support. Here is each answer and why.
--
-- ---------------------------------------------------------------------------
-- crs_raw_payloads → DE-IDENTIFY. And it is not a preference, it is forced.
-- ---------------------------------------------------------------------------
-- The legitimate record is "a soft pull happened on this date and produced a
-- result". The payload is the bureau's full report on a human being. The first
-- has to survive; the second is what retention is about.
--
-- *** DELETING A crs_results ROW CAN FAIL OUTRIGHT, AND THIS IS WORTH KNOWING
-- *** BEFORE SOMEBODY TRIES IT. 077 wired soft_pull_requests.crs_result_id as
-- ON DELETE SET NULL, and in the same table wrote:
--
--     CONSTRAINT soft_pull_requests_result_ck CHECK (
--       (status = 'fulfilled' AND crs_result_id IS NOT NULL) OR ...)
--
-- Those two disagree. Deleting a crs_results row that a FULFILLED request points
-- at makes the FK perform an UPDATE to NULL, and that UPDATE violates the CHECK.
-- The delete errors. There is no ordering that escapes it short of rewriting the
-- ledger row first, and the ledger row is immutable.
--
-- So the payload is emptied in place: `result` is replaced with a small tombstone
-- object, the row, its id, its client, its created_at and its outcome_tier stay.
-- outcome_tier is deliberately KEPT — it is a derived label, not a bureau
-- payload, and it is what the platform reasons about after the fact.
--
-- This does not touch src/tradelines/ in any way. That ingest path is live and
-- compliant and this file only reads from its output.
--
-- ---------------------------------------------------------------------------
-- pii_access_log → DELETE.
-- ---------------------------------------------------------------------------
-- This one reads backwards until you look at what the rows contain. The log
-- exists so an auditor can ask "who looked at this person's SSN, and when". Every
-- row therefore asserts, about a named human, that their most sensitive field was
-- disclosed. Past its retention period that is not an audit trail any more, it is
-- a standing inventory of who is in the system and whose SSN is on file.
--
-- De-identification is also structurally impossible here: pii_access_log.client_id
-- is `uuid NOT NULL REFERENCES clients(id)`. There is nothing to null out. The row
-- either says whose data was touched — which is the whole point of it, and also
-- the sensitive part — or it says nothing and is not worth keeping.
--
-- So: delete, past a period a human sets. The control is not weakened by this;
-- an access log with a defined lifetime is a stronger compliance posture than one
-- that grows forever because nobody chose.
--
-- ---------------------------------------------------------------------------
-- soft_pull_ledger → DELETE.
-- ---------------------------------------------------------------------------
-- 077 already argued this and reached the same answer for the cascade case: "the
-- only delete path is the cascade from `clients`, and a consumer-credit log
-- SHOULD go when the consumer's record goes ... a table of 'we pulled this
-- person's credit' that outlives the erasure of the person is a liability".
-- Retention is the same argument with a clock instead of a cascade.
--
-- De-identify is not available. trg_soft_pull_requests_immutable blocks any
-- update to org_id, client_id, requested_by_kind, requested_by_staff_id,
-- requested_by_account_id, reason, subscription_id and requested_at — which is
-- every identifying column in the table. Redacting the row means changing that
-- trigger, and changing an immutability guard on a consumer-credit audit table is
-- a compliance-path change that deserves its own review, not a side effect of a
-- retention build.
--
-- NOTE ON cost_cents. It is bigint, and NULL means UNKNOWN, never free (077's
-- header is explicit). The purge runner reports how many expiring rows carry an
-- unknown cost as a SEPARATE number and never sums a NULL into a zero.
--
-- ---------------------------------------------------------------------------
-- bank_transactions → DE-IDENTIFY.
-- ---------------------------------------------------------------------------
-- The legitimate record is that money moved: amount, direction, date, account.
-- That is the evidence the whole cash-flow model is built on, and 085 exists to
-- make it reasoned about "from evidence rather than from a story about the
-- evidence". Deleting it destroys the ability to look at historic cash flow at
-- all.
--
-- The sensitive part is not the amount, it is the DETAIL: `merchant_name`, kept
-- verbatim ("SQ *BLUE BOTTLE 4471 OAKLAND CA" — a place, a date and a person),
-- and `raw`, the unparsed provider payload, which carries whatever the provider
-- chose to send and is the field most likely to hold an account identifier
-- nobody audited.
--
-- So those two are scrubbed and the row survives. amount_cents is NOT NULL and
-- CHECKed non-zero — it could not be nulled even if that were wanted, and it must
-- not be: an amount is never rewritten by this policy.
--
-- *** WHAT THIS DELIBERATELY DOES NOT DO: it does not null client_id. That would
-- be stronger de-identification and it would also destroy per-client cash-flow
-- history, which is a live product feature. Which side of that trade is right is
-- a policy decision, so it is REPORTED on the shared board rather than chosen
-- here. If the answer is "sever it", that is a later migration and a deliberate
-- act.
--
-- ---------------------------------------------------------------------------
-- mock_data → DELETE.
-- ---------------------------------------------------------------------------
-- Demo and smoke rows are not a record of anything. Nothing is destroyed by
-- removing them and their presence actively harms every audit, because a person
-- reading a table cannot tell the fake rows from the real ones.
--
-- *** THERE IS NO is_demo COLUMN ANYWHERE IN THIS SCHEMA, AND THAT IS THE REAL
-- *** FINDING HERE. Mock data cannot be identified structurally. The only rows
-- that can be identified at all are the ones scripts/demo-journey.mjs writes,
-- which carry idempotency keys beginning `demo:`. Those markers live in
-- src/retention/classes.mjs as an explicit, tested constant rather than in a
-- column here — the same call 085 made for normaliseMerchant(), "versioned in
-- code where it can be tested, not baked into a column here where changing it
-- would need a migration and a backfill".
--
-- The demo CLIENT and everything cascading from it (pii_identity, crs_results,
-- soft_pull_requests, bank_accounts, plaid_items) is COUNTED AND REPORTED but
-- never deleted by the runner. A cascading client delete crosses five tables and
-- is exactly the class of action CLAUDE.md §11 reserves for a human.


-- ---------------------------------------------------------------------------
-- A. The table
-- ---------------------------------------------------------------------------
--
-- One row per (org, data class). Typed columns, not a key/value bag, for the
-- reason 088 gave: a `value text` column that has to be parsed is how a retention
-- of "90" ends up meaning days in one caller and months in another.
--
-- Each class carries its OWN signed_off_at/by, because each is a separate legal
-- decision. A single row-level flag would let signing off on mock data silently
-- bless a credit-report retention nobody looked at — 088's reasoning, and it
-- applies harder here.

CREATE TABLE IF NOT EXISTS retention_policy (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- Which pile of data this row governs. A closed set, CHECKed, because an
  -- unrecognised class in this table would be a policy that silently governs
  -- nothing — the runner would never look it up and nobody would notice.
  -- These strings are duplicated in src/retention/classes.mjs; the test
  -- scripts/retention-purge.pg.test.mjs fails if the two ever disagree.
  data_class    text NOT NULL CHECK (data_class IN (
                  'crs_raw_payloads',
                  'pii_access_log',
                  'soft_pull_ledger',
                  'bank_transactions',
                  'mock_data'
                )),

  -- *** HOW LONG THE DATA IS KEPT, IN WHOLE DAYS. NULL MEANS UNSET. ***
  -- NULL is NOT zero and must never be COALESCEd into one. An unset period makes
  -- the purge runner skip the class entirely and report it as a gap; a zero would
  -- make it purge everything. See the header. >= 1 for the same reason.
  retain_days   integer CHECK (retain_days IS NULL OR retain_days >= 1),

  -- What happens when the period runs out. Seeded, unlike retain_days, because
  -- this is an engineering question about what the schema supports rather than a
  -- legal one — see the header for the argument behind each value.
  action        text NOT NULL CHECK (action IN ('de_identify', 'delete')),

  -- Per-class sign-off. Until signed_off_at is set, v_retention_policy_gaps keeps
  -- reporting this class no matter what retain_days says.
  signed_off_at timestamptz,
  signed_off_by text,

  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One policy per class per org. Two rows for the same class would mean the
  -- runner picks one arbitrarily, which is how a signed-off 30 days quietly loses
  -- to an unsigned 3000.
  CONSTRAINT uq_retention_policy_org_class UNIQUE (org_id, data_class)
);

CREATE INDEX IF NOT EXISTS idx_retention_policy_org
  ON retention_policy (org_id, data_class);

COMMENT ON TABLE retention_policy IS
  'How long each class of data is kept, per org, and whether expiry de-identifies or deletes. NOTHING ACTS ON THIS TABLE AUTOMATICALLY — the only consumer is scripts/retention-purge.mjs, which is dry-run by default and needs an explicit --apply. retain_days NULL means UNSET, never zero. See db/migrations/100_retention_policy.sql.';
COMMENT ON COLUMN retention_policy.retain_days IS
  'Whole days the data is kept. NULL means UNSET — nobody has decided — and the purge runner skips the class entirely. NEVER COALESCE THIS TO 0: zero would mean purge everything immediately. A retention period for consumer-credit data is a legal decision and none has been made in this repository.';
COMMENT ON COLUMN retention_policy.action IS
  'de_identify = strip the sensitive content, keep the record. delete = remove the row. Chosen per class on whether deleting destroys a legitimate record; the argument for each is in the migration header.';


-- ---------------------------------------------------------------------------
-- B1. The rows — every class, every org, period still UNSET
-- ---------------------------------------------------------------------------
--
-- Seeded for EVERY org rather than only the default one. The class list is fixed
-- and known, and retention law applies per tenant — an org with no rows is an org
-- whose data has no policy at all, and it should not take a second migration to
-- give it one. Orgs created after this migration are caught by the last branch of
-- the gaps view.
--
-- retain_days is omitted from this INSERT and is therefore NULL for every org.
-- B2 then fills in the DEFAULT org only, with the owner's numbers. Every other
-- org keeps its NULL and keeps being reported, which is the correct state for a
-- tenant whose retention nobody has decided.

INSERT INTO retention_policy (org_id, data_class, action, notes)
SELECT o.id, c.data_class, c.action, c.notes
  FROM orgs o
 CROSS JOIN (VALUES
   ('crs_raw_payloads', 'de_identify',
    'Raw bureau payload in crs_results.result. DE-IDENTIFY is forced, not preferred: deleting a crs_results row that a fulfilled soft_pull_requests row points at makes the ON DELETE SET NULL violate soft_pull_requests_result_ck, and the delete errors. The payload is replaced with a tombstone; id, client, created_at and outcome_tier survive. retain_days UNSET.'),
   ('pii_access_log', 'delete',
    'Every SSN reveal, written by src/pii/index.mjs. DELETE: de-identification is impossible because client_id is NOT NULL, and past its period the log is an inventory of whose SSN is on file rather than an audit trail. retain_days UNSET.'),
   ('soft_pull_ledger', 'delete',
    'The consumer-credit request ledger (077). DELETE: 077 already concluded this log should not outlive the consumer record, and trg_soft_pull_requests_immutable blocks redaction of every identifying column. cost_cents NULL means UNKNOWN and is never summed as zero. retain_days UNSET.'),
   ('bank_transactions', 'de_identify',
    'The bank ledger (085). DE-IDENTIFY: the amount, direction and date are the evidence the cash-flow model runs on; merchant_name and the verbatim raw payload are the sensitive detail and are scrubbed. amount_cents is never rewritten. client_id is deliberately NOT severed — that is a policy call, reported not chosen. retain_days UNSET.'),
   ('mock_data', 'delete',
    'Demo and smoke rows. DELETE: nothing legitimate is destroyed. THERE IS NO is_demo COLUMN IN THIS SCHEMA — only rows from scripts/demo-journey.mjs are identifiable, by their demo: idempotency keys, and the markers live in src/retention/classes.mjs. The demo client and its cascade are reported, never deleted. retain_days UNSET.')
 ) AS c(data_class, action, notes)
ON CONFLICT (org_id, data_class) DO NOTHING;


-- ---------------------------------------------------------------------------
-- B2. [OWNER-SET] The retention windows
-- ---------------------------------------------------------------------------
--
-- The owner set these directly, as the decision-maker for this business, and
-- asked for them to be recorded as owner-set. They are signed off here because
-- that is what signing off means: a named human took the position. The header
-- explains why each month figure rounds UP to a day count.
--
--   crs_raw_payloads    25 months → 762 days
--   pii_access_log      25 months → 762 days
--   soft_pull_ledger    25 months → 762 days
--   bank_transactions   24 months → 731 days
--   mock_data            7 days   →   7 days
--
-- *** THE OWNER'S STATED CONDITION, RECORDED SO IT DOES NOT GET LOST: counsel
-- *** reviews these before real customers are onboarded. ***
-- Signing a window off removes it from v_retention_policy_gaps — that is the
-- view's whole design — so the gaps report will NOT keep raising this, and the
-- condition lives in the notes column below and on the shared board instead. If
-- counsel changes a number, that is a NEW migration: migrate.mjs keys
-- schema_migrations by `<dir>/<file>`, so editing this file after it has been
-- applied is a silent no-op. Supersede it the way 089 superseded 088.
--
-- DEFAULT ORG ONLY. `WHERE o.is_default` is doing real work — see the header.
--
-- GUARDED ON THE WINDOW STILL BEING UNSET, the same guard 089 used. If a human
-- has already set or signed off a window by the time this runs, their decision
-- stands and this migration leaves it alone. A migration that overwrites a
-- considered human value is worse than no migration.

UPDATE retention_policy p
   SET retain_days   = v.days,
       signed_off_at = now(),
       signed_off_by = 'owner',
       notes         = coalesce(p.notes, '') ||
                       ' | 100 B2: OWNER-SET ' || v.stated || ' (' || v.days || ' days). ' ||
                       'Set directly by the owner as the decision-maker, not derived and not a default. ' ||
                       'Month figures round UP to the longest possible span so the window is never short — ' ||
                       'see the migration header. CONDITION STATED BY THE OWNER: counsel reviews these ' ||
                       'before real customers are onboarded. A change from counsel is a NEW migration, ' ||
                       'not an edit to this one.',
       updated_at    = now()
  FROM (VALUES
    ('crs_raw_payloads',  762, '25 months'),
    ('pii_access_log',    762, '25 months'),
    ('soft_pull_ledger',  762, '25 months'),
    ('bank_transactions', 731, '24 months'),
    ('mock_data',           7, '7 days')
  ) AS v(data_class, days, stated)
 WHERE p.data_class = v.data_class
   AND p.org_id = (SELECT id FROM orgs WHERE is_default LIMIT 1)
   AND p.retain_days IS NULL
   AND p.signed_off_at IS NULL;


-- ---------------------------------------------------------------------------
-- C. The gaps view
-- ---------------------------------------------------------------------------
--
-- 052's rule, which 088 and 089 both restate: "a default that stops being visible
-- is a default nobody re-examines". A class is reported until it is BOTH set AND
-- signed off. The `consequence` column says what being wrong about each one
-- actually costs, so five rows are not read as five equal chores.
--
-- The last branch catches the case the others structurally cannot see: an org, or
-- an org/class pair, with no row at all. Both of the first two branches read FROM
-- retention_policy, so neither can report a row that is not there.

CREATE OR REPLACE VIEW v_retention_policy_gaps AS
-- 1. Set to nothing at all.
SELECT p.org_id,
       p.data_class,
       'retention_policy.retain_days' AS setting,
       'null' AS value,
       p.action,
       'UNSET — nobody has decided how long this is kept, so the purge runner skips this class entirely and removes nothing' AS status,
       CASE p.data_class
         WHEN 'crs_raw_payloads'  THEN 'full bureau credit reports on named people accumulate forever'
         WHEN 'pii_access_log'    THEN 'a permanent record of whose SSN was disclosed, and when, grows without limit'
         WHEN 'soft_pull_ledger'  THEN 'a permanent consumer-credit request ledger outlives every consumer record it describes'
         WHEN 'bank_transactions' THEN 'verbatim merchant detail and raw provider payloads are kept indefinitely'
         WHEN 'mock_data'         THEN 'demo rows stay mixed in with real ones and every audit has to tell them apart by hand'
       END AS consequence
  FROM retention_policy p
 WHERE p.retain_days IS NULL

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
--    Reported per missing class, not per org, so the report says which one.
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
   ('bank_transactions'), ('mock_data')
 ) AS c(data_class)
 WHERE NOT EXISTS (
   SELECT 1 FROM retention_policy p
    WHERE p.org_id = o.id AND p.data_class = c.data_class
 );

COMMENT ON VIEW v_retention_policy_gaps IS
  'Every data class whose retention period is unset, or set but not signed off, or missing a policy row entirely — with what being wrong about it costs. Reports a class even when it HAS a period, until a human signs it off. Same rule as v_cashflow_config_gaps. See db/migrations/100_retention_policy.sql.';


-- ---------------------------------------------------------------------------
-- D. updated_at trigger
-- ---------------------------------------------------------------------------
-- Same guarded shape as 088 section F: attach only if 001_init's set_updated_at()
-- is present, and only if the trigger is not already there, so re-running is safe.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['retention_policy'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
                      AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;
