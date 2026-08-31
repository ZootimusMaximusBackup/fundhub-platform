-- 284_training_delivery.sql — somewhere for the $10,000 training to live.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): two of the four gates this table
-- records are compliance certifications. G2 is what stands between a partner and
-- publishing copy under FundHub's brand, and the label stays on any file that
-- decides that. It is a marker, not a request to revisit an owner decision.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFECT THIS CLOSES
--
-- docs/specs/W0-decisions.md sells the $10,000 entry as "the white-label program
-- PLUS real education and training". docs/specs/W6-pricing-menu.md lists
-- Training as one of the six things the base price buys. docs/specs/W7-curriculum.md
-- designs it: thirteen modules, a twelve-week live cohort, and FOUR HARD GATES a
-- partner must clear before selling anything under FundHub's fulfilment.
--
-- And W7's own gap list ends with the sentence this file exists to delete:
--
--     THERE IS NO COURSE DELIVERY SYSTEM. src/education/enrollments.mjs is
--     enrollment requests only ... no lessons table, no player, no entitlement
--     check anywhere in db/. The $10,000 curriculum has nowhere in this platform
--     to live.
--
-- That was true. A partner could pay $10,000, be activated, be issued a brand and
-- start selling under FundHub's fulfilment with no record anywhere that they had
-- sat the two certified compliance modules — because there was nowhere to keep
-- one. A partner saying the wrong thing in an ad creates liability for FundHub
-- (W7 M7: Credit Repair Cloud paid $3,000,000 in CFPB penalties on an assisting
-- theory), and the machine screener reads ad copy only. It cannot see where a
-- partner is registered, how they take money, or how they dial a phone. The gate
-- record is the only control that covers any of that, and it did not exist.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS IS, AND — MORE IMPORTANTLY — WHAT IT IS NOT
--
-- It is four tables: the curriculum, the gates, one partner's progress through
-- the modules, and the dated record of every gate decision.
--
-- IT IS NOT A COURSE PLAYER, and it must not grow into one by accident. There is
-- no video table, no quiz engine, no certificate, no discussion thread and no
-- lesson BODY anywhere in this file. W7 is explicit that the format is a live
-- cohort with roll called — "Recordings exist as reference only" — so the thing
-- worth storing is who turned up and who cleared which gate, not a content
-- library. Writing the module content is a human authoring job on a regulated
-- product; inventing it here would be fabrication (CLAUDE.md §2, "Never invent").
-- The seeded rows below carry W7's thirteen TITLES and nothing else.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE FOUR DECISIONS INSIDE THIS FILE
--
-- 1. TWO ORDERS EXIST AND BOTH ARE REAL, so both are stored.
--
--    `code` is W7's own module number — m1 is "Your Money Math", m13 is "First
--    Three". That is how every other document in this repository refers to them
--    and it must survive.
--
--    `position` is the order a partner MEETS them, which is not the same list.
--    W7's "THE FIRST 30 DAYS" schedules week 3 as M7 and M8 and week 4 as M6, M9,
--    M10, M11 — the two compliance modules are taught BEFORE the call module,
--    deliberately, because G2 has to clear before any public asset goes live and
--    G3 before any live buyer call. Sorting the screen by module number would
--    show the partner the wrong week. Sorting by position and printing the code
--    shows both.
--
--    m12 IS THE ONE MODULE W7 DOES NOT PLACE IN A WEEK. Its `week_no` is NULL —
--    UNKNOWN, not zero and not week 1 — and its position follows W7's own
--    numbering rather than a week this file invented. NULL survives (CLAUDE.md
--    §12: NULL means unknown and must never be defaulted).
--
-- 2. A GATE IS AN EVENT, NOT A FLAG. partner_training_gates is append-only with
--    one row per DECISION, exactly like partner_production_reviews (282) and for
--    the same reason: W7's closing argument for gates over grades is that
--    franchise commentary expects a franchisor to show it actually supported the
--    operator before terminating one, and "every gate above produces a dated
--    record that the support happened". A record that can be overwritten is not
--    evidence. The current standing is the NEWEST row for that partner and gate;
--    a revocation is a new row saying so, never a DELETE and never an UPDATE.
--
-- 3. PROGRESS IS RECORDED BY FUNDHUB, NOT SELF-DECLARED. Both progress and gate
--    rows carry `recorded_by_staff_id`. W7 puts a FundHub closer on the mock
--    close (G3), a written exam that must miss zero on compliance (G2) and roll
--    call on every live session — none of which a partner can mark for
--    themselves. A partner who could tick their own compliance certification
--    would be a partner with no compliance control at all. The screen this feeds
--    is read-only for the partner, and src/training/ has no partner write path.
--
-- 4. THE CURRICULUM IS ORG-SCOPED CATALOGUE; THE PARTNER ROWS ARE PARTNER-SCOPED.
--    training_modules and training_gates are FundHub's own published list, the
--    same shape as `products` (010) — no RLS, seeded for the default org, read by
--    everybody. partner_training_progress and partner_training_gates carry a NOT
--    NULL partner_id and go through fundhub_apply_partner_rls(), so one partner
--    can never read another's record even if a query forgets its WHERE.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
--   * It does not decide who is entitled to open the training. That is read from
--     facts that already exist — the partner's status and their signed partner
--     licence (042's agreement_signed_at, whose document 283 finally seeds) — in
--     src/training/entitlement.mjs. A second copy of "is this a real partner"
--     living in a table would be a second thing to keep true.
--   * It does not block anything by itself. `hasPassedGate()` in
--     src/training/gates.mjs is the question the rest of the system can now ask;
--     no caller is wired to it in this change, and that is stated as a gap rather
--     than half-wired.
--   * It writes no money, reads no money and touches no offer, product or
--     payment table.
--
-- SAFETY. Additive and idempotent. No DELETE, no UPDATE of an existing row,
-- nothing revoked, no existing table altered. Editing an applied migration
-- instead would have been a silent no-op — db/migrate.mjs keys schema_migrations
-- by '<dir>/<file>' (CLAUDE.md §12) — which is why this is a new file at its own
-- number.

-- ---------------------------------------------------------------------------
-- A. training_modules — W7's thirteen, in the order a partner meets them
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS training_modules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- W7's own module number: 'm1' … 'm13'. The durable handle every other
  -- document already uses. Lowercased so 'M7' and 'm7' cannot both exist.
  code          text NOT NULL,
  -- The order a partner MEETS them, which is not the code order — see header
  -- decision 1.
  position      integer NOT NULL,
  title         text NOT NULL,

  -- The week W7's "THE FIRST 30 DAYS" schedules it in. NULL = W7 does not say.
  -- m12 is the only NULL and it stays one.
  week_no       integer,

  -- The gate that closes at the end of this module's week (W7 "THE FIRST 30
  -- DAYS"). NULL where W7 attaches the module to no gate — week 2's three, and
  -- m12. It is not a foreign key to training_gates because the gate catalogue is
  -- keyed per org and this stays readable as a plain code; the constraint below
  -- pins the four values that exist.
  gate_code     text,

  -- W7 marks exactly three module headings "(certified)": m6 The Call, m7
  -- Compliance I, m8 Compliance II. A certified module ends in an exam or a
  -- scored mock rather than attendance.
  certified     boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT training_modules_code_ck  CHECK (code = lower(btrim(code)) AND code <> ''),
  CONSTRAINT training_modules_pos_ck   CHECK (position > 0),
  CONSTRAINT training_modules_week_ck  CHECK (week_no IS NULL OR (week_no >= 1 AND week_no <= 12)),
  CONSTRAINT training_modules_gate_ck  CHECK (gate_code IS NULL OR gate_code IN ('G1','G2','G3','G4'))
);

