-- 298_zoho_recruit.sql — Zoho Recruit is the front door. This is the wiring.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS
--
-- Owner-set 2026-09-05, recorded in docs/workflows/hiring-ats-decision-2026-09-05.md:
--
--   "Zoho is fine. LinkedIn API is only for large recruiting pipelines, which we
--    aren't. We leverage someone else's pipeline."
--
-- LinkedIn's Job Posting API is closed to new partners. Zoho Recruit is already an
-- approved LinkedIn source, so it can do the one thing our own code cannot: put a
-- job on LinkedIn. We rent that access. Applicants land in Zoho; FundHub owns
-- everything after that.
--
-- So the shape is:
--
--     hiring_roles (ours)  ──postJob──►  Zoho Job_Openings  ──syndicates──►  LinkedIn
--                                              │
--                                              │ people apply THERE
--                                              ▼
--     candidates + candidate_applications (ours)  ◄──syncCandidates── poll every 15 min
--
-- Our code never talks to LinkedIn. It talks to Zoho, and Zoho talks to LinkedIn.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THIS FEEDS AN AUTOMATED EMPLOYMENT DECISION TOOL. 051's INVARIANT STILL HOLDS.
--
--   NO CANDIDATE IS EVER REJECTED BY SOFTWARE.
--
-- Nothing here scores, ranks, filters or declines anybody. There is deliberately
-- no "quality" column, no Zoho rating carried across, and no place to put one.
-- Zoho's own `Candidate_Status` is NOT imported: it is Zoho's pipeline state, and
-- letting a third party's status drive ours would be an outside system moving a
-- candidate through our stages without a human ever looking.
--
-- Protected characteristics are dropped at the connector (src/hiring/zoho.mjs,
-- mirroring the deny-list in src/hiring/grading.mjs) and dropped AGAIN by apply().
-- The count of dropped fields is stored on the link row below so that the
-- stripping is visible in the data rather than only in a log line nobody reads.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY NO NEW CONNECTION TABLE AND NO NEW POSTING TABLE
--
-- 051_hiring.sql already has both, and they fit:
--
--   hiring_channel_connections — org, channel, external_account_id, encrypted
--     access + refresh token, expiry, scopes, state. That is exactly an OAuth
--     connection, which is exactly what Zoho needs. Its channel CHECK is widened
--     below rather than a second table being grown beside it.
--
--   hiring_job_postings — org, role, channel, external_id, title, description,
--     status, posted_at, closed_at, last_error, last_synced_at. That is exactly a
--     job requisition pushed to an outside board.
--
-- Two tables doing the same job is a bug that takes months to surface, so this
-- migration is almost entirely ALTERs. The one genuinely new table is the id map,
-- because nothing in 051 can answer "have we already ingested Zoho candidate
-- 4150868000000420069?" and that question is the whole ball game — see part 4.

-- ---------------------------------------------------------------------------
-- 1. 'zoho' becomes a channel
-- ---------------------------------------------------------------------------
-- 051:641 allows ('linkedin', 'facebook', 'job_board') on connections and
-- 051:606 allows ('linkedin', 'facebook', 'job_board', 'internal') on postings.
--
-- Zoho is NOT filed under 'job_board'. A job board is a place we post to; Zoho is
-- the system that does the posting on our behalf and receives the applicants. The
-- distinction matters for the funnel view in 051, which is measured BY channel: a
-- Zoho-sourced applicant that reads as 'job_board' makes the LinkedIn bridge
-- invisible in exactly the report built to show where hires come from.
--
-- Constraint drop-and-recreate rather than ADD, because CHECK constraints cannot
-- be widened in place. Guarded on the constraint name so a re-run is a no-op.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hiring_channel_connections_channel_ck'
       AND conrelid = 'public.hiring_channel_connections'::regclass
  ) THEN
    ALTER TABLE hiring_channel_connections
      DROP CONSTRAINT hiring_channel_connections_channel_ck;
  END IF;

  ALTER TABLE hiring_channel_connections
    ADD CONSTRAINT hiring_channel_connections_channel_ck
    CHECK (channel IN ('linkedin', 'facebook', 'job_board', 'zoho'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'hiring_job_postings_channel_ck'
       AND conrelid = 'public.hiring_job_postings'::regclass
  ) THEN
    ALTER TABLE hiring_job_postings
      DROP CONSTRAINT hiring_job_postings_channel_ck;
  END IF;

  ALTER TABLE hiring_job_postings
    ADD CONSTRAINT hiring_job_postings_channel_ck
    CHECK (channel IN ('linkedin', 'facebook', 'job_board', 'internal', 'zoho'));
END $$;

-- 051:198 constrains candidates.source. A Zoho applicant is genuinely sourced
-- from Zoho, and 'linkedin' would be a lie for anyone who found the job on Zoho's
-- own careers page or one of the other boards Zoho syndicates to. First-touch
-- attribution is the reason the column is constrained at all (051:180), so it
-- gets its own value rather than being squeezed into an existing one.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'candidates_source_ck'
       AND conrelid = 'public.candidates'::regclass
  ) THEN
    ALTER TABLE candidates DROP CONSTRAINT candidates_source_ck;
  END IF;

  ALTER TABLE candidates
    ADD CONSTRAINT candidates_source_ck
    CHECK (source IN ('referral', 'client_base', 'audience', 'social', 'job_board',
                      'ads', 'linkedin', 'recruiter', 'inbound', 'zoho'));
