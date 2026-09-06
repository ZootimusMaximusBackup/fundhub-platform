-- 330_client_waypoints.sql — the client's checklist, and the spine of the
-- portal.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS FOR
--
-- A client pays up to $10,000 and today receives four PDFs. The replacement is
-- a living portal, and the thing that makes it living is an ordered list of
-- waypoints per client: what has to happen, in what order, WHOSE JOB each one
-- is, when it is due, and — the column that matters commercially —
-- WHAT IT COSTS TO HAVE US DO IT INSTEAD.
--
-- `paid_alternative_price_cents` is in this table from its first migration, not
-- bolted on later, because it is what separates an upsell ecosystem from a
-- to-do list. Every waypoint the client owns is a place they can stall, and
-- every place they can stall is a place we can offer to do it for them.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS IS NOT THE `tasks` TABLE
--
-- It was checked before this file was written, and `tasks` cannot hold these
-- rows:
--
--   * db/migrations/041_task_routing.sql:57 — `tasks_assignee_role_ck` allows
--     staff roles only.
--   * src/lib/create-task.mjs:70 throws with the reason spelled out:
--     "Principal types (client, affiliate, partner) must never own internal
--     work."
--
-- That is a deliberate rule about internal work routing and this file does not
-- fight it. A waypoint is not internal work — it is the client's own journey,
-- and roughly half of the rows are the client's own job by design. Different
-- thing, different table.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL MEANS UNKNOWN, AND ZERO IS NOT A PRICE (CLAUDE.md §12)
--
--   paid_alternative_price_cents NULL — there is no paid alternative to this
--     waypoint. It is not "free" and it is not "$0.00". A CHECK below makes 0
--     impossible to store, so no later reader can mistake one for the other.
--   due_at NULL — nobody has set a deadline. The row is NOT overdue. "Overdue"
--     is `due_at < now() AND state NOT IN ('done','skipped')`, which is a
--     computed fact about a real date and never a guess about a missing one.
--   completed_at — pinned to `state = 'done'` by a CHECK, so a screen never has
--     to read two columns and hope they agree.
--
-- Money is integer cents throughout (src/commissions/money.mjs). bigint, like
-- soft_pull_requests.cost_cents and tradelines, not numeric dollars.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- 1. NO SEEDED WAYPOINTS. Not one row is written. Which waypoints a client gets
--    is a product decision belonging to the lane that builds the read endpoint;
--    inventing a default ladder here would put copy nobody approved in front of
--    a paying client.
-- 2. NO LINK TO paid_service_requests. That table (331) carries
--    `waypoint_id`, so the arrow points one way and the two files can apply in
--    order without a circular reference.
-- 3. NO UNIQUE INDEX ON `position`. Reordering a list under a non-deferrable
--    unique index means every move is a multi-statement shuffle that can fail
--    halfway. Order is a plain index; ties break on `key`, which IS unique.
--
-- SAFETY. Additive. Creates one table, touches no existing row, drops nothing.
-- Re-running it is a no-op.

CREATE TABLE IF NOT EXISTS public.client_waypoints (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- The stable machine name for this step — 'upload_id', 'sign_agreement',
  -- 'round_1_mailed'. Code finds a waypoint by this, never by matching the
  -- title, so the title stays free to be rewritten as copy without breaking a
  -- lookup.
  key           text NOT NULL
                CONSTRAINT client_waypoints_key_ck CHECK (key ~ '^[a-z0-9_]{2,64}$'),

  -- What the client reads. Non-blank enforced with a regex rather than
  -- btrim(): btrim's default trim set is the SPACE CHARACTER ONLY, so a title
  -- of E'\t\n' passes the btrim form and lands looking like an answer. Same
  -- call soft_pull_requests.reason makes (077) and for the same reason.
  title         text NOT NULL
                CONSTRAINT client_waypoints_title_ck CHECK (title ~ '[^[:space:]]'),
  detail        text,

  -- Display order within one client's list. Not unique — see the header.
  position      int NOT NULL DEFAULT 0
                CONSTRAINT client_waypoints_position_ck CHECK (position >= 0),

  -- WHOSE JOB IT IS. The whole accountability half of the product is this
  -- column: a client can only be nudged about a row they own, and a paid
  -- alternative can only be offered on a row they own.
  owner_kind    text NOT NULL
                CONSTRAINT client_waypoints_owner_kind_ck
                CHECK (owner_kind IN ('client', 'fundhub')),

  state         text NOT NULL DEFAULT 'not_started'
                CONSTRAINT client_waypoints_state_ck
                CHECK (state IN ('not_started', 'in_progress', 'blocked', 'done', 'skipped')),

  -- Why a row is blocked or skipped. Only meaningful for those two states.
  state_reason  text,

  due_at        timestamptz,
  completed_at  timestamptz,

  -- ── THE UPSELL COLUMN ────────────────────────────────────────────────────
  -- What we charge to do this waypoint for the client, in integer cents.
  --   NULL  = no paid alternative exists for this waypoint.
  --   > 0   = the price.
  --   0     = IMPOSSIBLE. The CHECK refuses it, so nothing downstream can read
  --           a zero and call it free when what was meant was "unknown".
  paid_alternative_price_cents bigint
                CONSTRAINT client_waypoints_paid_price_ck
                CHECK (paid_alternative_price_cents IS NULL
                       OR paid_alternative_price_cents > 0),

  -- What the button says, when there is one.
  paid_alternative_label text,

  -- Which service is bought when the client takes the paid alternative. Kept in
  -- step with paid_service_requests.service_kind (331) by name, not by an FK,
  -- because it names a kind of work rather than a row.
  paid_alternative_kind text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- One waypoint per key per client. This is what makes a waypoint findable and
  -- what stops a re-run of whatever builds the list from doubling it.
  CONSTRAINT client_waypoints_client_key_uq UNIQUE (client_id, key),

  -- 'done' and completed_at say the same thing, so they may never disagree.
  CONSTRAINT client_waypoints_completed_ck CHECK (
    (state = 'done' AND completed_at IS NOT NULL)
    OR (state <> 'done' AND completed_at IS NULL)
  ),

  -- A label or a kind is a promise that a paid alternative exists. Neither may
  -- be set without a price, or a screen renders a "do it for me" button with
  -- nothing to charge.
  CONSTRAINT client_waypoints_paid_shape_ck CHECK (
    (paid_alternative_label IS NULL AND paid_alternative_kind IS NULL)
    OR paid_alternative_price_cents IS NOT NULL
  )
);