CREATE UNIQUE INDEX IF NOT EXISTS training_modules_code_uniq
  ON training_modules (org_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS training_modules_position_uniq
  ON training_modules (org_id, position);

COMMENT ON TABLE training_modules IS
  'The thirteen modules of the $10,000 partner curriculum (docs/specs/W7-curriculum.md). Titles only — no module content lives here or anywhere in db/; writing it is a human authoring job on a regulated product. `code` is W7''s module number, `position` is the order a partner meets them, and the two differ on purpose.';

-- ---------------------------------------------------------------------------
-- B. training_gates — the four hard gates, in order
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS training_gates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  code          text NOT NULL,          -- 'G1' … 'G4'
  position      integer NOT NULL,       -- 1..4. W7: "FOUR HARD GATES, IN ORDER."
  title         text NOT NULL,

  -- The week W7 says the gate clears at the end of. G4 runs across weeks 5-12
  -- and its due week is the week it OPENS.
  week_due      integer NOT NULL,

  -- What a partner may not do until this gate is passed, in W7's own words. This
  -- is the sentence a screen prints and the reason the record exists at all.
  blocks        text NOT NULL,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT training_gates_code_ck CHECK (code IN ('G1','G2','G3','G4')),
  CONSTRAINT training_gates_pos_ck  CHECK (position BETWEEN 1 AND 4),
  CONSTRAINT training_gates_week_ck CHECK (week_due BETWEEN 1 AND 12)
);