END $$;

-- ---------------------------------------------------------------------------
-- 2. What the connection has to remember
-- ---------------------------------------------------------------------------

-- THE DATA CENTRE. Getting this wrong is a SILENT authentication failure, which
-- is why it is a stored column and not a constant in the code.
--
-- Zoho runs the same product in several regions and a token issued in one region
-- is meaningless in another: https://www.zoho.com/recruit/developer-guide/apiv2/multi-dc.html
-- (fetched 2026-09-05). US is https://www.zohoapis.com, EU https://www.zohoapis.eu,
-- CN https://www.zohoapis.com.cn, with AU/IN/JP on their own hosts. The OAuth
-- token response tells you which one the account lives in — that value is what
-- belongs here, copied verbatim rather than guessed from the user's country.
--
-- Null means "not told yet", and the code falls back to the US host. That fallback
-- is the documented default, not an assumption about this account.
ALTER TABLE hiring_channel_connections
  ADD COLUMN IF NOT EXISTS api_domain text;

COMMENT ON COLUMN hiring_channel_connections.api_domain IS
  'Base API host for this connection, e.g. https://www.zohoapis.com. Copied verbatim from the OAuth token response api_domain field. Wrong value = silent auth failure, so it is stored, never inferred.';

-- THE SYNC CURSOR. How far through Zoho we have read, ALWAYS IN UTC.
--
-- timestamptz stores an absolute instant, so this cannot carry a local time by
-- accident — which is the point. FundHub runs on Arizona time (America/Phoenix,
-- no daylight saving; see docs/workflows/arizona-time-2026-08-28.md), and Zoho's
-- own examples are written with an explicit offset like -07:00. A cursor written
-- in the wrong offset does not error. It quietly skips or re-reads hours of
-- applicants, and "a quiet day" is indistinguishable from "we lost seven people".
ALTER TABLE hiring_channel_connections
  ADD COLUMN IF NOT EXISTS sync_cursor timestamptz;

ALTER TABLE hiring_channel_connections
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

COMMENT ON COLUMN hiring_channel_connections.sync_cursor IS
  'High-water mark for the applicant poll, in UTC. The poller deliberately re-reads a few minutes BEFORE this instant on every run and relies on the id map for de-duplication: duplicates are free, gaps are invisible.';

-- HOW MANY JOBS MAY BE LIVE AT ONCE. This is a PLAN limit, not a law of nature.
--
-- Zoho Recruit's free tier allows ONE active job opening at a time. We have four
-- open reqs after 294 (closer, setter, sales_coordinator, csm), so posting is a
-- QUEUE, not a fan-out — see part 5.
--
-- It is a column with a default rather than a constant in the code for one
-- reason: the day the owner buys a paid plan, the fix should be one UPDATE, not a
-- migration and a deploy. Nobody should ever have to discover that "1" was
-- hard-coded somewhere as if it were a Zoho-wide rule.
ALTER TABLE hiring_channel_connections
  ADD COLUMN IF NOT EXISTS max_active_postings integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'hiring_channel_connections_max_active_ck'
  ) THEN
    ALTER TABLE hiring_channel_connections
      ADD CONSTRAINT hiring_channel_connections_max_active_ck
      CHECK (max_active_postings >= 1);
  END IF;
END $$;

COMMENT ON COLUMN hiring_channel_connections.max_active_postings IS
  'How many postings may be live on this channel at once. Default 1 because that is the ZOHO RECRUIT FREE TIER limit as of 2026-09-05 — it is a plan limit, not a Zoho-wide rule. Raise it with an UPDATE when the plan is upgraded.';

