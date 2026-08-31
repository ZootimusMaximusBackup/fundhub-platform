-- 282_partner_production_floor.sql — the only partner filter, given a place to stand.
--
-- WHAT THIS IS FOR. docs/specs/W0-decisions.md: entry no longer screens anybody
-- (anyone financeable can buy in at $10,000), so PRODUCTION is the whole quality
-- control on the partner base — **10 funding clients per month**, and below it the
-- partnership ends. W1-money-model.md §6 carries the mechanism: a rolling 90-day
-- half-open window, a 90-day grace from activation, the first score at day 180,
-- evaluated on the 1st of each month, and a warning → final notice → downgrade
-- ladder that moves partners.revenue_share_pct from 50 to 20 ON NEW BUSINESS ONLY.
--
-- Both halves of that were unimplementable against the schema as it stood, for two
-- separate reasons, and this migration fixes exactly those two things.
--
--
-- A. THERE WAS NO ACTIVATION DATE. Every timing rule in §6 — grace, first
--    evaluation, every window boundary — is counted from the moment
--    partners.status became 'active'. That moment was recorded NOWHERE. 042 has
--    created_at (when the row was made, which for a trial partner is weeks before
--    they were activated and for an invited partner may be months) and updated_at
--    (which moves on every unrelated edit, so it answers a different question every
--    time somebody changes a brand name). Neither is the activation date and
--    neither may be substituted for it: a guessed activation date is a guessed
--    evaluation date, which is a partner judged early or judged never.
--
--    So: a real column, stamped by a TRIGGER rather than by application code.
--    Three different paths already flip a partner to 'active' (approval, trial
--    conversion, a hand UPDATE by an operator) and a fourth will exist next month.
--    A stamp in one of them is a stamp missing from the other three, and the
--    failure is silent — the partner simply never becomes evaluable. In the
--    database it cannot be missed.
--
--    EXISTING ACTIVE PARTNERS ARE LEFT NULL ON PURPOSE. There is no honest source
--    for when they were activated, and CLAUDE.md is explicit that a missing fact is
--    a finding rather than a gap to fill with a plausible number. NULL means
--    UNKNOWN and it survives: src/partners/floors.mjs refuses to evaluate a partner
--    with no activation date and says so by name ('no_activation_date') instead of
--    quietly treating today, or their created_at, as day zero. Set it by hand, per
--    partner, when somebody actually knows the date.
--
--
-- B. A LADDER NEEDS MEMORY. "Two consecutive windows below the floor" cannot be
--    computed from the partners row — it needs last month's answer, and the one
--    before that. partner_production_reviews is that memory: one row per partner
--    per evaluated window, carrying the count, the bar it was measured against, the
--    outcome, and — where the ladder moved money — the share percentage before and
--    after.
--
--    THE BAR IS FROZEN ON THE ROW, exactly as partner_revenue.share_pct_applied
--    freezes the rate. floor_per_month and floor_clients record the threshold that
--    was actually in force when the judgement was made, so raising the floor later
--    never retroactively converts a partner's passing month into a failing one. The
--    reason 042 has that column is the reason these two exist.
--
--    APPEND-ONLY. A no-delete trigger, matching partner_revenue_no_delete() and
--    fundhub_no_delete(): the record of why a partner's share was cut is the
--    evidence behind a commercial decision, and a decision whose evidence can be
--    deleted is a decision nobody can defend. Corrections are new rows.
--
--    ONE ROW PER PARTNER PER WINDOW END. The unique index is what makes the monthly
--    job safe to re-run — a second pass on the same 1st of the month writes
--    nothing rather than double-counting a partner onto the next rung of the
--    ladder. Idempotency is the database's job here for the same reason it is in
--    042.
--
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO:
--
--   * It does not touch partners.revenue_share_pct on any existing row. The ladder
--    moves that value at evaluation time, one partner at a time, with the before
--    and after recorded. A blanket UPDATE here would restate live commercial terms
--    with no evidence trail.
--   * It does not flip partners.status. W1 §6 is explicit: status stays 'active'
--    through a downgrade, because 'paused' blocks payouts entirely (042's trigger)
--    and would withhold money the partner genuinely earned.
--   * It does not store the floor number itself as configuration. 10/month is
--    owner-set in W0 and lives in src/partners/floors.mjs as a named constant; the
--    columns here record what was applied, they do not decide it.
--
-- SAFETY. Additive and idempotent. No DELETE, no UPDATE of existing data, nothing
-- revoked. Editing 042 instead would have been a silent no-op — db/migrate.mjs
-- keys schema_migrations by '<dir>/<file>' (CLAUDE.md §12) — which is why this is a
-- new file.
--
-- COMPLIANCE REVIEW REQUIRED: this schema backs an automatic change to a partner's
-- revenue share percentage.

-- ---------------------------------------------------------------------------
-- A. partners.activated_at — the clock every §6 rule is counted from
-- ---------------------------------------------------------------------------

ALTER TABLE partners ADD COLUMN IF NOT EXISTS activated_at timestamptz;

COMMENT ON COLUMN partners.activated_at IS
  'When this partner first became active. The zero point for every production-floor rule in docs/specs/W1-money-model.md §6 (90-day grace, first evaluation at day 180, every rolling window). Stamped once by trg_partners_stamp_activated_at and never moved by a later pause/resume. NULL means UNKNOWN — the partner is not evaluable and src/partners/floors.mjs refuses rather than guessing. Never backfill it with created_at.';

-- Stamped in the database, not in a handler: several code paths flip a partner to
-- 'active' and a stamp missing from one of them is a partner who is never judged.
-- WRITE-ONCE. `activated_at IS NULL` in the guard means a partner who is paused and
-- later resumed keeps their ORIGINAL activation date. Re-stamping on resume would
-- hand a struggling partner a fresh 180-day exemption every time they were paused,
-- which is a loophole rather than a grace period.
CREATE OR REPLACE FUNCTION partners_stamp_activated_at() RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'active' AND NEW.activated_at IS NULL THEN
    -- An explicitly supplied date wins: a backfill or an import knows better than
    -- now() does. This only fires when the row arrives with nothing.
    NEW.activated_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_partners_stamp_activated_at ON partners;
CREATE TRIGGER trg_partners_stamp_activated_at
  BEFORE INSERT OR UPDATE OF status, activated_at ON partners
  FOR EACH ROW
  EXECUTE FUNCTION partners_stamp_activated_at();

-- "Which partners are due for evaluation?" is the monthly job's only question.
CREATE INDEX IF NOT EXISTS partners_activated_idx
  ON partners (org_id, status, activated_at)
  WHERE activated_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- B. partner_production_reviews — the ladder's memory
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partner_production_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  -- NOT NULL. Unlike clients.partner_id, a review that belongs to no partner has
  -- no meaning, and it would be a row no RLS policy matches.
  partner_id        uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  -- Half-open [start, end), matching partner_payouts.period_start/period_end and
  -- W1 §6. Two consecutive windows cannot both claim the same instant.
  window_start      timestamptz NOT NULL,
  window_end        timestamptz NOT NULL,
  evaluated_at      timestamptz NOT NULL DEFAULT now(),

  -- The measurement: distinct clients of this partner whose FIRST surviving
  -- FUNDING_DFY deposit landed inside the window. The definition lives in exactly
  -- one place — SQL_COUNT_FUNDING_CLIENTS in src/partners/floors.mjs.
  funding_clients   integer NOT NULL,

  -- The bar AS APPLIED, frozen for the same reason share_pct_applied is frozen.
  -- floor_per_month is the owner-set headline number (10, W0); floor_clients is
  -- what that works out to over this window's length.
  floor_per_month   integer NOT NULL,
  floor_clients     integer NOT NULL,
  met               boolean NOT NULL,

  -- How many consecutive windows below the floor this review leaves the partner
  -- on. 0 after any window that met the bar. The ladder reads only this.
  consecutive_misses integer NOT NULL DEFAULT 0,

  --   good_standing — at or above the floor, nothing owed
  --   warning       — one window below
  --   final_notice  — two consecutive below; 30-day cure runs to cure_due_at
  --   downgrade     — three consecutive below; share moved down on NEW business
  --   restored      — a full window at or above the floor after a downgrade
  outcome           text NOT NULL,

  -- Only set on the two rungs that move money. NULL everywhere else, and NULL
  -- means "the share was not touched" rather than "the share was zero".
  share_pct_before  numeric(9,5),
  share_pct_after   numeric(9,5),

  cure_due_at       timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ppr_window_ck   CHECK (window_end > window_start),
  CONSTRAINT ppr_count_ck    CHECK (funding_clients >= 0),
  CONSTRAINT ppr_floor_ck    CHECK (floor_clients >= 0 AND floor_per_month >= 0),
  CONSTRAINT ppr_misses_ck   CHECK (consecutive_misses >= 0),
  CONSTRAINT ppr_outcome_ck  CHECK (outcome IN
    ('good_standing', 'warning', 'final_notice', 'downgrade', 'restored')),
  CONSTRAINT ppr_pct_ck      CHECK (
    (share_pct_before IS NULL OR (share_pct_before >= 0 AND share_pct_before <= 100)) AND
    (share_pct_after  IS NULL OR (share_pct_after  >= 0 AND share_pct_after  <= 100))),
  -- The two rungs that move money must say what they moved it from and to.
  -- Anything else must not claim to have moved it.
  CONSTRAINT ppr_share_move_ck CHECK (
    CASE WHEN outcome IN ('downgrade', 'restored')
         THEN share_pct_before IS NOT NULL AND share_pct_after IS NOT NULL
         ELSE share_pct_before IS NULL AND share_pct_after IS NULL
    END),
  -- A final notice without a cure date is a notice nobody can act on.
  CONSTRAINT ppr_cure_ck CHECK (outcome <> 'final_notice' OR cure_due_at IS NOT NULL),
  -- met and the count must agree with the bar they were measured against.
  CONSTRAINT ppr_met_ck CHECK (met = (funding_clients >= floor_clients)),
  -- A window that met the floor cannot leave the partner carrying misses.
  CONSTRAINT ppr_met_misses_ck CHECK (NOT met OR consecutive_misses = 0)
);