CREATE UNIQUE INDEX IF NOT EXISTS training_gates_code_uniq
  ON training_gates (org_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS training_gates_position_uniq
  ON training_gates (org_id, position);

COMMENT ON TABLE training_gates IS
  'The four hard gates of docs/specs/W7-curriculum.md. No gate, no selling: G1 before a brand is issued, G2 before any public asset goes live, G3 before any live buyer call, G4 before the partner sells unsupervised.';

-- ---------------------------------------------------------------------------
-- C. partner_training_progress — one row per partner per module
-- ---------------------------------------------------------------------------
--
-- NO ROW MEANS NOT STARTED. A 'not_started' status would have to be written for
-- every partner × every module at enrolment, and would then be a second place
-- that has to be kept in step with the module list. Absence already says it.

CREATE TABLE IF NOT EXISTS partner_training_progress (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  -- NOT NULL: a progress row belonging to no partner is a row no RLS policy
  -- matches and nobody owns. Same reasoning as 282's partner_id.
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,
  module_id     uuid NOT NULL REFERENCES training_modules(id) ON DELETE RESTRICT,

  --   attended  — sat the live session; roll was called (W7: attendance is a gate)
  --   complete  — attended AND the module's exit deliverable is in
  status        text NOT NULL,

  attended_at   timestamptz,
  completed_at  timestamptz,

  -- Who at FundHub recorded it. A partner cannot mark their own module — see
  -- header decision 3. NULL only where the recording staff row was later
  -- deleted; it is never a partner id.
  recorded_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  notes         text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ptp_status_ck CHECK (status IN ('attended', 'complete')),
  -- A row that claims completion must say when. A dated record is the whole
  -- point of the file (W7: "a dated record that the support happened").
  CONSTRAINT ptp_complete_ck CHECK (status <> 'complete' OR completed_at IS NOT NULL),
  CONSTRAINT ptp_attended_ck CHECK (status <> 'attended' OR attended_at IS NOT NULL)
);

-- One row per partner per module. This IS the idempotency: recording the same
-- attendance twice updates one row rather than growing a pile the screen would
-- have to de-duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS ptp_partner_module_uniq
  ON partner_training_progress (org_id, partner_id, module_id);

-- "Where is this partner up to?" — the screen's only question, asked on every
-- page load.
CREATE INDEX IF NOT EXISTS ptp_partner_idx
  ON partner_training_progress (partner_id, status);

COMMENT ON TABLE partner_training_progress IS
  'One row per partner per training module. No row means not started. Written by FundHub staff only — a partner cannot mark their own module, least of all a certified compliance one (docs/specs/W7-curriculum.md).';

-- ---------------------------------------------------------------------------
-- D. partner_training_gates — the dated record of every gate decision
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS partner_training_gates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  -- The gate code rather than a foreign key to training_gates: the decision must
  -- stay readable and stay put even if the catalogue row is re-seeded. The CHECK
  -- pins the four that exist.
  gate_code     text NOT NULL,

  --   passed  — cleared. The partner may do the thing this gate was blocking.
  --   failed  — sat and did not clear. W7: a missed live session is sat again in
  --             the next cohort before the gate clears.
  --   revoked — was passed and is not any more. The only honest way to take a
  --             certification back, because the pass row itself cannot be edited.
  outcome       text NOT NULL,

  decided_at    timestamptz NOT NULL DEFAULT now(),
  -- The named person. W7's G3 is "a recorded full mock close, scored by a FundHub
  -- closer ... and live clients only after that person says yes" — the point of
  -- the rule is that a PERSON said yes, so the row records which one.
  decided_by_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  notes         text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT ptg_gate_ck    CHECK (gate_code IN ('G1','G2','G3','G4')),
  CONSTRAINT ptg_outcome_ck CHECK (outcome IN ('passed', 'failed', 'revoked'))
);

