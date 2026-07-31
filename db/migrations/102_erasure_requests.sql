-- 102_erasure_requests.sql — the record of every deliberate data removal:
-- who asked, when, what was removed, and what was KEPT and why.
--
-- ============================================================================
-- 1. NOTHING IN THIS SYSTEM ERASES ANYTHING ON A SCHEDULE.
-- ============================================================================
--
-- There is no retention sweep, no cron, no TTL and no "clean up old records"
-- job, and none may be added on top of this table. Every row here is created by
-- an explicit human request through an authenticated endpoint. A row in this
-- table is the CAUSE of a removal, never a receipt written after an automatic one.
--
-- That ordering is the control. The audit row is written FIRST, in the same
-- transaction as the removal, before anything is touched — the same rule
-- src/pii/index.mjs states for its access log ("no log row, no plaintext"). If
-- the audit write fails, the erasure fails and nothing is removed. An erasure
-- system whose auditing is best-effort is an unaudited erasure system with
-- paperwork.
--
--
-- ============================================================================
-- 2. WHAT WAS KEPT IS NOT OPTIONAL, AND IT IS THE HARD HALF.
-- ============================================================================
--
-- Any system can record what it deleted. The question that actually gets asked —
-- by a regulator, by a data subject, by a lawyer reading this in two years — is
-- "you say you erased me; what do you still hold, and on what basis?"
--
-- So `kept` is a NOT NULL jsonb array and a completed request must have at least
-- one entry in it, enforced by a CHECK. There is no such thing as a completed
-- erasure in this product that kept nothing: a regulated consumer-finance
-- business has records it is required to retain, and a request claiming
-- otherwise is not a thorough erasure, it is an incomplete audit.
--
-- Every entry carries its own written reason. `{"table":"x","rows":3}` is not
-- acceptable and the CHECK below rejects it — a reason short enough to be a
-- shrug is not a reason.
--
--
-- ============================================================================
-- 3. WHY subject_client_id IS NOT A FOREIGN KEY.
-- ============================================================================
--
-- Same reasoning as 101, one level more obvious: the client is the thing being
-- erased. A FK with ON DELETE CASCADE would delete the audit record along with
-- the person, which destroys the only proof the erasure was ever performed — at
-- precisely the moment somebody needs it. ON DELETE SET NULL would leave an
-- audit trail that cannot say who it was about. RESTRICT would forbid the
-- deletion the record exists to document.
--
-- The audit record must OUTLIVE its subject. That is what an audit record is.
-- So: a plain uuid, no reference, and this paragraph so nobody adds one.
--
-- Note this is deliberately DIFFERENT from org_id, which IS a real FK. Tenancy
-- is not the subject of the erasure and must never be escapable; if an org is
-- genuinely deleted, its audit rows going with it is correct.
--
--
-- ============================================================================
-- 4. TWO KINDS OF REMOVAL, ONE TABLE, ONE SHAPE.
-- ============================================================================
--
--   client_erasure — a data subject asked to be erased. De-identifies the person
--                    across the tables this product controls.
--   bank_revoke    — a bank login was revoked. Removes the stored credential and
--                    the accounts it exposed.
--
-- They are different acts with identical audit obligations: who asked, when, what
-- went, what stayed, why. One table with a `kind` column rather than two tables
-- that drift apart — CLAUDE.md §8, "two functions doing the same thing is a bug
-- that takes months to surface". The vocabulary is CLOSED by a CHECK, because an
-- open one is how a third kind of removal arrives with no audit obligations
-- attached to it.
--
--
-- ============================================================================
-- 5. ATTRIBUTION COMES FROM THE SESSION AND IS STORED TWICE.
-- ============================================================================
--
-- requested_by_staff_id is the FK for joining. requested_by_label is a text copy
-- of who that was, captured at request time. Both, on purpose: staff leave, staff
-- rows get deleted, and an audit record reading "requested by NULL" answers
-- nobody's question. The label is written once and never updated — it records who
-- they were when they asked, not who they are now.
--
-- The FK is ON DELETE SET NULL rather than RESTRICT so that deleting a staff
-- member is still possible; the label is what survives it.


