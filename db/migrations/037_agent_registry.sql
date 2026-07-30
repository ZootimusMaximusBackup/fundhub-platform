-- 037_agent_registry.sql — the AI agents, as records rather than as markup.
--
-- THE GAP. public/app/agent-editor.html holds fourteen agents in a JavaScript
-- array. Two of them are running in production right now — Setter Josh on Bland
-- AI and the Inquiry Removal AI, both out of the inquiry-removal-ai repo on
-- Vercel — and there is nowhere in this database that says so. Nothing can answer
-- "which agents are live", "what is this one allowed to do", or "who owns it",
-- which means nothing can gate on those answers either.
--
-- STATUS is the field that matters, and it is deliberately four values:
--   draft   — exists as a definition, not running
--   shadow  — running and logging, NOT sending. The safe rehearsal state.
--   live    — acting on real clients
--   retired — was live, no longer is. Kept, never deleted.
-- shadow is separate from live rather than a boolean flag because the difference
-- is the entire safety story for an agent that talks to clients.
--
-- WHAT IS SEEDED, AND WHAT IS NOT. The fourteen identities — code, name, class,
-- channel — are sourced from the shipped screen, so they are seeded. Two agents
-- seed as status='live' per instruction, with their real runtime recorded.
-- Everything else seeds as 'draft', regardless of what the screen's sample data
-- says: the screen marks eleven as mode:'live', which is mockup state, and
-- treating it as truth would claim eleven production agents that do not exist.
--
-- NOT SEEDED, deliberately:
--   prompt and guardrails stay NULL. The screen carries prompt and guard text for
--     fifteen entries, but per fundhub-docs FIELD-NOTES only Setter Josh's is the
--     real live agent's — the rest is sample copy. Loading sample prompts into a
--     registry that gates production behaviour would be worse than leaving them
--     empty, so they are left empty and reported.
--   runs and breaches have no columns here. Those numbers on the screen
--     (8,940 runs, 20,160 runs) are invented sample data. Real counters belong in
--     an agent_runs table fed by actual execution, not backfilled from a mockup.
--   owner_staff_id is left NULL rather than resolved from the screen's owner
--     names: those are display strings, and matching them to staff rows by name
--     would guess at an assignment nobody recorded.