-- "What is this partner's standing on this gate?" — the newest row wins, and
-- src/training/gates.mjs asks exactly this.
CREATE INDEX IF NOT EXISTS ptg_partner_gate_idx
  ON partner_training_gates (partner_id, gate_code, decided_at DESC);

CREATE INDEX IF NOT EXISTS ptg_org_partner_idx
  ON partner_training_gates (org_id, partner_id, decided_at DESC);

-- Append-only, matching partner_production_reviews (282), partner_revenue and
-- fundhub_no_delete(). A compliance certification whose record can be deleted is
-- not a control; it is a claim. Corrections are new rows — that is what
-- 'revoked' is for.
CREATE OR REPLACE FUNCTION partner_training_gates_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'partner_training_gates rows are not deletable — they are the dated evidence that a partner was certified before selling under FundHub''s brand (284_training_delivery.sql). Record a new row with outcome ''revoked'' instead.';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ptg_no_delete ON partner_training_gates;
CREATE TRIGGER trg_ptg_no_delete
  BEFORE DELETE ON partner_training_gates
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION partner_training_gates_no_delete();

-- And not editable either. 282 leaves its rows updatable because a review is a
-- computed judgement the job may restate; a certification is a person's signature
-- with a date on it. Changing one silently is the failure this whole file exists
-- to prevent.
CREATE OR REPLACE FUNCTION partner_training_gates_no_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'partner_training_gates rows are immutable — a gate decision is a dated signature. Record a new row (outcome ''revoked'', then a fresh ''passed'') instead of editing this one (284_training_delivery.sql).';
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ptg_no_update ON partner_training_gates;
CREATE TRIGGER trg_ptg_no_update
  BEFORE UPDATE ON partner_training_gates
  FOR EACH ROW EXECUTE FUNCTION partner_training_gates_no_update();

COMMENT ON TABLE partner_training_gates IS
  'Append-only, immutable record of every gate decision for a partner (docs/specs/W7-curriculum.md). The newest row per (partner, gate) is the standing. A pass is taken back with a new ''revoked'' row, never a DELETE and never an UPDATE.';

-- ---------------------------------------------------------------------------
-- E. Row-level security on the two partner-scoped tables
-- ---------------------------------------------------------------------------
--
-- Through fundhub_apply_partner_rls() (045_creative_factory.sql), which enables
-- AND forces RLS and installs the policy in one call. Guarded on the function's
-- existence so a scratch database built from a partial migration set still
-- applies this file; a table with RLS enabled and no policy denies everything to
-- every ordinary role, which is the incident 109_no_bare_rls.sql documents.
--
-- training_modules and training_gates deliberately get NO policy: they are
-- FundHub's published catalogue, the same as `products`. Enabling RLS on them
-- with nothing attached would hide the curriculum from the app entirely.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'fundhub_apply_partner_rls') THEN
    FOREACH t IN ARRAY ARRAY['partner_training_progress', 'partner_training_gates'] LOOP
      PERFORM fundhub_apply_partner_rls(t);
    END LOOP;
  ELSE
    RAISE NOTICE 'skipped RLS: fundhub_apply_partner_rls() does not exist in this database';
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    FOREACH t IN ARRAY ARRAY['training_modules', 'training_gates',
                             'partner_training_progress', 'partner_training_gates'] LOOP
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fundhub_app', t);
    END LOOP;
  ELSE
    RAISE NOTICE 'skipped grants: role fundhub_app does not exist in this database';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- F. updated_at, in the guarded style of 042