-- Re-running the monthly job on the same day writes nothing rather than pushing a
-- partner another rung down the ladder. This index IS the idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS ppr_partner_window_uniq
  ON partner_production_reviews (org_id, partner_id, window_end);

-- "What is this partner's standing?" — the newest row wins, and the screen asks
-- this on every page load.
CREATE INDEX IF NOT EXISTS ppr_partner_recent_idx
  ON partner_production_reviews (partner_id, window_end DESC);

-- "Who did we downgrade, and what were they on before?" — the restore path reads
-- this to put back the rate it took away rather than a hardcoded 50.
CREATE INDEX IF NOT EXISTS ppr_downgrades_idx
  ON partner_production_reviews (org_id, partner_id, window_end DESC)
  WHERE outcome IN ('downgrade', 'restored');

-- The evidence behind a commercial decision is not disposable. Correct with a new
-- row; the unique index above is on window_end, so a correction for a window
-- already reviewed is a deliberate act, not an accident.
CREATE OR REPLACE FUNCTION partner_production_reviews_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'partner_production_reviews rows are not deletable — they are the evidence behind a revenue-share change (282_partner_production_floor.sql)';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ppr_no_delete ON partner_production_reviews;
CREATE TRIGGER trg_ppr_no_delete
  BEFORE DELETE ON partner_production_reviews
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION partner_production_reviews_no_delete();

