-- 361_waypoint_definitions.sql — the checklist itself, as DATA.
--
-- WHY A TABLE AND NOT A JAVASCRIPT ARRAY.
--
-- Chris, 2026-09-05, recorded in TODO.md item 0: the six-month UnderwriteIQ
-- strategy IS NOT FINALISED, and it is going out to clients right now. Whatever
-- the checklist says today, it is going to change — and if the list is six
-- months of hardcoded tasks in a .mjs file then every change is a code change,
-- a review, a deploy and an agent. Here it is rows. Changing what a client is
-- asked to do is an INSERT or an UPDATE against this table.
--
-- WHAT IS DELIBERATELY NOT IN HERE, and this is not an oversight:
--
--   * DUN & BRADSTREET / DUNS. "we dont do DUNS" — Chris, 2026-09-05. The
--     Credit Optimization Roadmap still prints it (fundhub_gen.py:1483) and it
--     is still undecided whether it stays in the product at all. No row.
--   * NET-30 VENDOR ACCOUNTS (Uline, Quill, Grainger) and PAYDEX. Same source
--     line, same answer, plus nothing in this platform holds a vendor list, a
--     Paydex field, or any business-credit tracking — so a waypoint for them
--     could never be chased or closed by anything. No row.
--   * THE DISPUTE LETTERS. They are our job, not the client's. A client's list
--     is the things a client has to go and do.
--
-- SCOPE: this catalog is GLOBAL, with no org_id. One list, every tenant. A
-- per-partner override is a real thing a white-label might want and it is
-- deliberately not built on speculation (CLAUDE.md §8, no speculative
-- abstraction); adding org_id later is an additive column and a changed unique
-- index, not a rewrite.
--
-- GRANTS: the application reads this table and never writes it. Editing the
-- checklist is a deliberate act against the database, not something a request
-- handler can do by accident.
--
-- SAFETY. Additive. Creates one table and seeds nothing — 362 does the seeding,
-- so the list can be superseded by a later file without touching this DDL
-- (editing an applied migration is a silent no-op in this repo).