-- ---------------------------------------------------------------------------
--
-- partner_training_gates is absent on purpose: it has no updated_at because it
-- has no UPDATE (see the trigger above).

DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY['training_modules', 'training_gates',
                             'partner_training_progress'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname = 'trg_' || t || '_updated_at'
                        AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- G. The four gates, seeded from W7
-- ---------------------------------------------------------------------------
--
-- Titles and `blocks` are W7's own words, shortened but not reinterpreted. The
-- default org only, matching every other catalogue seed in this repository
-- (181, 271): a second company is not automatically running FundHub's curriculum.

INSERT INTO training_gates (org_id, code, position, title, week_due, blocks)
SELECT o.id, v.code, v.position, v.title, v.week_due, v.blocks
  FROM orgs o
  CROSS JOIN (VALUES
    ('G1', 1, 'Capital and Plan Gate', 1,
     'The partner''s brand is not issued until this gate passes. Exit: a written 90-day budget with a funded lead line, a break-even booked-call count from their own assumptions, and a state operating map naming every state they will sell into.'),
    ('G2', 2, 'Compliance Certification', 3,
     'No public asset goes live until this gate passes. Written exam, must miss zero; the three day-1 disclosure placements verified on the partner''s page; the three locked legal blocks intact; the signed state operating map accepted.'),
    ('G3', 3, 'Call Certification', 4,
     'No live buyer call until this gate passes. A recorded full mock close, scored by a FundHub closer, never-say list clean.'),
    ('G4', 4, 'Supervised Production Release', 5,
     'The partner is not released to sell unsupervised until three clients have paid. FundHub sits on the first live calls or reviews the recordings, and reviews the first ad set before spend.')
  ) AS v(code, position, title, week_due, blocks)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM training_gates g WHERE g.org_id = o.id AND g.code = v.code
   );

-- ---------------------------------------------------------------------------
-- H. The thirteen modules, seeded from W7
-- ---------------------------------------------------------------------------
--
-- TITLES ONLY. W7's thirteen headings, verbatim minus the "(gated)" / "(certified)"
-- suffix, which is data (`certified`) rather than part of the name. Nothing here
-- describes what is taught: see the header.
--
-- `week_no` and `gate_code` come from W7's "THE FIRST 30 DAYS" block and nowhere
-- else. m12 is NULL on both because W7 does not schedule it, and a plausible week
-- would be an invented one.

INSERT INTO training_modules (org_id, code, position, title, week_no, gate_code, certified)
SELECT o.id, v.code, v.position, v.title, v.week_no, v.gate_code, v.certified
  FROM orgs o
  CROSS JOIN (VALUES
    ('m1',   1, 'Your Money Math',                                1,    'G1', false),
    ('m2',   2, 'The Belt: what FundHub does after the sale',     1,    'G1', false),
    ('m3',   3, 'Reading a Credit File (the arithmetic)',         2,    NULL, false),
    ('m4',   4, 'The Three Lanes and the Six Offers',             2,    NULL, false),
    ('m5',   5, 'Why Repair Is Not An Upsell',                    2,    NULL, false),
    ('m7',   6, 'Compliance I: what you may never say',           3,    'G2', true),
    ('m8',   7, 'Compliance II: what you may never do',           3,    'G2', true),
    ('m6',   8, 'The Call',                                       4,    'G3', true),
    ('m9',   9, 'Ads, and where the machine stops',               4,    'G3', false),
    ('m10', 10, 'What you actually get, and what you don''t',     4,    'G3', false),
    ('m11', 11, 'The Stop List',                                  4,    'G3', false),
    -- W7 does not put m12 in a week. NULL is the honest value.
    ('m12', 12, 'Your Numbers and the Floor',                     NULL, NULL, false),
    ('m13', 13, 'First Three (supervised production)',            5,    'G4', false)
  ) AS v(code, position, title, week_no, gate_code, certified)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM training_modules m WHERE m.org_id = o.id AND m.code = v.code
   )
   AND NOT EXISTS (
     SELECT 1 FROM training_modules m WHERE m.org_id = o.id AND m.position = v.position
   );