-- ---------------------------------------------------------------------------
-- C. Row-level security — one partner must never read another's review
-- ---------------------------------------------------------------------------
--
-- Through fundhub_apply_partner_rls() (045_creative_factory.sql), which enables
-- AND forces RLS and installs the policy in one call. Guarded on the function's
-- existence so a scratch database built from a partial migration set still applies
-- this file; a table with RLS enabled and no policy denies everything to every
-- ordinary role, which is precisely the incident 109_no_bare_rls.sql documents.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fundhub_apply_partner_rls') THEN
    PERFORM fundhub_apply_partner_rls('partner_production_reviews');
  ELSE
    RAISE NOTICE 'skipped RLS: fundhub_apply_partner_rls() does not exist in this database';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_production_reviews TO fundhub_app;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- D. updated_at, in the guarded style of 042
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname = 'trg_ppr_updated_at'
                      AND tgrelid = 'public.partner_production_reviews'::regclass) THEN
      CREATE TRIGGER trg_ppr_updated_at
        BEFORE UPDATE ON partner_production_reviews
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;

COMMENT ON TABLE partner_production_reviews IS
  'One row per partner per evaluated 90-day production window (docs/specs/W1-money-model.md §6, floor owner-set in W0-decisions.md at 10 funding clients per month). Append-only: it is the evidence behind an automatic revenue-share change. floor_per_month/floor_clients are frozen as applied so raising the bar later never restates a past judgement.';
