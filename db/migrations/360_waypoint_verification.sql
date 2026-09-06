-- 360_waypoint_verification.sql — the two columns that let a waypoint be
-- closed from data instead of from a guess.
--
-- WHY THIS EXISTS. client_waypoints (330) records what a client has to do and
-- whose job it is. It records nothing about HOW anybody would know the job was
-- done. Without that, the only way a row ever reaches 'done' is somebody
-- ticking a box, and the accountability half of the product — "this client is
-- three weeks late paying down a card" — cannot be computed at all.
--
-- Two columns, both nullable, both additive:
--
--   verify_kind  Names the ONE machine check that can close this row. NULL is
--                the default and it means NOTHING THE PLATFORM CAN SEE CLOSES
--                THIS. That is the honest answer for "get an EIN from the IRS"
--                and "open a business checking account" — we have no feed that
--                observes either, so those rows stay open until a person says
--                otherwise. NULL here is not "unchecked yet"; it is "not
--                checkable", and code must never treat it as permission to
--                guess.
--
--   params       The facts the check needs, per client. A paydown waypoint
--                carries the creditor, the bureau and the target balance IN
--                INTEGER CENTS, because "pay CHASE down to $250" is only
--                verifiable if the row remembers which account and what number.
--                jsonb and not columns: the shape differs per verify_kind and
--                the six-month strategy is not finalised (TODO.md item 0), so
--                a new check must not need a new migration.
--
-- MONEY IN params IS INTEGER CENTS, ALWAYS, with a _cents suffix on the key
-- (CLAUDE.md §12, src/commissions/money.mjs). A float dollar amount in this
-- column is a bug.
--
-- WHY NO CHECK CONSTRAINT ON THE VALUE OF verify_kind. A named list here would
-- have to be edited by a migration every time a new check is written, and
-- editing an applied migration is a silent no-op in this repo, so the list
-- would drift from the code that reads it. The real guard is that an unknown
-- verify_kind matches no branch in src/waypoints/verify.mjs and therefore
-- closes nothing — the failure mode of a typo is a row that stays open, which
-- is the safe direction. A CHECK that only permits a shape IS here: params must
-- be a json object, never an array or a bare scalar.
--
-- SAFETY. Additive. Adds two nullable columns to one table, touches no existing
-- row, drops nothing, and re-running it is a no-op.

ALTER TABLE public.client_waypoints
  ADD COLUMN IF NOT EXISTS verify_kind text;

ALTER TABLE public.client_waypoints
  ADD COLUMN IF NOT EXISTS params jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'client_waypoints_params_object_ck'
       AND conrelid = 'public.client_waypoints'::regclass
  ) THEN
    ALTER TABLE public.client_waypoints
      ADD CONSTRAINT client_waypoints_params_object_ck
      CHECK (params IS NULL OR jsonb_typeof(params) = 'object');
  END IF;
END $$;

-- A blank string is not a verify kind. It reads as a value and matches nothing,
-- which is exactly the confusion between "not checkable" and "checkable by
-- something we forgot to name" that NULL exists to prevent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'client_waypoints_verify_kind_ck'
       AND conrelid = 'public.client_waypoints'::regclass
  ) THEN
    ALTER TABLE public.client_waypoints
      ADD CONSTRAINT client_waypoints_verify_kind_ck
      CHECK (verify_kind IS NULL OR verify_kind ~ '^[a-z0-9_]{2,64}$');
  END IF;
END $$;

-- The sweep a re-pull makes: "which of this client's still-open rows can I
-- check against fresh data". Partial, because a row with no verify_kind is
-- never a candidate and a closed row is never re-opened by a check.
CREATE INDEX IF NOT EXISTS client_waypoints_verifiable_idx
  ON public.client_waypoints (client_id, verify_kind)
  WHERE verify_kind IS NOT NULL AND state NOT IN ('done', 'skipped');

COMMENT ON COLUMN public.client_waypoints.verify_kind IS
  'Names the one machine check that can close this waypoint. NULL means nothing the platform can see closes it — not "unchecked", but "not checkable". An unrecognised value closes nothing.';
COMMENT ON COLUMN public.client_waypoints.params IS
  'Facts the check needs, per client, as a json object. Money keys end in _cents and hold integer cents.';
