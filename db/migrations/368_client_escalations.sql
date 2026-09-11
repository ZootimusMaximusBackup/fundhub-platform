-- 368_client_escalations.sql — a legal threat, remembered forever.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging on a
-- consumer-finance file. NOTHING IN THIS FILE SENDS ANYTHING. It is a table
-- whose only effect is to make the platform say less.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DEFECT THIS CLOSES: A LEGAL THREAT THAT EXPIRED
--
-- src/nudge/exits.mjs decided "has this client threatened us?" by reading their
-- most recent 200 inbound messages and running a regex over them. The row never
-- went anywhere — but the WINDOW moved. The portal chat writes one inbound row
-- per client turn (api/chat/portal-message.mjs:48-52), so an ordinary talkative
-- client pushes a message past position 200 in a week.
--
-- Measured on a scratch database on 2026-09-06: "my lawyer will be in touch",
-- then 210 ordinary inbound rows, then a new overdue checklist item.
-- blockersFor returned [] and deliverNudge queued a text. The permanently
-- stopped client got a message.
--
-- A scan is a detector. It is not a memory. This table is the memory:
--
--   ONE ROW PER CLIENT, WRITTEN THE FIRST TIME THE WORDS ARE SEEN, AND NEVER
--   UPDATED, NEVER DOWNGRADED AND NEVER EXPIRED.
--
-- UNIQUE (client_id) plus ON CONFLICT DO NOTHING at the only writer means the
-- first sighting wins and nothing that happens afterwards — more messages, a
-- longer history, a changed keyword list, a later pass that fails to match —
-- can take it back. There is no DELETE path in src/nudge/ and no state to move
-- it to. Once this row exists, that client's chase ladders are over.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THERE IS NO READ WATERMARK, AND THAT IS DELIBERATE (round three, 2026-09-06)
--
-- An earlier draft of this file also created client_escalation_scans, a table
-- recording how far the detector had already read one client's inbound
-- messages, so a long history was scanned once instead of on every pass. It has
-- been REMOVED, because a mark on a permanent stop is the same defect as the
-- 200-message window wearing a different hat:
--
--   * the mark advanced to max(created_at) over EVERY inbound row, not only the
--     rows the detector examined;
--   * the next pass read with a strict "created_at > mark", so a message whose
--     created_at landed exactly ON the mark was invisible for ever.
--
-- Reproduced on a scratch Postgres 16.14 on 2026-09-06: eleven ordinary messages,
-- a scan, then "my lawyer will be in touch" stamped at the same instant as the
-- newest of them — and blockersFor returned [] and a text was queued.
--
-- Changing ">" to ">=" would close that one shape and leave the rest open: a
-- message imported, backfilled or clock-skewed to a timestamp BEHIND the mark
-- stays invisible, and `messages` has no insertion-ordered column to mark
-- instead — its primary key is a random uuid. So there is no mark. The whole
-- inbound history is read on every pass until the row below exists, and the
-- cost was measured rather than assumed: 3.5 ms at 500 inbound rows, 8.4 ms at
-- 2,000, 39.9 ms at 10,000, and only ever for a client who has NOT threatened
-- us, because the row below short-circuits the scan from the first sighting on.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL MEANS UNKNOWN (CLAUDE.md §12), AND NO ROW HERE IS AN ACCUSATION
--
--   matched_pattern NULL — we recorded the escalation but not which phrase
--     triggered it. Never a guess and never a stand-in.
--   message_id NULL — the message has since been deleted, or the escalation
--     was recorded without one. The escalation still stands; it does not
--     depend on the evidence row surviving.
--
-- THIS TABLE STORES NO CLIENT WORDS. `matched_pattern` is the source text of
-- one of our own regular expressions from src/nudge/exits.mjs, not the client's
-- sentence, and there is no body column. A row here says only "stop chasing
-- this person, a human owns them" — it is not a finding against the client, not
-- a denial of anything, and it must never be rendered to them.
--
--
-- SAFETY. Additive. Creates one table, touches no existing row, drops nothing.
-- Re-running it is a no-op.

CREATE TABLE IF NOT EXISTS public.client_escalations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),

  -- ONE PER CLIENT, FOREVER. The unique constraint is the whole feature: the
  -- first writer wins and every later one is a no-op.
  client_id     uuid NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,

  -- When the client said it — the message's own created_at, not the moment we
  -- noticed. A threat found six months late is still six months old.
  said_at       timestamptz,

  -- When we noticed. Separate from said_at so a long gap between the two is
  -- visible rather than smoothed over.
  seen_at       timestamptz NOT NULL DEFAULT now(),

  -- The inbound row the words were in. SET NULL: losing the evidence row does
  -- not lift the stop.
  message_id    uuid REFERENCES messages(id) ON DELETE SET NULL,

  -- The source of OUR regex that matched. Not the client's sentence.
  matched_pattern text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_escalations_org_idx
  ON public.client_escalations (org_id, seen_at DESC);

COMMENT ON TABLE public.client_escalations IS
  'One row per client who has aimed legal or complaint language at us. Written once, on first sighting, and never removed, downgraded or expired — UNIQUE (client_id) plus ON CONFLICT DO NOTHING at the only writer (src/nudge/exits.mjs). Its only effect is to stop every chase ladder that client has, permanently. It stores no client words and is not a finding against the client.';
COMMENT ON COLUMN public.client_escalations.matched_pattern IS
  'The source text of one of our own ESCALATION_PATTERNS regexes (src/nudge/exits.mjs). NULL = recorded without one. Never the client''s own words.';
COMMENT ON COLUMN public.client_escalations.said_at IS
  'created_at of the inbound message. NULL = unknown. Never a stand-in for seen_at.';

-- ---------------------------------------------------------------------------
-- Row-level security — the same shape 330, 365 and 366 carry
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_escalations FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'client_escalations'
       AND policyname = 'client_escalations_app_all'
  ) THEN
    CREATE POLICY client_escalations_app_all ON public.client_escalations
      USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- INSERT AND SELECT ONLY — AND THE REVOKE IS THE LOAD-BEARING HALF
-- ---------------------------------------------------------------------------
-- THE CLAIM "THE APPLICATION CANNOT DELETE AN ESCALATION" WAS FALSE UNTIL THIS
-- BLOCK EXISTED, AND IT WAS WRITTEN IN FIVE PLACES INCLUDING THE CHANGELOG.
--
-- db/migrations/104_app_role.sql:226 runs
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fundhub_app;
--
-- so EVERY table created after it — this one included — arrives already fully
-- writable by the application. A bare "GRANT SELECT, INSERT" adds nothing it
-- does not already have and removes nothing. Confirmed on a migrated scratch
-- database on 2026-09-06: has_table_privilege('fundhub_app',
-- 'public.client_escalations', 'DELETE') returned true.
--
-- The REVOKE is what makes the sentence true. Same shape the sister lane used
-- in 361 and 363, already proven on this database. UPDATE goes too, because the
-- promise made everywhere else is "written once, never updated, never removed"
-- and a row the application can rewrite is not written once.
--
-- A silent "DELETE 0" is not a refusal. After this runs, a DELETE attempted as
-- fundhub_app raises "permission denied for table client_escalations", which is
-- what src/nudge/escalation-permanence.pg.test.mjs asserts.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON public.client_escalations FROM fundhub_app;
    GRANT SELECT, INSERT ON public.client_escalations TO fundhub_app;
  END IF;
END $$;