CREATE TABLE IF NOT EXISTS agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),

  code           text NOT NULL,          -- AG-04, OP-01 — the id the screen uses
  name           text NOT NULL,
  agent_class    text NOT NULL DEFAULT 'client_facing',
  channel        text,                   -- sms | email | voice | internal

  status         text NOT NULL DEFAULT 'draft',

  -- Where it actually runs. Null runtime with status='live' is a contradiction
  -- the CHECK below refuses: a live agent nobody can point at is unoperable.
  runtime        text,                   -- bland | vercel | inngest | netlify | internal
  runtime_ref    text,                   -- repo, function name, or vendor agent id
  runtime_notes  text,

  prompt         text,
  guardrails     jsonb NOT NULL DEFAULT '{}'::jsonb,

  owner_staff_id uuid REFERENCES staff(id) ON DELETE SET NULL,
  owner_label    text,                   -- the screen's display string, unresolved

  went_live_at   timestamptz,
  retired_at     timestamptz,
  sort_order     integer NOT NULL DEFAULT 100,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT agents_status_ck  CHECK (status IN ('draft', 'shadow', 'live', 'retired')),
  CONSTRAINT agents_class_ck   CHECK (agent_class IN ('client_facing', 'ops')),
  CONSTRAINT agents_channel_ck CHECK (channel IS NULL OR channel IN ('sms','email','voice','internal')),
  CONSTRAINT agents_code_ck    CHECK (code = upper(btrim(code))),
  -- A live or shadow agent is executing somewhere. Say where.
  CONSTRAINT agents_runtime_required_ck
    CHECK (status NOT IN ('live', 'shadow') OR runtime IS NOT NULL),
  CONSTRAINT agents_retired_ck
    CHECK ((status = 'retired') = (retired_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_code ON agents (org_id, code);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents (org_id, status, sort_order);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_agents_updated_at'
                    AND tgrelid = 'public.agents'::regclass) THEN
      CREATE TRIGGER trg_agents_updated_at BEFORE UPDATE ON agents
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;

-- v_agents_live — the one question an ops screen leads with, resolved once.
CREATE OR REPLACE VIEW v_agents_live AS
SELECT org_id, code, name, agent_class, channel, status, runtime, runtime_ref,
       went_live_at,
       (prompt IS NULL OR btrim(prompt) = '') AS prompt_missing,
       (guardrails = '{}'::jsonb)             AS guardrails_missing
  FROM agents
 WHERE status IN ('live', 'shadow');

-- The fourteen agents the shipped screen defines. Identity only; see the header
-- for what is deliberately left empty. NOT EXISTS-guarded so re-running is a
-- no-op, in the style of 020_auth.sql's role seed.
INSERT INTO agents (org_id, code, name, agent_class, channel, status,
                    runtime, runtime_ref, runtime_notes, owner_label,
                    went_live_at, sort_order)
SELECT o.id, v.code, v.name, v.agent_class, v.channel, v.status,
       v.runtime, v.runtime_ref, v.runtime_notes, v.owner_label,
       CASE WHEN v.status = 'live' THEN now() ELSE NULL END,
       v.sort_order
  FROM orgs o
  CROSS JOIN (VALUES
    -- LIVE IN PRODUCTION. Both run out of the inquiry-removal-ai repo, deployed
    -- on Vercel; Setter Josh places outbound calls through Bland AI. These are
    -- not drafts and must not be seeded as such.
    ('AG-04', 'Setter Josh',            'client_facing', 'voice',    'live',
     'bland',  'inquiry-removal-ai',
     'Live outbound setter on Bland AI, deployed from the inquiry-removal-ai repo on Vercel. Prompt and guardrails are the live agent''s — load them here rather than editing the screen.',
     'Sarah Whitfield', 10),
    ('AG-09', 'Inquiry Removal AI',     'client_facing', 'voice',    'live',
     'bland',  'inquiry-removal-ai',
     'Live inquiry-removal caller on Bland AI, deployed from the inquiry-removal-ai repo on Vercel. Case state lives in that project''s Airtable base, surfaced by /api/inquiry.',
     'Alvin Torres',   20),

    -- Everything below is a definition, not a deployment. The screen shows most
    -- of these as mode:'live'; that is sample data.
    ('AG-01', 'Agent 1 Lead Follow-up', 'client_facing', 'sms',      'draft',
     NULL, NULL, NULL, 'Sarah Whitfield',  30),
    ('AG-02', 'Agent 2 Billing',        'client_facing', 'email',    'draft',
     NULL, NULL, NULL, 'Chris Stanbridge', 40),
    ('AG-03', 'Agent 3 Nurture',        'client_facing', 'sms',      'draft',
     NULL, NULL, NULL, 'Sarah Whitfield',  50),
    ('AG-05', 'Agent 5 Onboarding',     'client_facing', 'email',    'draft',
     NULL, NULL, NULL, 'Nina Castellano',  60),
    ('AG-06', 'Document Check',         'client_facing', 'internal', 'draft',
     NULL, NULL, NULL, 'Marcus Webb',      70),
    ('AG-07', 'Recon',                  'client_facing', 'internal', 'draft',
     NULL, NULL, NULL, 'Chris Stanbridge', 80),
    ('AG-08', 'Context Fetcher',        'client_facing', 'internal', 'draft',
     NULL, NULL, NULL, 'Chris Stanbridge', 90),
    ('OP-01', 'Heartbeat',              'ops',           'internal', 'draft',
     NULL, NULL, NULL, 'Chris Stanbridge', 100),
    ('OP-02', 'Fixer',                  'ops',           'internal', 'draft',
     NULL, NULL, NULL, 'Chris Stanbridge', 110),
    ('OP-03', 'Daily Brief',            'ops',           'email',    'draft',
     NULL, NULL, NULL, 'Chris Stanbridge', 120),
    ('OP-04', 'Compliance Gate',        'ops',           'internal', 'draft',
     NULL, NULL, NULL, 'Chris Stanbridge', 130),
    ('OP-05', 'Data + Models',          'ops',           'internal', 'draft',
     NULL, NULL, NULL, 'Chris Stanbridge', 140)
  ) AS v(code, name, agent_class, channel, status,
         runtime, runtime_ref, runtime_notes, owner_label, sort_order)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM agents a WHERE a.org_id = o.id AND a.code = v.code
   );
