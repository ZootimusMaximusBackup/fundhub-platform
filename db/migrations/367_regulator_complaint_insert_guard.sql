-- 367_regulator_complaint_insert_guard.sql — close the hole 366 left open: a
-- complaint could be BORN already filed.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Regulator complaints on a
-- consumer-finance file. NOTHING IN THIS FILE FILES ANYTHING, transmits
-- anything, or asserts anything to a regulator. It adds one refusal.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT WAS WRONG
--
-- 366 shipped a forward-only state machine as
--
--   CREATE TRIGGER trg_regulator_complaints_forward
--     BEFORE UPDATE OF state ON public.regulator_complaints
--
-- BEFORE UPDATE. An INSERT never fires it. So the ladder it guards —
-- prepared → sent → filed, one rung at a time — governed only rows that arrived
-- at 'prepared' and were walked forward. A single statement
--
--   INSERT INTO regulator_complaints (..., state, sent_at, filed_at, filed_source)
--   VALUES (..., 'filed', now(), now(), 'client_reported');
--
-- satisfied every CHECK in 366 and landed straight on 'filed' without the row
-- ever having been prepared or sent. Measured on a scratch database on
-- 2026-09-06: ACCEPTED.
--
-- This file makes the same statement fail.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES *NOT* CLOSE, SAID PLAINLY
--
-- A hand-written
--
--   UPDATE regulator_complaints SET state='filed', filed_at=now(),
--          filed_source='client_reported' WHERE ...
--
-- against a row already at 'sent' is still accepted, and it is not closeable
-- here. `filed_source='client_reported'` IS the assertion "the client told us".
-- A database cannot tell a true assertion from a false one; it can only refuse
-- a row that does not carry the assertion at all. So what is enforced is:
--
--   * nothing reaches 'filed' without filed_at AND filed_source='client_reported'
--     (366's regulator_complaints_filed_ck)
--   * nothing reaches 'filed' from 'prepared', on INSERT or on UPDATE
--   * nothing moves backwards
--
-- and what is NOT enforced is that whoever wrote 'client_reported' was telling
-- the truth. docs/journeys/waypoint-nudge-actual.md says exactly this, because
-- the previous wording claimed the stronger thing and the stronger thing was
-- false.
--
--
-- SAFETY. Additive. Replaces one trigger function and adds one trigger. Touches
-- no existing row; drops no column and no table. Re-running it is a no-op.
--
-- BACKFILL. None is possible and none is needed: this branch introduces
-- regulator_complaints (366) and it has never been applied to production, so
-- there is no pre-existing row that this guard would have refused.

-- One function for both timings. TG_OP tells it which it is running as.
CREATE OR REPLACE FUNCTION public.fundhub_regulator_complaint_forward()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rank_old int;
  rank_new int;
BEGIN
  rank_new := CASE NEW.state WHEN 'prepared' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END;

  IF TG_OP = 'INSERT' THEN
    -- A NEW row has no history, so the only honest starting rungs are the ones
    -- that need none. 'prepared' is "we built the form". 'sent' is permitted
    -- because a row may legitimately be created by whatever puts the pack in
    -- the client's hands, and 366's regulator_complaints_sent_ck already
    -- forces a real sent_at alongside it.
    --
    -- 'filed' is not, ever. Filing is a sworn act the client performs in
    -- person; a row that appears already filed has skipped the two facts that
    -- have to exist first — that we built it, and that it left us.
    IF rank_new = 2 THEN
      RAISE EXCEPTION
        'regulator_complaints: a complaint cannot be created already filed — it must be prepared, then sent, then reported filed by the client';
    END IF;
    RETURN NEW;
  END IF;

  rank_old := CASE OLD.state WHEN 'prepared' THEN 0 WHEN 'sent' THEN 1 ELSE 2 END;

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

DROP TRIGGER IF EXISTS trg_regulator_complaints_forward_ins ON public.regulator_complaints;
CREATE TRIGGER trg_regulator_complaints_forward_ins
  BEFORE INSERT ON public.regulator_complaints
  FOR EACH ROW EXECUTE FUNCTION public.fundhub_regulator_complaint_forward();

-- 366's UPDATE trigger already exists and points at the same function, which
-- this file has just replaced. Recreated here so that applying 367 to a
-- database that somehow lacks it still ends up with both halves.
DROP TRIGGER IF EXISTS trg_regulator_complaints_forward ON public.regulator_complaints;
CREATE TRIGGER trg_regulator_complaints_forward
  BEFORE UPDATE OF state ON public.regulator_complaints
  FOR EACH ROW EXECUTE FUNCTION public.fundhub_regulator_complaint_forward();

COMMENT ON FUNCTION public.fundhub_regulator_complaint_forward() IS
  'Forward-only state machine for regulator_complaints, on INSERT and on UPDATE OF state. INSERT may land on prepared or sent and never on filed; UPDATE may not move backwards and may not skip a rung. It cannot check whether filed_source = client_reported is TRUE — only that it is present (366 regulator_complaints_filed_ck).';
