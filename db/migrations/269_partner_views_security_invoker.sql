-- 269_partner_views_security_invoker.sql — the partner views ignored row-level
-- security. A partner could read every other partner's data through them.
--
-- WHAT WAS BROKEN, AND IT WAS NOT THEORETICAL
--
-- api/campaigns/spend.mjs:5-6 says, in a comment:
--
--     "Reads v_partner_spend_vs_ceiling from 046. The view is SECURITY INVOKER,
--      so RLS applies to the caller — a partner sees only their own ceilings."
--
-- That was false. No v_partner_* view carried `security_invoker`, and a plain
-- Postgres view runs with the VIEW OWNER's identity: the owner is exempt from
-- the FORCEd policies on the base tables, so every policy those tables carry was
-- skipped for anything read through a view.
--
-- Measured 2026-08-27 on a database built from zero, connected as fundhub_app
-- with fundhub.partner_id set to partner B, with one spend_ceilings row owned by
-- partner A:
--
--     SELECT count(*) FROM spend_ceilings              -> 0   (policy applied)
--     SELECT count(*) FROM v_partner_spend_vs_ceiling  -> 1   (policy skipped)
--
-- One row, belonging to somebody else, through a partner-facing endpoint.
-- src/partners/rls.mjs names cross-partner disclosure as the worst bug this
-- module can produce, and 104_app_role.sql exists to make the policies real.
-- This is the hole they were still open through.
--
-- WHY THIS IS SAFE FOR STAFF
--
-- The policies are `partner_id = fundhub_current_partner() OR fundhub_is_staff()`.
-- A staff context still matches the second branch, so staff keep seeing the whole
-- book through these views exactly as before. Only a PARTNER context changes, and
-- it changes to what the endpoint already claimed it was.
--
-- `fundhub_app` holds SELECT on every table in public (104), so invoking as the
-- caller cannot fail for want of a grant.
--
-- security_invoker on views requires Postgres 15+. netlify/CI and local are 16.

ALTER VIEW v_partner_spend_vs_ceiling SET (security_invoker = true);
ALTER VIEW v_partner_balance          SET (security_invoker = true);
ALTER VIEW v_partner_book             SET (security_invoker = true);
ALTER VIEW v_partner_brand_effective  SET (security_invoker = true);
ALTER VIEW v_partner_creative_usage   SET (security_invoker = true);
