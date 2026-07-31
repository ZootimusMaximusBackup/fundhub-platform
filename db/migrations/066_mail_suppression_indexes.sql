-- 066_mail_suppression_indexes.sql — the two indexes the suppression gate reads
-- through, and nothing else.
--
-- *** NOTHING IN THIS FILE MAILS ANYTHING. *** It adds two indexes. There is no
-- table, no column, no flag, no status and no activation path here, for the same
-- reason there is none in 065_mail_campaigns.sql: prescreen data obliges a firm
-- offer of credit under the FCRA, and no drop happens until the FCRA research
-- report is in, Deluxe compliance has reviewed the piece AND the offer, and a
-- lawyer has signed off on the broker/lender-of-record structure. None of the
-- three is true today. THE BUILD IS NOT GATED, THE DROP IS.
--
--
-- WHAT THIS IS FOR. src/mail/suppression.mjs enforces suppression BEFORE every
-- drop, in code, at the same gate as the compliance checks. It asks two
-- questions of the database per record, and without these indexes both are
-- sequential scans:
--
--   1. "is this mail record already one of our clients?" — compared on PHONE
--      DIGITS, see section A;
--   2. "did this person respond to an earlier drop?" — scanned over responders
--      only, see section B.
--
-- At mail volumes (a drop is six figures of records) a per-record seq scan over
-- `clients` is the difference between a suppression pass that finishes and one
-- that nobody runs. AN UNRUN SUPPRESSION PASS IS THE FAILURE MODE THIS WHOLE
-- THREAD EXISTS TO PREVENT, so index cost here buys compliance, not speed.
--
--
-- WHAT IS DELIBERATELY NOT HERE, PART 1: THE (campaign_id, suppressed) INDEX.
-- 065_mail_campaigns.sql section D already creates
-- idx_mail_universe_campaign_suppressed ON mail_universe (campaign_id,
-- suppressed), and calls it "the most important index in the file". That is
-- exactly the index applySuppression() pages through. It is NOT repeated here.
-- A duplicate index is not a harmless belt-and-braces: it is a second write on
-- every INSERT of a hundred-thousand-row bulk load and a second thing for the
-- planner to choose wrong.
--
--
-- WHAT IS DELIBERATELY NOT HERE, PART 2: A CHECK CONSTRAINT ON
-- suppression_reason. src/mail/suppression.mjs defines SUPPRESSION_REASONS as a
-- closed vocabulary (existing_client | opt_out | prior_responder |
-- unidentifiable | check_failed) and the task asked for the free-text column to
-- be constrained. It is constrained IN CODE, at the single writer, and NOT with
-- a CHECK, on purpose:
--
--   * mail_universe.suppression_reason exists today (001_init.sql:355) and MAY
--     ALREADY HOLD DATA. An ADD CONSTRAINT validates every existing row, so one
--     hand-entered "dupe" or "returned mail" aborts the entire migration run —
--     the same trap 065 documented for retyping campaign_id to uuid.
--   * The vocabulary is five words old. Freezing a five-word list into the
--     schema before a single real drop has been suppressed converts a guess into
--     an enforced rule, and the next honest reason (a vendor-supplied "deceased"
--     flag, a state-level do-not-mail list) would then fail an INSERT rather than
--     being recorded.
--   * A CHECK would also reject writes from threads that are not this one, which
--     is not this file's decision to make.
--
-- NOT VALID would dodge the first bullet and none of the others. Reported as a
-- deliberate gap: tighten it when there is production data to validate against,
-- in a later migration, after a backfill.
--
--
-- WHAT IS DELIBERATELY NOT HERE, PART 3: AN ADDRESS MATCH KEY. The suppression
-- rule most wants to match a prescreen record on name + address, and it cannot:
-- `clients` has no address columns at all, and the only addresses in the schema
-- are pii_identity.addresses, a free-form jsonb array whose shape nothing in
-- this repo defines or writes structurally. There is nothing to index. Inventing
-- a normalised-address expression over an undefined jsonb shape would be a guess
-- wearing an index's clothing. Reported as a gap; records that carry no email
-- and no phone are suppressed as `unidentifiable` rather than mailed on a
-- guess.