-- ---------------------------------------------------------------------------
-- 3. Which of our reqs a Zoho job opening is
-- ---------------------------------------------------------------------------
-- hiring_job_postings.external_id already holds Zoho's Job_Openings record id and
-- 051:612 already makes (org, channel, external_id) unique, so re-posting cannot
-- produce two rows pointing at one Zoho job. Nothing new is needed for the push.
--
-- What IS missing is the queue position. 'draft' in 051's status CHECK is reused
-- as "queued": a posting we intend to publish and have not, because the slot is
-- taken. A separate 'queued' value would have meant widening another CHECK to
-- describe a state 'draft' already describes correctly.
COMMENT ON COLUMN hiring_job_postings.status IS
  'draft = written, not live (on the zoho channel this also means QUEUED behind the active job); posted = live; paused; closed; failed. Terminal states are set by code, never by an outside system.';

-- ---------------------------------------------------------------------------
-- 4. THE ID MAP — the whole ball game
-- ---------------------------------------------------------------------------
-- We poll Zoho on a timer with a deliberate overlap window, which means we WILL
-- see the same candidate more than once. That is by design: a cursor tight enough
-- to never re-read is a cursor loose enough to skip somebody when two clocks
-- disagree by a second. So the design accepts duplicates at the wire and refuses
-- them here.
--
-- apply() (src/hiring/pipeline.mjs:66) already de-duplicates on
-- external_application_id, and that stays the enforcing guard — it is a UNIQUE
-- index, not a lookup. This table exists for the three things that index cannot
-- do:
--
--   1. RECORD THE ONES WE COULD NOT INGEST. A Zoho record with no email or no
--      name cannot become a candidate. Dropping it silently makes a mapping bug
--      look exactly like "nobody applied" — the single most expensive failure
--      this connector can have, because it is invisible for weeks. Those get a
--      row here with status 'skipped' and a reason.
--
--   2. MAKE THE STRIPPING VISIBLE. protected_fields_dropped counts the fields
--      that were refused on the way in. Zero is the expected value; a number that
--      starts climbing means Zoho's form is collecting something it should not,
--      and that is worth seeing without reading logs.
--
--   3. ANSWER "HOW FAR HAVE WE GOT". last_seen_at and zoho_modified_time make a
--      stalled poll obvious.
--
-- NOTHING HERE DECIDES ANYTHING. It is a record of what was copied.

CREATE TABLE IF NOT EXISTS hiring_zoho_candidate_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- Zoho's own record id, as a string. It is a long numeric like
  -- '4150868000000420069' and it is NOT a number: leading zeros and length are
  -- both Zoho's business, and parsing it as bigint is how ids get mangled.
  zoho_candidate_id text NOT NULL,

  -- Which of our reqs this application is against. Part of the key because one
  -- person may legitimately apply for two roles, and 051's own header says so
  -- ("a candidate declined for closer today may be the right setter next
  -- quarter"). Keying on the Zoho id alone would silently merge the two.
  role_id       uuid NOT NULL REFERENCES hiring_roles(id) ON DELETE CASCADE,

  -- Where it landed. Null on a skipped row — that is the point of the row.
  candidate_id   uuid REFERENCES candidates(id) ON DELETE SET NULL,
  application_id uuid REFERENCES candidate_applications(id) ON DELETE SET NULL,

  -- The key handed to apply(). Stored so the two sides of the de-duplication can
  -- be compared without re-deriving the string and hoping the rule has not moved.
  external_application_id text,

  status        text NOT NULL DEFAULT 'linked',
  skip_reason   text,

  protected_fields_dropped integer NOT NULL DEFAULT 0,

  -- Zoho's Modified_Time for the record as last seen. Not used as the cursor —
  -- the cursor is ours — but it is how you tell a stale copy from a fresh one.
  zoho_modified_time timestamptz,

  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT hiring_zoho_links_id_ck CHECK (btrim(zoho_candidate_id) <> ''),
  CONSTRAINT hiring_zoho_links_status_ck CHECK (status IN ('linked', 'skipped')),

  -- A skipped row must say why, and a linked row must have landed somewhere.
  -- Without this pair a row can claim success while pointing at nothing, which is
  -- the failure mode the table was built to expose.
  CONSTRAINT hiring_zoho_links_skip_ck CHECK (
    (status = 'skipped' AND skip_reason IS NOT NULL) OR
    (status = 'linked'  AND application_id IS NOT NULL)
  ),
  CONSTRAINT hiring_zoho_links_dropped_ck CHECK (protected_fields_dropped >= 0)
);

-- THE IDEMPOTENCY GUARD. One Zoho candidate, one req, one row — enforced by the
-- database so a redelivered page or a re-run cannot produce a second.
CREATE UNIQUE INDEX IF NOT EXISTS hiring_zoho_links_uniq
  ON hiring_zoho_candidate_links (org_id, zoho_candidate_id, role_id);

CREATE INDEX IF NOT EXISTS hiring_zoho_links_recent_idx
  ON hiring_zoho_candidate_links (org_id, last_seen_at DESC);

