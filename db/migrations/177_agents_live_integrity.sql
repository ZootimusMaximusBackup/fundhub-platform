-- 177_agents_live_integrity.sql — stop the Agent Editor claiming two robots are
-- working when neither can speak, and give the registry somewhere to record
-- what wakes an agent and what it did.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT IS WRONG, MEASURED ON LIVE 2026-08-19 (evidence:
-- docs/workflows/fix-2026-08-18/evidence/T13/before/db-agents.json)
--
--   AG-04 Setter Josh        status=live  channel=voice  runtime=bland
--   AG-09 Inquiry Removal AI status=live  channel=voice  runtime=bland
--
-- Both have prompt IS NULL, guardrails = '{}', trigger_events = '[]', and
-- updated_at = created_at = 2026-07-31 — never touched since the seed. The
-- screen paints them "LIVE · acting on real clients on Voice" while the
-- promotion checklist on the SAME card reads "Promotion is blocked until every
-- check passes" against 0 chars of prompt, 0 chars of guardrail, 0 triggers and
-- no escalation path.
--
-- Neither has ever acted. outbound_calls: 0 rows. agent_shadow_log: 0 rows.
-- messages with sender_kind='agent': 0. webhook_captures for provider 'bland': 0.
-- And nothing in this repository has ever POSTed to api.bland.ai, so there is no
-- path by which they could have.
--
-- HOW THEY GOT THERE. 037_agent_registry.sql:105-124 INSERTs them directly with
-- status='live'. The INSERT column list does not include prompt or guardrails,
-- so prompt landed NULL and guardrails landed the '{}' default. The promotion
-- gate in api/agents.mjs:260-271 — which refuses exactly this shape with 409
-- promotion_blocked — was never on the path a seed takes. The only schema guard
-- 037 carries is agents_runtime_required_ck, which checks runtime and says
-- nothing about prompt.
--
-- 037 IS NOT EDITED. db/migrate.mjs keys schema_migrations by '<dir>/<file>' and
-- skips anything already applied, so an edit to 037 is a silent no-op. This file
-- supersedes it.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DOES
--
--   1. Corrects the two rows to 'draft' — the honest status for an agent with
--      no deployment behind it.
--   2. Adds the invariant 037 was missing: live implies a written prompt.
--   3. Creates agent_triggers and agent_runs, the two tables the screen's
--      "0 triggers" and "0 runs" counters have never had a source for.
--
-- Both new tables declare their RLS shape explicitly (ENABLE, FORCE, named
-- permissive policy), following 203_bookings_rls_policy.sql. A table with RLS on
-- and zero policies is invisible to fundhub_app and fails
-- src/security/rls-shape.test.mjs.


-- ── 1. AG-04 / AG-09 are not live ──────────────────────────────────────────
--
-- WHY 'draft' AND NOT 'shadow'. Shadow means "runs on every trigger and logs
-- what it would have sent" — the screen says so in those words. These two do not
-- run. There is no dialer in this build and no host to proxy to
-- (vendor/inquiry-remover/README.md: "not deployed. On hold. There is no Vercel
-- app."). Calling them shadow would be a second, quieter version of the same
-- lie. Draft means defined but not deployed, which is exactly true.
--
-- runtime, runtime_ref and runtime_notes are KEPT. They record the intent —
-- these are meant to run on Bland — and api/agents.mjs needs runtime present to
-- promote without inventing one. went_live_at is cleared because they never did.
--
-- Scoped to the exact shape being corrected: still empty, still never edited.
-- An agent somebody has since written a real prompt for is left alone.
UPDATE agents
   SET status        = 'draft',
       went_live_at  = NULL,
       runtime_notes = COALESCE(runtime_notes || ' · ', '') ||
         'Corrected to draft by migration 177 on 2026-08-19: seeded live by 037 with no prompt, ' ||
         'no guardrails and no trigger, and with no dialer in this build it had never placed a call. ' ||
         'Promote it from the Agent Editor once a prompt and guardrails are written.',
       updated_at    = now()
 WHERE code IN ('AG-04', 'AG-09')
   AND status = 'live'
   AND (prompt IS NULL OR btrim(prompt) = '')
   AND guardrails = '{}'::jsonb;


-- ── 2. The invariant 037 never had ─────────────────────────────────────────
--
-- NOT VALID: new and updated rows are checked, existing rows are not re-scanned.
-- After step 1 there is nothing left to violate it, but NOT VALID keeps this
-- migration incapable of failing on a database whose history differs from ours —
-- and the constraint still does its real job, which is refusing the NEXT seed
-- that tries to insert a live agent with nothing to say.
--
-- Deliberately narrower than the application gate. api/agents.mjs requires 60+
-- characters of prompt AND a non-empty guardrail block to promote. This checks
-- only that a live agent has SOME prompt. A database constraint that duplicated
-- the full policy would have to be rewritten in lockstep every time the policy
-- moved; this one states the part that is structural.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.agents'::regclass
       AND conname  = 'agents_live_needs_prompt_ck'
  ) THEN
    ALTER TABLE public.agents
      ADD CONSTRAINT agents_live_needs_prompt_ck
      CHECK (status <> 'live' OR (prompt IS NOT NULL AND btrim(prompt) <> ''))
      NOT VALID;
    RAISE NOTICE '177: agents_live_needs_prompt_ck added';
  ELSE
    RAISE NOTICE '177: agents_live_needs_prompt_ck already present';
  END IF;
END $$;


