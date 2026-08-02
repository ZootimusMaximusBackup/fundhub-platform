-- 135_partner_pages.sql — funnel / page drafts for Brand Studio.
--
-- Brand Studio already stores selected_funnels on partner_brand. This table is
-- the next step toward actually creating partner pages from those funnel
-- templates (apply, diag, edu, aff, book) — a draft page per partner per
-- template key, with editable title/slug/status. Hosted custom-domain serving
-- is still deferred (see docs/STILL-MISSING.md).

CREATE TABLE IF NOT EXISTS partner_pages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  partner_id   uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  funnel_key   text NOT NULL,
  title        text NOT NULL,
  slug         text NOT NULL,
  status       text NOT NULL DEFAULT 'draft',
  body_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT partner_pages_funnel_ck
    CHECK (funnel_key IN ('apply', 'diag', 'edu', 'aff', 'book')),
  CONSTRAINT partner_pages_status_ck
    CHECK (status IN ('draft', 'preview', 'published', 'archived')),
  CONSTRAINT partner_pages_slug_ck
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  CONSTRAINT partner_pages_title_ck
    CHECK (btrim(title) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS partner_pages_partner_slug_uq
  ON partner_pages (partner_id, slug);

CREATE UNIQUE INDEX IF NOT EXISTS partner_pages_partner_funnel_uq
  ON partner_pages (partner_id, funnel_key)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS partner_pages_partner_idx
  ON partner_pages (partner_id, status, updated_at DESC);

COMMENT ON TABLE partner_pages IS
  'Partner funnel page drafts created from Brand Studio templates. Publishing to a custom domain is not wired yet.';
