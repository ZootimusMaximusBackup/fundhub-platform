-- 235_affiliate_link_clicks.sql — the click, finally stored as a row (T10-04).
--
-- NUMBERED 235, NOT 177. docs/workflows/fix-2026-08-18/BOARD.md reserves
-- 235-239 for thread T10. An earlier brief said 177; that number belongs to
-- another thread and using it would collide.
--
--
-- WHY THIS TABLE EXISTS.
--
-- The affiliate screen shows a CLICKS tile and a "click to funded" funnel, and
-- both have always been em dashes, because nothing anywhere records a click.
-- public/start.html reads ?ref= into localStorage and immediately
-- location.replace()s the visitor to apply.fundhub.ai. Not one byte reaches a
-- server. There was no clicks table to reach.
--
-- This is that table. One row per visit to a referral link.
--
--
-- *** affiliate_id IS NULLABLE, ON PURPOSE. DO NOT ADD NOT NULL. ***
--
-- A link can carry a code that matches no affiliate: a retired code, a typo, a
-- code from the old GHL system, or somebody hand-editing the URL. That click
-- still happened, and "somebody used code DKOWAL-000123 and it resolved to
-- nobody" is a fact worth keeping — it is how a dead link gets noticed. So the
-- code is stored in tracking_id_used (NOT NULL) whatever it turned out to be,
-- and affiliate_id stays NULL when it resolved to nobody. NULL means UNKNOWN
-- and must survive; it must never be back-filled to "some affiliate" later.
--
-- The endpoint that writes this row (api/public/affiliate-click.mjs) answers
-- identically whether the code resolved or not, so this table can never be
-- used to find out which codes exist.
--
--
-- *** HASHES ONLY. NO RAW IP, NO RAW USER AGENT, EVER. ***
--
-- This is a regulated consumer-finance product and an IP address is personal
-- data. Nothing here needs to know who a visitor is — the columns exist so a
-- flood of clicks from one place is countable, and that works just as well on
-- a hash. Both columns are text and both are nullable:
--
--   ip_hash          a SALTED sha256. Written ONLY when CLICK_HASH_SALT is
--                    configured, because an unsalted hash of an IPv4 address is
--                    not an anonymisation at all — the whole address space is
--                    four billion values and a laptop reverses it in minutes.
--                    With no salt configured this column stays NULL, which is
--                    the honest answer: not recorded.
--   user_agent_hash  sha256 of the user agent string, truncated. A coarse
--                    client fingerprint, not an identity.
--
-- There is no column for a raw address or a raw agent string and none may be
-- added. If a future need appears, it is a new decision, not a new column.

CREATE TABLE IF NOT EXISTS affiliate_link_clicks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- NULLABLE ON PURPOSE — see the header. NULL = the code resolved to nobody.
  affiliate_id  uuid REFERENCES affiliates(id),

  -- The code exactly as it arrived on the link, trimmed and length-capped by
  -- the endpoint. Snapshotted for the same reason affiliate_referrals snapshots
  -- it: a vanity code can be reissued, and a click from March must still
  -- explain itself.
  tracking_id_used text NOT NULL,

  -- The business time of the click, not the write. Defaulted rather than
  -- required because the only writer is the redirect itself, which is live.
  occurred_at   timestamptz NOT NULL DEFAULT now(),

  -- Where the click came from: 'start-page' | 'partner-site' | ... Free text
  -- and nullable, because a caller that names no source is not a caller whose
  -- source we get to invent.
  source        text,

  -- Hashes only. See the header. Both stay NULL when not derivable.
  user_agent_hash text,
  ip_hash         text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A blank code is not a code. The endpoint already refuses one; this is the
-- database saying the same thing so a future writer cannot get it wrong.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_link_clicks_code_present') THEN
    ALTER TABLE affiliate_link_clicks ADD CONSTRAINT affiliate_link_clicks_code_present
      CHECK (btrim(tracking_id_used) <> '');
  END IF;
END $$;

-- The only question this table is asked: how many clicks did this affiliate get,
-- most recent first. api/read/affiliates.mjs counts lifetime and last-30-days
-- off exactly this index.
CREATE INDEX IF NOT EXISTS affiliate_link_clicks_affiliate_idx
  ON affiliate_link_clicks (affiliate_id, occurred_at DESC);

-- The second question, asked by nobody on a screen but by anyone chasing a dead
-- code: which codes are arriving in this company that resolve to nobody.
CREATE INDEX IF NOT EXISTS affiliate_link_clicks_org_code_idx
  ON affiliate_link_clicks (org_id, upper(tracking_id_used), occurred_at DESC);


-- ── The app role's rights on a table that did not exist when 104 ran ───────
--
-- 104_app_role.sql's ALTER DEFAULT PRIVILEGES should cover this, but only when
-- migrate.mjs runs as the same role that ran 104. Stated explicitly here, the
-- way 176_company_brain_upload_reviews.sql does, so a database where that is
-- not true does not end up with a table the app cannot write.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON affiliate_link_clicks TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;


-- ── Row Level Security, declared rather than left to drift ──────────────────
--
-- The no-bare-RLS pattern, third generation. 109 / 154 / 201 each had to repair
-- tables that were switched to RLS-on with ZERO policies out of band, which in
-- Postgres denies everything to every role but the owner — so the app silently
-- reads nothing and every write is refused. 203_bookings_rls_policy.sql records
-- why a later sweep cannot save a table that drifts after the sweep ran.
--
-- The fix is to arrive with the state declared: ENABLE, FORCE, and a named
-- policy in the same file that creates the table, so there is never a moment
-- when this table is RLS-on and policy-less.
--
-- The policy is permissive — USING (true) WITH CHECK (true) — matching the 147
-- other tables here. Isolation between companies is done in the application
-- layer (every query in api/read/affiliates.mjs binds org_id); tightening that
-- platform-wide is audit item T16-05 and is deliberately not bundled here.
DO $$
BEGIN
  ALTER TABLE public.affiliate_link_clicks ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.affiliate_link_clicks FORCE ROW LEVEL SECURITY;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'affiliate_link_clicks'
       AND policyname = 'affiliate_link_clicks_app_all'
  ) THEN
    CREATE POLICY affiliate_link_clicks_app_all ON public.affiliate_link_clicks
      USING (true) WITH CHECK (true);
    RAISE NOTICE '235: affiliate_link_clicks created with its policy attached';
  END IF;
END $$;