-- ── 3. agent_triggers — one home for "what wakes this agent" ───────────────
--
-- THERE ARE TWO STORES TODAY AND NEITHER IS AUTHORITATIVE.
--   guardrails->'triggers' — what public/app/agent-editor.html writes and what
--     its "N trig" badge counts. Empty for all 14 AG-*/OP-* rows.
--   agents.trigger_events — added by 114_ghl_agent_seed.sql, holds real data for
--     the 8 retired GHL rows, and is neither SELECTed by api/read/agents.mjs nor
--     written by api/agents.mjs. Invisible to every screen.
--
-- This table becomes the one store, backfilled from both. It is a record, not a
-- switch: src/agents/guardrails.mjs still says triggers are "not enforced here"
-- and this migration does not change that. Making a trigger actually gate a
-- reply is a behaviour change no intended journey describes, and it is not in
-- this thread's scope.
CREATE TABLE IF NOT EXISTS public.agent_triggers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_code  text NOT NULL,
  event_name  text NOT NULL,
  source      text NOT NULL DEFAULT 'editor',
  enabled     boolean NOT NULL DEFAULT true,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_triggers_source_ck
    CHECK (source IN ('editor', 'seed', 'ghl_import'))
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_triggers_uq
  ON public.agent_triggers (org_id, agent_code, event_name);

CREATE INDEX IF NOT EXISTS agent_triggers_agent_idx
  ON public.agent_triggers (org_id, agent_code);

COMMENT ON TABLE public.agent_triggers IS
  'Bus events that are meant to wake an agent. One row per agent per event. Recorded, not yet enforced — src/agents/runtime.mjs subscribes to message.inbound directly.';


-- ── 4. agent_runs — one home for "what this agent did" ─────────────────────
--
-- The screen's run counter has never had a source. public/app/agent-editor.html
-- sets runsTracked:false and prints "0 runs" with a comment saying not to invent
-- one. This is the source. src/agents/runtime.mjs writes a row on every run,
-- including the runs that did nothing, because "the robot woke and decided not
-- to answer" is the single most useful thing an operator can read here and it is
-- currently recorded nowhere.
--
-- outcome is deliberately open text rather than an enum: it carries the reason
-- string src/agents/select.mjs already returns (no_client, unsupported_channel,
-- no_eligible_agent, halted, sole_channel_match …) and pinning that set here
-- would mean a migration every time the runtime learns a new reason.
CREATE TABLE IF NOT EXISTS public.agent_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_code      text,
  client_id       uuid REFERENCES clients(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL,
  trigger_event   text NOT NULL,
  event_id        uuid,
  channel         text,
  mode            text,
  outcome         text NOT NULL,
  detail          text,
  sent_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_runs_mode_ck
    CHECK (mode IS NULL OR mode IN ('live', 'shadow', 'draft', 'retired'))
);

CREATE INDEX IF NOT EXISTS agent_runs_org_agent_idx
  ON public.agent_runs (org_id, agent_code, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_client_idx
  ON public.agent_runs (client_id, created_at DESC)
  WHERE client_id IS NOT NULL;

-- One run per agent per event. The bus can redeliver; a redelivery must not
-- inflate a counter an operator reads as "how busy is this robot".
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_event_uq
  ON public.agent_runs (org_id, event_id, COALESCE(agent_code, ''))
  WHERE event_id IS NOT NULL;

COMMENT ON TABLE public.agent_runs IS
  'One row every time the agent runtime woke, including runs that sent nothing. Feeds the run counter on the Agent Editor. agent_code is NULL when no agent was eligible.';


-- ── 5. RLS, declared for both ──────────────────────────────────────────────
--
-- Permissive — USING (true) WITH CHECK (true) — matching the other 147 tables in
-- this database. It restores access; it does not isolate one org's rows from
-- another's. Tightening that across the board is T16-05 and an owner decision,
-- deliberately not bundled here.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agent_triggers', 'agent_runs'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'public' AND tablename = t
         AND policyname = t || '_app_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I USING (true) WITH CHECK (true)',
        t || '_app_all', t
      );
      RAISE NOTICE '177: % declared and unlocked', t;
    END IF;
  END LOOP;
END $$;


-- ── 6. Backfill agent_triggers from the two legacy stores ──────────────────
--
-- guardrails->'triggers' first (what the editor writes), then trigger_events
-- (what 114 seeded). ON CONFLICT DO NOTHING so the editor's copy wins where both
-- hold the same event name, and so re-running is a no-op.
INSERT INTO agent_triggers (org_id, agent_code, event_name, source, note)
SELECT a.org_id, a.code, btrim(t.value), 'editor', NULL
  FROM agents a
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(a.guardrails -> 'triggers') = 'array'
         THEN a.guardrails -> 'triggers' ELSE '[]'::jsonb END) AS t(value)
 WHERE btrim(t.value) <> ''
ON CONFLICT (org_id, agent_code, event_name) DO NOTHING;

INSERT INTO agent_triggers (org_id, agent_code, event_name, source, note)
SELECT a.org_id, a.code, btrim(t.value), 'ghl_import',
       'Imported from agents.trigger_events by migration 177. GoHighLevel was cancelled 2026-08-15; kept as inventory.'
  FROM agents a
  CROSS JOIN LATERAL jsonb_array_elements_text(
    CASE WHEN jsonb_typeof(a.trigger_events) = 'array'
         THEN a.trigger_events ELSE '[]'::jsonb END) AS t(value)
 WHERE btrim(t.value) <> ''
ON CONFLICT (org_id, agent_code, event_name) DO NOTHING;
