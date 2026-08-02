-- 115_affiliates_white_label.sql — split the partner half off R-07.
--
-- 002_pipelines seeded one rail, 'affiliates_hiring' (R-07), covering two
-- unrelated processes: recruiting affiliates/white-label partners (external,
-- paid on commission) and recruiting fundhub employees (internal, on payroll).
-- 051_hiring already split the internal-recruiting half out into its own
-- 'hiring' pipeline and left R-07's 3 stages alone "so nothing that reads it
-- breaks." This migration does the other half of that same split: it gives
-- affiliates + white-label partners — same lifecycle, same external-partner
-- relationship, just two brand flavors of it — their own pipeline too.
--
-- R-07 ('affiliates_hiring') is UNTOUCHED. Its 3 stages, its rows, its key —
-- all left exactly as-is, same reason 051 left them: something may still read
-- it, and nothing here proves otherwise.
--
-- ---------------------------------------------------------------------------
-- STAGES ARE A MINIMAL, INFERRED SET — FLAG FOR OWNER REVIEW.
--
-- Unlike 051_hiring (built from 16 source docs with a named funnel), there is
-- no equivalent "how we recruit an affiliate/partner" document in this repo.
-- What DOES exist is the `partners` table (042_partners.sql), which encodes
-- three real lifecycle states in its own CHECK constraint and comments:
--
--   invited — "record exists, cannot sign in, cannot be paid"
--   active  — "operating"
--   paused  — "suspended; keeps its book and its balance, cannot be paid"
--
-- plus a fourth real gate: partners.agreement_signed_at, "no payout may reach
-- processing or paid before this is stamped." Four of this migration's five
-- stages are those states, verbatim — not invented, read off the schema that
-- already governs partner payout eligibility.
--
-- The one stage that is NOT grounded in existing code is 'recruiting': a
-- partners row does not exist yet at 'invited' either (the comment says the
-- row already exists there), so there is nothing in the schema for the very
-- first phase — sourcing a prospective affiliate or white-label operator
-- before they are formally invited. It is seeded because the task's own
-- framing ("recruit, onboard, and pay commission") names that phase
-- explicitly and a pipeline with no first column is not a funnel. Owner:
-- confirm this is the right name/place for that phase, or tell me what it
-- should be — this is the one stage in this file that is a guess.
--
-- Same caveat as R-07 and as 'hiring': nothing in this repo moves a card
-- through these stages yet. `cards.client_id` is NOT NULL and a partner is
-- not a client (same reason 051 gave for candidate_applications carrying its
-- own stage_id instead of using `cards`), so wiring live movement here would
-- need a partners-lifecycle table of its own, the same shape as
-- candidate_applications. That is future work, not part of this split.

WITH org AS (SELECT id AS oid FROM orgs WHERE slug = 'fundhub')
INSERT INTO pipelines (org_id, key, name)
SELECT oid, 'affiliates_white_label', 'Affiliates + White Label' FROM org
ON CONFLICT (org_id, key) DO NOTHING;

WITH org AS (SELECT id AS oid FROM orgs WHERE slug = 'fundhub')
INSERT INTO pipeline_stages (org_id, pipeline_id, key, name, sort_order)
SELECT org.oid, p.id, s.key, s.name, s.ord
FROM org
JOIN pipelines p ON p.org_id = org.oid AND p.key = 'affiliates_white_label'
JOIN (VALUES
  ('recruiting',        'Recruiting',        0),
  ('invited',           'Invited',           1),
  ('agreement_signed',  'Agreement Signed',  2),
  ('active',            'Active',            3),
  ('paused',            'Paused',            4)
) AS s(key, name, ord) ON true
ON CONFLICT (pipeline_id, key) DO NOTHING;
