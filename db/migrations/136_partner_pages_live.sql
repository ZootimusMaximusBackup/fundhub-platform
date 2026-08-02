-- 136_partner_pages_live.sql — take partner_pages from draft to hosted live.
--
-- Adds published_at so Brand Studio can mark a funnel page live, and records
-- that the public /sites/:partner_id/:slug path (and verified custom domains)
-- serve only status='published' rows. DNS TXT verification for custom domains
-- still flips partner_brand.domain_verified via the verify-domain API.

ALTER TABLE partner_pages
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

COMMENT ON COLUMN partner_pages.published_at IS
  'Set when status becomes published. Cleared when unpublished/archived.';

COMMENT ON TABLE partner_pages IS
  'Partner funnel pages. Drafts live in Brand Studio; status=published is served at /sites/:partner_id/:slug (and on a verified custom domain).';
