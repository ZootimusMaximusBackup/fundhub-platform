-- 366_regulator_complaints.sql — the thing that records whether a CFPB or state
-- attorney general complaint was actually filed. Which, today, nothing does.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Regulator complaints on a
-- consumer-finance file. NOTHING IN THIS FILE FILES ANYTHING, transmits
-- anything, or asserts anything to a regulator. It stores three states and who
-- said so.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE ABSENCE THIS FILLS, IN THE REPO'S OWN WORDS
--
-- src/metro2/letters/catalog.mjs:57-65 says it outright:
--
--   "The pack SHIPS the two complaints undated and unsigned inside
--    06-complaints-CONDITIONAL, behind a cover sheet reading DO NOT FILE WITH
--    ROUND 1; the client fills in the date, hand-signs the perjury declaration
--    and files them personally. No table, column, endpoint or workflow in this
--    repository ever hears whether that happened."
--
-- and then: "THAT ABSENCE IS A FINDING, NOT A GAP TO FILL. If R6 is ever to
-- stand on the complaints out loud, something has to record the filing first."
--
-- This is that something, and it is deliberately the smallest thing that could
-- be it. Owner-set 2026-09-05: "it is a simple ping." Three states, one row per
-- complaint, one question asked of the client.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ONLY THE CLIENT CAN MOVE IT TO `filed`. THAT IS A DATABASE RULE HERE.
--
-- We prepare the form. We may post it to the client. Neither of those is
-- filing, because filing is a sworn act the client performs in person under
-- penalty of perjury. So:
--
--   prepared  we built the form.               set when the pack was generated
--   sent      it left us, on this date.        set by the send path
--   filed     THE CLIENT SAYS THEY FILED IT.   set only by their answer
--
-- `filed_source` exists solely so that last line cannot be softened later. Its
-- CHECK permits exactly one value, 'client_reported', and
-- regulator_complaints_filed_ck refuses state='filed' without it and without a
-- filed_at. There is no code path, no admin screen and no back-door value that
-- can render a complaint as filed because a staff member assumed it was.
--
-- The forward-only trigger below refuses prepared→filed as well: a form that
-- never left us cannot have been filed, so the honest ladder is
-- prepared → sent → filed and nothing may skip the middle.
--
-- If the client says no, or never answers, the state stays `sent` and the
-- waypoint stays open. Silence is not a yes.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL MEANS UNKNOWN (CLAUDE.md §12)
--
--   case_number NULL — they filed but gave us no case number, or they have not
--     filed. It is never an empty string and never a placeholder. A CHECK below
--     refuses a blank one, so a screen cannot render whitespace as proof.
--   sent_at / filed_at NULL — that step has not happened. Never epoch, never
--     now() as a stand-in.
--   waypoint_id NULL — the complaint is not on the client's checklist. The
--     chase ladder therefore never touches it, which is correct: the ladder
--     chases waypoints.
--
-- SAFETY. Additive. Creates one table, touches no existing row, drops nothing.

