-- 127_retire_affiliates_hiring.sql — retire R-07 ('affiliates_hiring').
--
-- 002_pipelines seeded one rail covering affiliates and hiring. 051_hiring
-- split hiring out; 115_affiliates_white_label split the partner half out.
-- Both replacement rails are live. R-07 is dead weight — nothing should still
-- read it, and the pipeline UI no longer shows it.
--
-- SAFETY: do not hard-delete if any cards still sit on this rail. Count first.
-- If cards exist, leave the rows alone and RAISE a WARNING with the count so
-- the operator can move or archive them. Stages cascade from pipelines when
-- the delete does run; cards do not (FK without ON DELETE CASCADE), which is
-- the second backstop.

DO $$
DECLARE
  card_n  int;
  pipe_n  int;
BEGIN
  SELECT count(*)::int INTO card_n
  FROM cards c
  JOIN pipelines p ON p.id = c.pipeline_id
  WHERE p.key = 'affiliates_hiring';

  SELECT count(*)::int INTO pipe_n
  FROM pipelines
  WHERE key = 'affiliates_hiring';

  IF card_n > 0 THEN
    RAISE WARNING
      'retire affiliates_hiring skipped: % card(s) still on the rail across % pipeline row(s) — not deleting',
      card_n, pipe_n;
    RETURN;
  END IF;

  DELETE FROM pipelines WHERE key = 'affiliates_hiring';
  RAISE NOTICE
    'retired affiliates_hiring: deleted % pipeline row(s), 0 cards present',
    pipe_n;
END $$;
