-- 113_journeys.sql — persistent storage for the Journeys editor
-- (public/app/journeys.html): the SMS/email/pipeline automation the client,
-- setter, closer, funding advisor, affiliate and white-label onboarding
-- flows follow.
--
-- One row per journey key (client, setter, closer, advisor, affiliate,
-- partner), holding the whole step tree as JSONB. The editor already models
-- a journey as a tree of steps where a "condition" step carries two labelled
-- branches, each a list of further steps — a relational steps/branches
-- schema would only be that same tree spread across tables and reassembled
-- on every read, so JSONB keeps the storage shape identical to the shape the
-- editor already builds, sends and renders.
--
-- Scoped by org_id, same convention as message_templates (001_init.sql) —
-- this is internal operating automation, not partner-branded content, so it
-- does not carry partner_id or the partner-isolation RLS from 045.

-- RENUMBERED FROM 106_journeys.sql at the five-branch merge, 2026-08-01, on the
-- owner's instruction: `106` was carried by two files. `migrate.mjs` keys
-- schema_migrations on `<dir>/<file>`, so any database that already applied
-- `migrations/106_journeys.sql` sees this as a brand-new file and runs it again.
-- That is why the CREATE below is `IF NOT EXISTS` — the re-run has to be a
-- no-op, not a "relation already exists" error that aborts the whole run.
CREATE TABLE IF NOT EXISTS journeys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  key         text NOT NULL,          -- client | setter | closer | advisor | affiliate | partner
  name        text NOT NULL,
  start_when  text NOT NULL,
  end_when    text NOT NULL,
  description text NOT NULL DEFAULT '',
  nodes       jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_by  uuid REFERENCES staff(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, key)
);

-- updated_at, per the 001_init.sql convention.
DROP TRIGGER IF EXISTS trg_journeys_updated_at ON journeys;
CREATE TRIGGER trg_journeys_updated_at
  BEFORE UPDATE ON journeys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Belt and braces alongside 104's blanket grant + default-privileges, same
-- reasoning 105 recorded: a grant that already holds is a no-op, not an error.
GRANT SELECT, INSERT, UPDATE, DELETE ON journeys TO fundhub_app;
