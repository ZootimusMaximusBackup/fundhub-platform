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
-- THE WATERMARK, AND WHY IT IS A SEPARATE TABLE
--
-- Removing the 200-message window means re-reading a client's whole inbound
-- history on every pass, which for a heavy portal user is thousands of rows to
-- prove a negative. client_escalation_scans records how far the detector has
-- already read, so history is read once and each later pass reads only what is
-- new.
--
-- It is a SEPARATE table on purpose. If the watermark lived on
-- client_escalations, then "a row exists" would stop meaning "this client
-- threatened us" and would start meaning "we have looked at this client",
-- which is exactly the kind of overloaded flag that produces a false negative
-- on the one thing that must never have one.
--
-- THE WATERMARK CAN ONLY EVER COST US A LATE STOP, NEVER A MISSED ONE, for two
-- reasons written into src/nudge/exits.mjs:
--   * it advances only to the created_at of a row the detector actually read,
--     and the scan reads OLDEST FIRST, so nothing between the old mark and the
--     new one is skipped;
--   * it is written only after the scan completes, and a scan that throws
--     leaves the mark where it was and returns ["check_failed"], which blocks.
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
--   scanned_through NULL — nothing has been read for this client yet. Not
--     "read up to the epoch".
--
-- THIS TABLE STORES NO CLIENT WORDS. `matched_pattern` is the source text of
-- one of our own regular expressions from src/nudge/exits.mjs, not the client's
-- sentence, and there is no body column. A row here says only "stop chasing
-- this person, a human owns them" — it is not a finding against the client, not
-- a denial of anything, and it must never be rendered to them.
--
--
-- SAFETY. Additive. Creates two tables, touches no existing row, drops nothing.
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
-- How far the detector has already read, per client
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_escalation_scans (
  client_id        uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  org_id           uuid NOT NULL REFERENCES orgs(id),

  -- The created_at of the newest inbound message the detector has read.
  -- NULL = nothing read yet.
  scanned_through  timestamptz,

  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.client_escalation_scans IS
  'A read watermark, not a decision. Says how far src/nudge/exits.mjs has already read one client''s inbound messages so history is scanned once instead of every pass. Advances only over rows actually read, oldest first, and only after a scan completes — so it can delay a stop but cannot cause a missed one. Deleting a row here is safe: the next pass re-reads that client from the beginning.';

-- ---------------------------------------------------------------------------
-- updated_at, guarded the same way 330 and 365 guard it
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS trg_client_escalation_scans_updated ON public.client_escalation_scans;
    CREATE TRIGGER trg_client_escalation_scans_updated
      BEFORE UPDATE ON public.client_escalation_scans
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security — the same shape 330, 365 and 366 carry
-- ---------------------------------------------------------------------------
ALTER TABLE public.client_escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_escalations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_escalation_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_escalation_scans FORCE ROW LEVEL SECURITY;

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
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'client_escalation_scans'
       AND policyname = 'client_escalation_scans_app_all'
  ) THEN
    CREATE POLICY client_escalation_scans_app_all ON public.client_escalation_scans
      USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    -- No DELETE on client_escalations. There is no code path that lifts an
    -- escalation and there should not be one; a stop that the application can
    -- revoke is not a permanent stop.
    GRANT SELECT, INSERT ON public.client_escalations TO fundhub_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_escalation_scans TO fundhub_app;
  END IF;
END $$;