-- ---------------------------------------------------------------------------
-- A. clients — the phone match key, compared on DIGITS
-- ---------------------------------------------------------------------------
--
-- WHY THE EXISTING INDEX DOES NOT SERVE THIS. idx_clients_phone (001_init.sql:76)
-- is ON clients(org_id, phone) — exact text. But the two sides of this
-- comparison are written differently and always have been:
--
--   clients.phone           raw text, normalised by nothing anywhere in this
--                           repo: "(555) 123-4567", "555-123-4567",
--                           "+15551234567" and "5551234567" all occur.
--   mail record phone       digits only — src/mail/ingest.mjs strips every
--                           non-digit from a recognised phone column and says
--                           so ("Digits only. NOT E.164").
--
-- So an exact-text lookup misses the same person nine times out of ten and the
-- gate reads "not an existing client" for someone who is one. That is the false
-- negative this thread cannot have, so suppression.mjs compares
-- regexp_replace(phone,'[^0-9]','','g') on both sides and this index is what
-- makes that an index lookup instead of a per-record seq scan of the CRM.
--
-- regexp_replace(text, text, text, text) is IMMUTABLE, so it is legal in an
-- index expression. The expression here is character-for-character identical to
-- the one in matchClient(); an index expression that differs by so much as a
-- space is silently never used.
--
-- NOT PARTIAL, though `WHERE phone IS NOT NULL` would be smaller. A partial
-- index would only be usable if the planner can prove `phone IS NOT NULL` from
-- an equality on a strict function of phone. It generally can — but `clients` is
-- a CRM contact list, not a mail universe, so the rows this would exclude are
-- cheap to carry, and an index that is definitely usable beats one that is
-- probably usable when the thing it guards is a compliance check.
CREATE INDEX IF NOT EXISTS idx_clients_phone_digits
  ON clients (org_id, regexp_replace(phone, '[^0-9]', '', 'g'));

COMMENT ON INDEX idx_clients_phone_digits IS
  'Digits-only phone match key for the mail suppression gate (src/mail/suppression.mjs). clients.phone is raw text and mail records carry digits only, so exact-text idx_clients_phone cannot answer "is this record already a client".';


-- ---------------------------------------------------------------------------
-- B. mail_universe — the prior-responder scan
-- ---------------------------------------------------------------------------
--
-- The list reuse terms suppress anyone who responded to an earlier drop, so the
-- gate asks "does any responder in this org share this record's email or phone".
--
-- IT CANNOT BE INDEXED ON THE VALUE, AND THAT IS THE POINT OF THIS BEING A
-- PARTIAL INDEX RATHER THAN AN EXPRESSION ONE. mail_universe.fields is keyed by
-- THE VENDOR'S OWN COLUMN HEADERS — ingest.mjs keeps them verbatim because there
-- is no Deluxe file layout in this repo — so there is no `fields->>'email'` to
-- index. Betting on a key name would produce an index that silently stops
-- matching the day a vendor renames a column, which is the worst possible
-- failure for a compliance check: it would keep returning "no prior responder"
-- and nothing would look broken.
--
-- So the query matches by VALUE across every key (jsonb_each_text) and this
-- index narrows WHAT IT MATCHES OVER instead: responders only. Direct mail
-- response rates are low single-digit percentages, so this turns a scan of the
-- whole universe into a scan of a few percent of it, without asserting anything
-- about field names.
--
-- org_id is the indexed column because the check is org-scoped (Rule 7) and
-- because a partial index still needs something to look up by.
CREATE INDEX IF NOT EXISTS idx_mail_universe_responders
  ON mail_universe (org_id)
  WHERE responded_at IS NOT NULL;

COMMENT ON INDEX idx_mail_universe_responders IS
  'Narrows the prior-responder suppression scan to records that actually responded. Cannot be indexed on the email/phone value: mail_universe.fields is keyed by the vendor''s own column headers, which this repo does not define.';