-- ---------------------------------------------------------------------------
-- A. erasure_requests — one row per deliberate removal
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS erasure_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Tenancy. A real FK — see section 3 on why this one differs from the subject.
  org_id        uuid NOT NULL REFERENCES orgs(id),

  --   client_erasure — a data subject asked to be erased.
  --   bank_revoke    — a bank login's credential was removed.
  -- Closed vocabulary. A third kind must arrive with a migration and a decision,
  -- not as a new string somebody passed in a request body.
  kind          text NOT NULL
                CHECK (kind IN ('client_erasure', 'bank_revoke')),

  -- WHO IT WAS ABOUT. Deliberately NOT a foreign key — section 3. The audit
  -- record has to outlive the person it documents.
  subject_client_id uuid NOT NULL,

  -- For a bank_revoke, which login. NULL on a client_erasure, and NULL is
  -- correct there: the request was not about one login. Not a FK for the same
  -- reason as the subject — the plaid_items row is what gets deleted.
  subject_item_id   uuid,

  -- WHO ASKED. From the session, never from a request body — a caller choosing
  -- its own attribution is a caller with no attribution.
  requested_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,

  -- The same fact as text, captured once, never updated. Survives the staff row.
  -- NOT NULL: an unattributed erasure is not auditable and must not be storable.
  requested_by_label    text NOT NULL
                        CHECK (btrim(requested_by_label) <> ''),

  -- WHY. NOT NULL and length-checked. "cleanup" is not a reason a regulator
  -- accepts, and the check is on this side of the wire so curl and a script obey
  -- it too — the same argument api/finance/soft-pull.mjs makes for its reason.
  reason        text NOT NULL
                CHECK (length(btrim(reason)) >= 10),

  --   requested — the row exists, the work has not run.
  --   completed — the removal ran and both manifests below are filled in.
  --   failed    — the removal was attempted and rolled back. Nothing was removed.
  -- Default is the honest one: a row must never appear completed by default.
  status        text NOT NULL DEFAULT 'requested'
                CHECK (status IN ('requested', 'completed', 'failed')),

  -- WHAT WAS REMOVED. Array of {"table": "...", "rows": n, "detail": "..."}.
  -- Empty array on a request that has not run. An empty array on a COMPLETED
  -- request is legitimate and meaningful: it says "we searched and there was
  -- nothing of yours to remove", which is a real and honest answer.
  removed       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- WHAT WAS KEPT, AND WHY. Array of {"table": "...", "rows": n, "reason": "..."}.
  -- Section 2. A completed request must have at least one entry and every entry
  -- must carry a reason — both enforced below.
  kept          jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Only set when the work actually ran. NULL means it has not.
  completed_at  timestamptz,

  -- What went wrong, on a failed request. NULL means nothing did — it is not a
  -- synonym for "healthy"; status is what says that.
  failure_reason text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- A completed request must say when it completed. Without this, "was this
  -- actually done, and when" has no reliable answer, which is the one question
  -- the table exists to answer.
  CONSTRAINT erasure_requests_completed_at_ck
    CHECK (status <> 'completed' OR completed_at IS NOT NULL),

  -- A failed request must say why it failed, and must not claim a completion time.
  CONSTRAINT erasure_requests_failed_ck
    CHECK (status <> 'failed' OR (failure_reason IS NOT NULL AND completed_at IS NULL)),

  -- Both manifests are arrays. A jsonb object here would still be valid jsonb and
  -- would silently break every reader that iterates them.
  CONSTRAINT erasure_requests_manifests_are_arrays_ck
    CHECK (jsonb_typeof(removed) = 'array' AND jsonb_typeof(kept) = 'array'),

  -- *** THE ONE IN SECTION 2. *** A completed erasure that kept nothing is an
  -- incomplete audit, not a thorough deletion. This product is a regulated
  -- consumer-finance business with records it must retain, so the honest answer
  -- is never an empty list.
  --
  -- Scoped to client_erasure: a bank_revoke legitimately keeps nothing of its own
  -- beyond the ledger, and forcing an entry there would teach people to write a
  -- filler one, which is worse than no rule at all.
  CONSTRAINT erasure_requests_completed_erasure_kept_ck
    CHECK (
      status <> 'completed'
      OR kind <> 'client_erasure'
      OR jsonb_array_length(kept) > 0
    ),

  -- A bank_revoke is about one login and must name it. A client_erasure is not
  -- and must not — a stray item id there would read as "we only erased this one
  -- login's worth", which is the opposite of what the request was.
  CONSTRAINT erasure_requests_item_matches_kind_ck
    CHECK (
      (kind = 'bank_revoke'    AND subject_item_id IS NOT NULL)
      OR (kind = 'client_erasure' AND subject_item_id IS NULL)
    )
);