CREATE TABLE IF NOT EXISTS public.regulator_complaints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The checklist row the client sees and the ladder chases. SET NULL rather
  -- than CASCADE: if the waypoint is removed we stop chasing, but the record
  -- that a complaint was prepared for this person must not vanish with it.
  waypoint_id   uuid REFERENCES public.client_waypoints(id) ON DELETE SET NULL,

  -- Round 4 is the CFPB, round 5 the state attorney general.
  kind          text NOT NULL
                CONSTRAINT regulator_complaints_kind_ck
                CHECK (kind IN ('cfpb', 'state_ag')),

  state         text NOT NULL DEFAULT 'prepared'
                CONSTRAINT regulator_complaints_state_ck
                CHECK (state IN ('prepared', 'sent', 'filed')),

  prepared_at   timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  filed_at      timestamptz,

  -- WHO SAID IT WAS FILED. One legal value. See the header.
  filed_source  text
                CONSTRAINT regulator_complaints_filed_source_ck
                CHECK (filed_source IS NULL OR filed_source = 'client_reported'),

  -- The CFPB case number, when the client hands it over with their answer.
  -- Real proof, and it costs nothing to ask for. Blank is refused so nothing
  -- downstream can render whitespace as a case number.
  case_number   text
                CONSTRAINT regulator_complaints_case_number_ck
                CHECK (case_number IS NULL OR case_number ~ '[^[:space:]]'),

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One complaint of each kind per client. A re-run of whatever prepares the
  -- pack updates the row rather than doubling it.
  CONSTRAINT regulator_complaints_client_kind_uq UNIQUE (client_id, kind),

  -- `sent` and sent_at say the same thing and may never disagree — the same
  -- call 330 makes for state='done' and completed_at.
  CONSTRAINT regulator_complaints_sent_ck CHECK (
    (state IN ('sent', 'filed') AND sent_at IS NOT NULL)
    OR (state = 'prepared' AND sent_at IS NULL)
  ),

  -- FILED IS ONLY EVER THE CLIENT'S WORD. Enforced, not documented.
  --
  -- `IS NOT DISTINCT FROM` rather than `=`, and this is not a style choice —
  -- it is the difference between a constraint and a decoration. A CHECK only
  -- rejects a row when it evaluates to FALSE; NULL is treated as satisfied. So
  -- the natural-looking `filed_source = 'client_reported'` evaluates to NULL
  -- when filed_source is NULL, the whole OR comes out NULL rather than FALSE,
  -- and `state='filed'` with no source at all is ACCEPTED — the exact hole this
  -- constraint exists to close. Caught by the raw-SQL test in
  -- src/nudge/regulator.pg.test.mjs, which is why that test writes SQL by hand
  -- instead of going through the module.
  CONSTRAINT regulator_complaints_filed_ck CHECK (
    (state = 'filed'
       AND filed_at IS NOT NULL
       AND filed_source IS NOT DISTINCT FROM 'client_reported')
    OR (state <> 'filed' AND filed_at IS NULL AND filed_source IS NULL)
  ),

  -- A case number is proof of a filing, so it cannot exist without one.
  CONSTRAINT regulator_complaints_case_state_ck CHECK (
    case_number IS NULL OR state = 'filed'
  )
);

CREATE INDEX IF NOT EXISTS regulator_complaints_client_idx
  ON public.regulator_complaints (client_id, kind);
CREATE INDEX IF NOT EXISTS regulator_complaints_waypoint_idx
  ON public.regulator_complaints (waypoint_id)
  WHERE waypoint_id IS NOT NULL;

COMMENT ON TABLE public.regulator_complaints IS
  'CFPB and state AG complaints: prepared (we built it), sent (it left us), filed (the CLIENT says they filed it). filed requires filed_source = client_reported, enforced by CHECK, because filing is a sworn act only the client performs. Nothing here files anything.';
COMMENT ON COLUMN public.regulator_complaints.filed_source IS
  'Only ever client_reported. The column exists so that "filed" can never be written by staff assumption or by a workflow; see src/metro2/letters/catalog.mjs:57-65.';
COMMENT ON COLUMN public.regulator_complaints.case_number IS
  'CFPB case number as the client reported it. NULL = they gave none, or nothing was filed. Blank refused by CHECK.';

-- ---------------------------------------------------------------------------
-- Forward only. prepared → sent → filed, and never backwards or past a rung.
-- ---------------------------------------------------------------------------
-- A CHECK cannot see the previous row, so the state machine is a trigger. Two
-- things it stops: a complaint being marked filed when it never left us, and a
-- filed complaint being quietly walked back to sent, which would make the page
-- disagree with what the client told us.
CREATE OR REPLACE FUNCTION public.fundhub_regulator_complaint_forward()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rank_old int;
  rank_new int;
BEGIN
  rank_old := CASE OLD.state WHEN 'prepared' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END;
  rank_new := CASE NEW.state WHEN 'prepared' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END;

  IF rank_new < rank_old THEN
    RAISE EXCEPTION
      'regulator_complaints: % cannot move back to % (forward only: prepared, sent, filed)',
      OLD.state, NEW.state;
  END IF;
  IF rank_new - rank_old > 1 THEN
    RAISE EXCEPTION
      'regulator_complaints: % cannot skip to % — a complaint that never left us cannot have been filed',
      OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_regulator_complaints_forward ON public.regulator_complaints;
CREATE TRIGGER trg_regulator_complaints_forward
  BEFORE UPDATE OF state ON public.regulator_complaints
  FOR EACH ROW EXECUTE FUNCTION public.fundhub_regulator_complaint_forward();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_regulator_complaints_updated ON public.regulator_complaints;
    CREATE TRIGGER trg_regulator_complaints_updated
      BEFORE UPDATE ON public.regulator_complaints
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security — the same shape 330 and 365 carry
-- ---------------------------------------------------------------------------
ALTER TABLE public.regulator_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulator_complaints FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'regulator_complaints'
       AND policyname = 'regulator_complaints_app_all'
  ) THEN
    CREATE POLICY regulator_complaints_app_all ON public.regulator_complaints
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.regulator_complaints TO fundhub_app;
  END IF;
END $$;
