-- 128_org_brand.sql — the company's own brand tokens for the internal CRM.
--
-- ┌─ SUPERSEDED IN PART, 2026-08-31 ────────────────────────────────────────┐
-- │ The paragraph below says "partners theme only their funnels; the        │
-- │ internal CRM has its own theme". THAT WAS THE DECISION UNTIL            │
-- │ 2026-08-31 AND IT IS NO LONGER TRUE. The owner reversed it: a           │
-- │ white-label partner signing in and seeing Fundhub's colours, type and   │
-- │ wordmark on every screen is the thing white-label is sold to prevent,   │
-- │ so a partner now sees their own brand on the CRM too.                   │
-- │                                                                        │
-- │ THIS TABLE AND THIS VIEW DID NOT CHANGE, and no SQL below was edited.   │
-- │ The reversal is in api/org-brand.mjs, which resolves the brand from the │
-- │ PRINCIPAL: a partner principal reads their own partner_brand row        │
-- │ through v_partner_brand_effective, and staff, affiliates and clients    │
-- │ read the org row from v_org_brand_effective exactly as before. So the   │
-- │ last sentence of that paragraph still holds — a partner editing Brand   │
-- │ Studio still cannot recolor a Fundhub staff screen, because a partner   │
-- │ still cannot write this table.                                          │
-- │                                                                        │
-- │ Only the comment moved. Editing an APPLIED migration's SQL is a silent  │
-- │ no-op (CLAUDE.md §12) — a comment is not, because a comment's only      │
-- │ reader is a person opening this file, and leaving a retired rule stated │
-- │ as current here is how the next reader gets it wrong. The current rule  │
-- │ is in docs/BRAND-THEMING-SPEC.md.                                       │
-- └────────────────────────────────────────────────────────────────────────┘
--
-- WHY THIS TABLE EXISTS. partner_brand (043) is for white-label partner funnels.
-- Docs/BRAND-THEMING-SPEC.md records the owner decision: partners theme only
-- their funnels; the internal CRM has its own theme. A partner editing Brand
-- Studio must never recolor Fundhub staff screens. This row is that CRM theme.
--
-- One row per org. Same colour / font / wordmark shape as partner_brand, without
-- funnel, domain, or approval fields — those are partner-surface concerns.
--
-- GOOGLE FONTS ONLY, same CHECK shape as 043. Hex-only colours so a CSS custom
-- property cannot be fed url() or an expression.

CREATE OR REPLACE FUNCTION org_brand_ramp_ok(v jsonb) RETURNS boolean AS $$
  SELECT jsonb_typeof(v) = 'array'
     AND (
       jsonb_array_length(v) = 0
       OR (
         jsonb_array_length(v) = 6
         AND (SELECT bool_and(s ~ '^#[0-9a-fA-F]{6}$')
                FROM jsonb_array_elements_text(v) AS t(s))
       )
     );
$$ LANGUAGE sql IMMUTABLE;

CREATE TABLE IF NOT EXISTS org_brand (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  wordmark_url      text,
  ink               text,
  paper             text,
  ramp              jsonb NOT NULL DEFAULT '[]'::jsonb,

  display_face      text,
  mono_face         text,

  entity_name       text,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT org_brand_ink_ck
    CHECK (ink IS NULL OR ink ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT org_brand_paper_ck
    CHECK (paper IS NULL OR paper ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT org_brand_ramp_ck CHECK (org_brand_ramp_ok(ramp)),
  CONSTRAINT org_brand_display_ck
    CHECK (display_face IS NULL OR display_face ~ '^[A-Za-z0-9 \-]{1,60}$'),
  CONSTRAINT org_brand_mono_ck
    CHECK (mono_face IS NULL OR mono_face ~ '^[A-Za-z0-9 \-]{1,60}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS org_brand_org_uniq ON org_brand (org_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_org_brand_updated_at'
                      AND tgrelid = 'public.org_brand'::regclass) THEN
    CREATE TRIGGER trg_org_brand_updated_at BEFORE UPDATE ON org_brand
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- Effective view — what shell.js applies. Falls back to the Fundhub CSS
-- defaults so an org with no row still gets a themed page rather than blanks.
CREATE OR REPLACE VIEW v_org_brand_effective AS
SELECT o.id AS org_id,
       o.slug,
       COALESCE(b.entity_name, o.name)                     AS entity_name,
       b.wordmark_url,
       COALESCE(b.ink, '#0A0A0A')                          AS ink,
       COALESCE(b.paper, '#FCFCFC')                        AS paper,
       COALESCE(NULLIF(b.ramp, '[]'::jsonb), '[]'::jsonb)  AS ramp,
       b.display_face,
       b.mono_face
  FROM orgs o
  LEFT JOIN org_brand b ON b.org_id = o.id;

-- Seed the default Fundhub org with the live CSS tokens so the first paint
-- after this migration matches fundhub-brand.css until somebody edits them.
INSERT INTO org_brand (org_id, ink, paper, ramp, display_face, mono_face, entity_name)
SELECT o.id,
       '#0A0A0A',
       '#FCFCFC',
       '["#F2A69B","#F5CE8F","#F2E39B","#A8D8B0","#A9C6E8","#C4B3E5"]'::jsonb,
       'Inter',
       'JetBrains Mono',
       o.name
  FROM orgs o
 WHERE o.is_default = true
   AND NOT EXISTS (SELECT 1 FROM org_brand b WHERE b.org_id = o.id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON org_brand TO fundhub_app;
    GRANT SELECT ON v_org_brand_effective TO fundhub_app;
  END IF;
END $$;