-- The read the portal makes on every page load: one client's list, in order.
CREATE INDEX IF NOT EXISTS client_waypoints_client_order_idx
  ON public.client_waypoints (client_id, position, key);

-- "What is overdue" across the org, without scanning the whole table. Partial
-- on the rows that can be overdue at all — a done or skipped waypoint never is,
-- and a row with no due date never is either.
CREATE INDEX IF NOT EXISTS client_waypoints_due_idx
  ON public.client_waypoints (org_id, due_at)
  WHERE due_at IS NOT NULL AND state NOT IN ('done', 'skipped');

-- "Where are clients stalling on something they own that we sell a way past" —
-- the upsell read.
CREATE INDEX IF NOT EXISTS client_waypoints_paid_open_idx
  ON public.client_waypoints (org_id, paid_alternative_price_cents)
  WHERE paid_alternative_price_cents IS NOT NULL
    AND owner_kind = 'client'
    AND state NOT IN ('done', 'skipped');

COMMENT ON TABLE public.client_waypoints IS
  'Per-client ordered checklist behind the portal. Carries whose job each step is and what we charge to do it instead. Not tasks — tasks_assignee_role_ck (041) allows staff roles only and a client may never own an internal task.';
COMMENT ON COLUMN public.client_waypoints.paid_alternative_price_cents IS
  'Integer cents we charge to do this waypoint for the client. NULL = no paid alternative exists. 0 is refused by CHECK so it can never be read as "free".';
COMMENT ON COLUMN public.client_waypoints.due_at IS
  'NULL = no deadline set, and therefore NOT overdue. Overdue is due_at < now() AND state NOT IN (done, skipped) — a computed fact, never a guess.';
COMMENT ON COLUMN public.client_waypoints.owner_kind IS
  'client | fundhub. Whose job this step is. A paid alternative is only ever offered on a row the client owns.';

-- ---------------------------------------------------------------------------
-- updated_at, guarded the same way 275 section D guards it
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_client_waypoints_updated ON public.client_waypoints;
    CREATE TRIGGER trg_client_waypoints_updated
      BEFORE UPDATE ON public.client_waypoints
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security — the same shape repair_programs (250) carries
-- ---------------------------------------------------------------------------
-- ENABLE + FORCE + one permissive policy. A table with RLS on and no policy
-- denies everything to fundhub_app SILENTLY (a SELECT returns zero rows, an
-- INSERT is dropped, nothing raises), which is the failure 200, 201 and 285
-- were all written to clean up. Declaring the state here means a fresh CI
-- database and live describe the same schema.
--
-- Isolation lives in the application layer for this class of table, exactly as
-- it does for clients, documents, messages and repair_programs. This policy
-- restores access; it does not partition tenants.
ALTER TABLE public.client_waypoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_waypoints FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'client_waypoints'
       AND policyname = 'client_waypoints_app_all'
  ) THEN
    CREATE POLICY client_waypoints_app_all ON public.client_waypoints
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 104_app_role.sql's blanket grant ran before this table existed. Its ALTER
-- DEFAULT PRIVILEGES covers tables created by the same role afterwards, but
-- that is only true when the migration runs as that role, so grant explicitly —
-- the same belt-and-braces 275 section E uses.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_waypoints TO fundhub_app;
  END IF;
END $$;