-- The ones that need a human to look at them.
CREATE INDEX IF NOT EXISTS hiring_zoho_links_skipped_idx
  ON hiring_zoho_candidate_links (org_id, last_seen_at DESC) WHERE status = 'skipped';

COMMENT ON TABLE hiring_zoho_candidate_links IS
  'Map from a Zoho Recruit candidate id to our candidate/application, plus the ones we could NOT ingest and why. Makes a dropped applicant visible instead of looking like a quiet day.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_hiring_zoho_candidate_links_updated_at'
          AND tgrelid = 'public.hiring_zoho_candidate_links'::regclass
     ) THEN
    CREATE TRIGGER trg_hiring_zoho_candidate_links_updated_at
      BEFORE UPDATE ON hiring_zoho_candidate_links
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. The posting queue, as something a human can read
-- ---------------------------------------------------------------------------
-- One live job, several reqs waiting. The screen question is "which one is up,
-- and who is behind it", and that should not require anybody to reason about a
-- CHECK constraint.
--
-- WHAT THIS VIEW DOES NOT DO: promote anything. Which queued req goes live when
-- the current one closes is the OWNER'S call — somebody may be mid-hire on the
-- live one, and a rule that automatically swapped it out would pull a live advert
-- out from under a candidate who is halfway through applying. The view reports;
-- an explicit call posts.

CREATE OR REPLACE VIEW v_zoho_posting_queue AS
SELECT p.org_id,
       p.id            AS posting_id,
       r.key           AS role_key,
       r.name          AS role_name,
       r.owner_role,
       p.status,
       CASE p.status
         WHEN 'posted' THEN 'live on Zoho'
         WHEN 'draft'  THEN 'waiting for the slot'
         WHEN 'failed' THEN 'last attempt failed'
         ELSE p.status
       END             AS plain_status,
       p.external_id   AS zoho_job_id,
       p.posted_at,
       p.closed_at,
       p.last_error,
       p.last_synced_at,
       (r.role_brief IS NULL OR btrim(r.role_brief) = '') AS blocked_on_missing_brief
  FROM hiring_job_postings p
  JOIN hiring_roles r ON r.id = p.role_id
 WHERE p.channel = 'zoho'
   AND p.status <> 'closed';

COMMENT ON VIEW v_zoho_posting_queue IS
  'Zoho postings that are live or waiting. blocked_on_missing_brief means the req has no written description, and the connector refuses to post rather than invent one.';

-- ---------------------------------------------------------------------------
-- 6. The health view learns about the connector
-- ---------------------------------------------------------------------------
-- Deliberately NOT extending v_hiring_config_gaps: that view's column shape is
-- fixed by 052 and re-stated in full by 294, and a fifth arm here would mean
-- reproducing all four of theirs again in a file that owns none of them. A
-- separate view is honest about ownership and cannot break theirs.

CREATE OR REPLACE VIEW v_zoho_connector_health AS
SELECT o.id AS org_id,
       c.connection_state,
       c.api_domain,
       c.sync_cursor,
       c.last_synced_at,
       c.max_active_postings,
       c.last_error,
       (SELECT count(*) FROM hiring_job_postings p
         WHERE p.org_id = o.id AND p.channel = 'zoho' AND p.status = 'posted')::int
         AS live_postings,
       (SELECT count(*) FROM hiring_job_postings p
         WHERE p.org_id = o.id AND p.channel = 'zoho' AND p.status = 'draft')::int
         AS queued_postings,
       (SELECT count(*) FROM hiring_zoho_candidate_links l
         WHERE l.org_id = o.id AND l.status = 'skipped')::int
         AS skipped_candidates,
       (SELECT coalesce(sum(l.protected_fields_dropped), 0) FROM hiring_zoho_candidate_links l
         WHERE l.org_id = o.id)::int
         AS protected_fields_dropped
  FROM orgs o
  LEFT JOIN hiring_channel_connections c
         ON c.org_id = o.id AND c.channel = 'zoho';

COMMENT ON VIEW v_zoho_connector_health IS
  'One row per org: is Zoho connected, how far has the poll read, how many jobs are live vs queued, how many applicants we could not ingest, and how many protected fields were refused on the way in.';

-- ---------------------------------------------------------------------------
-- 7. No connection row is seeded
-- ---------------------------------------------------------------------------
-- On purpose, and for the same reason 294 does not seed a role_brief. A
-- connection row carries OAuth tokens; a seeded one would either be empty (and
-- then 'pending' with no tokens, which is what the absence of a row already says)
-- or invented. The row is written by the OAuth callback when a human connects the
-- account, and until then v_zoho_connector_health reports connection_state null,
-- which is the true answer.