-- ---------------------------------------------------------------------------
-- B. Every kept entry carries a written reason
-- ---------------------------------------------------------------------------

-- Section 2: `{"table":"bank_transactions","rows":412}` is not an answer. This
-- is a separate CHECK from the one above because it says something different —
-- that one says the list is not empty, this one says the entries mean something.
--
-- A plpgsql function rather than an inline expression: the check has to walk an
-- array, and a subquery is not allowed inside a CHECK constraint.
CREATE OR REPLACE FUNCTION erasure_kept_entries_have_reasons(kept jsonb)
RETURNS boolean AS $$
DECLARE
  entry jsonb;
BEGIN
  IF jsonb_typeof(kept) <> 'array' THEN RETURN false; END IF;

  FOR entry IN SELECT jsonb_array_elements(kept) LOOP
    IF jsonb_typeof(entry) <> 'object' THEN RETURN false; END IF;
    IF entry->>'table' IS NULL OR btrim(entry->>'table') = '' THEN RETURN false; END IF;
    -- 20 characters. Long enough that "n/a", "required" and "legal" do not pass,
    -- short enough that a real one-line reason does.
    IF entry->>'reason' IS NULL OR length(btrim(entry->>'reason')) < 20 THEN RETURN false; END IF;
  END LOOP;

  RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE erasure_requests
  DROP CONSTRAINT IF EXISTS erasure_requests_kept_reasons_ck;

ALTER TABLE erasure_requests
  ADD CONSTRAINT erasure_requests_kept_reasons_ck
  CHECK (erasure_kept_entries_have_reasons(kept));


-- ---------------------------------------------------------------------------
-- C. Reads
-- ---------------------------------------------------------------------------

-- "What has been done about this person", newest first. The subject lookup, and
-- the reason the column is not a FK is exactly so this still answers after the
-- client row is gone.
CREATE INDEX IF NOT EXISTS idx_erasure_requests_subject
  ON erasure_requests (org_id, subject_client_id, created_at DESC);

-- "What removals has this org performed", for a periodic compliance review.
CREATE INDEX IF NOT EXISTS idx_erasure_requests_org_created
  ON erasure_requests (org_id, created_at DESC);

-- Requests that were started and never finished. Small, and the one query where
-- a partial index earns its keep — a stalled erasure is a compliance problem and
-- nobody finds it by scanning a table of completed ones.
CREATE INDEX IF NOT EXISTS idx_erasure_requests_open
  ON erasure_requests (org_id, created_at)
  WHERE status = 'requested';


COMMENT ON TABLE erasure_requests IS
  'Audit record for every deliberate data removal. Written BEFORE the removal, in the same transaction — if this write fails, nothing is removed. Never written by a scheduler: there is no automatic erasure in this system. `kept` records what was retained and why, and a completed client_erasure must have at least one entry.';

COMMENT ON COLUMN erasure_requests.subject_client_id IS
  'Who the removal was about. NOT a foreign key, deliberately: the audit record must outlive the person it documents. See migration header section 3.';

COMMENT ON COLUMN erasure_requests.kept IS
  'What was retained and on what basis. Array of {table, rows, reason}, every reason at least 20 characters. The hard half of an erasure audit — see migration header section 2.';
