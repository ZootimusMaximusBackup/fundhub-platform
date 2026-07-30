-- 043_partner_brand.sql — where a white-label partner's brand actually lives.
--
-- THE GAP. public/app/brand-studio.html saves to localStorage. There is no table,
-- no endpoint, and public/app/shell.js does not read the tokens — so nothing it
-- saves themes anything, on any machine but the one that typed it.
--
-- One row per partner, keyed to partners.id from 042.
--
-- FONTS ARE GOOGLE-ONLY, enforced here rather than trusted to the form. A
-- licensed family pasted into a white-label config becomes OUR redistribution
-- problem the moment the partner's funnel serves it, and a CHECK is the only
-- place that cannot be bypassed by a direct write.
--
-- THE COMPLIANCE BLOCKS ARE NOT WRITABLE THROUGH THIS TABLE. BS-05 requires the
-- disclosure copy to come from a master template with the partner's entity name
-- injected — never edited per partner. So entity_name and the address/contact
-- fields are here (they are injected INTO the template) and the disclosure text
-- itself is deliberately absent. If a column for it ever appears, that is the
-- bug.

-- Six hex stops, or none. IMMUTABLE so it is usable from a CHECK.
CREATE OR REPLACE FUNCTION partner_brand_ramp_ok(v jsonb) RETURNS boolean AS $$
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

CREATE TABLE IF NOT EXISTS partner_brand (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),
  partner_id        uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,

  wordmark_url      text,

  -- The two anchors, then a six-stop ramp between them.
  ink               text,
  paper             text,
  ramp              jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Google Fonts family names. Nothing else.
  display_face      text,
  mono_face         text,

  voice             text,

  -- Injected into the BS-05 master template. The disclosure copy itself is NOT
  -- stored or editable here — see the header.
  entity_name       text,
  entity_address    text,
  support_email     text,
  domain            text,
  domain_verified   boolean NOT NULL DEFAULT false,

  selected_funnels  jsonb NOT NULL DEFAULT '[]'::jsonb,

  --   draft    — partner is editing
  --   review   — submitted, awaiting fundhub approval
  --   approved — live on their surfaces
  approval_status   text NOT NULL DEFAULT 'draft',
  approved_at       timestamptz,
  approved_by       uuid REFERENCES staff(id) ON DELETE SET NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partner_brand_status_ck
    CHECK (approval_status IN ('draft', 'review', 'approved')),
  CONSTRAINT partner_brand_approved_ck
    CHECK ((approval_status = 'approved') = (approved_at IS NOT NULL)),
  -- Hex only. A CSS custom property takes anything, including url() and
  -- expressions, so the colour fields are the obvious injection surface.
  CONSTRAINT partner_brand_ink_ck
    CHECK (ink IS NULL OR ink ~ '^#[0-9a-fA-F]{6}$'),
  CONSTRAINT partner_brand_paper_ck
    CHECK (paper IS NULL OR paper ~ '^#[0-9a-fA-F]{6}$'),
  -- A ramp is exactly six hex stops, or empty. Checked through an IMMUTABLE
  -- function because a CHECK cannot contain a subquery, and validating each
  -- stop needs to walk the array.
  CONSTRAINT partner_brand_ramp_ck CHECK (partner_brand_ramp_ok(ramp)),
  CONSTRAINT partner_brand_funnels_ck CHECK (jsonb_typeof(selected_funnels) = 'array'),
  -- Font family names: letters, digits, spaces and hyphens. Enough for every
  -- Google family, not enough for a url() or an @import.
  CONSTRAINT partner_brand_display_ck
    CHECK (display_face IS NULL OR display_face ~ '^[A-Za-z0-9 \-]{1,60}$'),
  CONSTRAINT partner_brand_mono_ck
    CHECK (mono_face IS NULL OR mono_face ~ '^[A-Za-z0-9 \-]{1,60}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_brand_partner_uniq
  ON partner_brand (partner_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_partner_brand_updated_at'
                      AND tgrelid = 'public.partner_brand'::regclass) THEN
    CREATE TRIGGER trg_partner_brand_updated_at BEFORE UPDATE ON partner_brand
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- v_partner_brand_effective — what shell.js should apply. Falls back to
-- fundhub's own values so a partner with no row, or an unapproved one, still
-- renders the default brand rather than an unstyled page.
CREATE OR REPLACE VIEW v_partner_brand_effective AS
SELECT p.id AS partner_id,
       p.org_id,
       p.slug,
       COALESCE(b.entity_name, p.brand_name, p.name)      AS entity_name,
       b.wordmark_url,
       COALESCE(b.ink, '#0A0A0A')                          AS ink,
       COALESCE(b.paper, '#FCFCFC')                        AS paper,
       COALESCE(NULLIF(b.ramp, '[]'::jsonb), '[]'::jsonb)  AS ramp,
       b.display_face,
       b.mono_face,
       b.voice,
       b.support_email,
       b.domain,
       b.domain_verified,
       COALESCE(b.selected_funnels, '[]'::jsonb)           AS selected_funnels,
       COALESCE(b.approval_status, 'draft')                AS approval_status
  FROM partners p
  LEFT JOIN partner_brand b ON b.partner_id = p.id;