CREATE TABLE IF NOT EXISTS public.waypoint_definitions (
  -- The stable machine name of the DEFINITION. For a definition that expands
  -- once this is also the waypoint's key. For one that expands per account it
  -- is not — 'paydown_revolving_account' becomes 'paydown_chase_1',
  -- 'paydown_amex_1' and so on, because a client has one waypoint per card.
  key           text PRIMARY KEY
                CONSTRAINT waypoint_definitions_key_ck CHECK (key ~ '^[a-z0-9_]{2,64}$'),

  -- How many waypoints one definition becomes for one client.
  --   'once'                  → exactly one.
  --   'per_revolving_account' → one per revolving account on the freshest
  --                             credit file, which is the roadmap's paydown
  --                             table. Zero accounts means zero waypoints, and
  --                             that is a correct empty list, not a failure.
  -- CHECKED, unlike verify_kind, because each value is a hard-coded branch in
  -- the seeder. A value with no branch would silently produce nothing.
  expands       text NOT NULL DEFAULT 'once'
                CONSTRAINT waypoint_definitions_expands_ck
                CHECK (expands IN ('once', 'per_revolving_account')),

  -- Client-facing copy. Supports the tokens {creditor}, {target} and
  -- {state_clause}; a token with no value for this client resolves to nothing
  -- and the surrounding whitespace is collapsed, so every string here must
  -- still read as a sentence with any token removed.
  --
  -- OWNER-SET BRANDING (portal-rebuild-plan.md §5): the term "credit repair"
  -- appears in no client-facing copy. Funding-optimisation and
  -- capital-readiness language only. This column is client-facing copy.
  title         text NOT NULL
                CONSTRAINT waypoint_definitions_title_ck CHECK (title ~ '[^[:space:]]'),
  detail        text,

  position      int NOT NULL DEFAULT 0
                CONSTRAINT waypoint_definitions_position_ck CHECK (position >= 0),

  owner_kind    text NOT NULL
                CONSTRAINT waypoint_definitions_owner_kind_ck
                CHECK (owner_kind IN ('client', 'fundhub')),

  -- Days from the moment the client is enrolled to when this is due.
  --   NULL = NO DEADLINE, and that is a real answer, not a missing one. A
  --   waypoint with a NULL due date is never overdue (client_waypoints.due_at,
  --   src/waypoints/store.mjs isOverdue), so the honest thing to do with a task
  --   whose timing nobody has settled is to leave it NULL rather than invent a
  --   date a client then gets chased about.
  due_offset_days int
                CONSTRAINT waypoint_definitions_due_offset_ck
                CHECK (due_offset_days IS NULL OR due_offset_days >= 0),

  -- Copied onto the waypoint. NULL means nothing the platform can see closes
  -- this row. See 360.
  verify_kind   text
                CONSTRAINT waypoint_definitions_verify_kind_ck
                CHECK (verify_kind IS NULL OR verify_kind ~ '^[a-z0-9_]{2,64}$'),

  -- The upsell, in integer cents, copied onto the waypoint. Same rules as
  -- client_waypoints: NULL is "no paid alternative exists", 0 is refused so
  -- nothing can read a zero and call it free.
  paid_alternative_price_cents bigint
                CONSTRAINT waypoint_definitions_paid_price_ck
                CHECK (paid_alternative_price_cents IS NULL
                       OR paid_alternative_price_cents > 0),
  paid_alternative_label text,
  paid_alternative_kind  text,
  CONSTRAINT waypoint_definitions_paid_shape_ck CHECK (
    (paid_alternative_label IS NULL AND paid_alternative_kind IS NULL)
    OR paid_alternative_price_cents IS NOT NULL
  ),

  -- Turn a task off without deleting it, so the reason it existed survives.
  active        boolean NOT NULL DEFAULT true,

  -- Internal. Why this row is here, or why it is not verifiable. Never shown to
  -- a client.
  notes         text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- The seeder's read: every live definition, in display order.
CREATE INDEX IF NOT EXISTS waypoint_definitions_active_order_idx
  ON public.waypoint_definitions (position, key)
  WHERE active;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_waypoint_definitions_updated ON public.waypoint_definitions;
    CREATE TRIGGER trg_waypoint_definitions_updated
      BEFORE UPDATE ON public.waypoint_definitions
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security — the same ENABLE + FORCE + one permissive policy shape
-- 330 carries. A table with RLS on and no policy denies everything to
-- fundhub_app silently: a SELECT returns zero rows and nothing raises, which
-- here would mean every client silently gets an empty checklist.
--
-- There is no tenant to partition on. This is a global catalog.
-- ---------------------------------------------------------------------------
ALTER TABLE public.waypoint_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waypoint_definitions FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'waypoint_definitions'
       AND policyname = 'waypoint_definitions_app_read'
  ) THEN
    CREATE POLICY waypoint_definitions_app_read ON public.waypoint_definitions
      FOR SELECT USING (true);
  END IF;
END $$;

-- SELECT only. The application reads the checklist; it does not get to rewrite
-- what clients are asked to do as a side effect of serving a request.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT ON public.waypoint_definitions TO fundhub_app;
  END IF;
END $$;

COMMENT ON TABLE public.waypoint_definitions IS
  'The seedable client checklist, as data. Edited with SQL, not with a deploy, because the six-month strategy is not finalised (TODO.md item 0). Deliberately carries no DUNS, net-30 vendor or Paydex task: owner-set "we dont do DUNS", 2026-09-05, and nothing in the platform could observe them anyway.';
COMMENT ON COLUMN public.waypoint_definitions.due_offset_days IS
  'Days from enrolment to the due date. NULL means no deadline, which is a real answer — a NULL due date is never overdue.';
COMMENT ON COLUMN public.waypoint_definitions.expands IS
  'once = one waypoint per client. per_revolving_account = one per revolving account on the freshest credit file (the roadmap paydown table).';
