-- 036_partner_role.sql
--
-- Adds 'partner' to the staff_roles catalog so the white-label Brand Studio
-- surface (public/app/brand-studio.html) is reachable by a real account.
--
-- The gap this closes:
--   public/app/shell.js gates every screen on staff.role via ROLE_TABS, and
--   grants brand-studio.html to 'partner'. No 'partner' row has ever existed in
--   the catalog seeded by 020_auth.sql, so no production account could hold
--   that role and nobody but owner/admin (ROLE_TABS "*") could open the screen.
--   'owner' is NOT added here — 020_auth.sql:103 already seeds it. Only the
--   descriptive comments in 001_init.sql and 009_staff_targets.sql were stale,
--   and those are corrected in this same change.
--
-- DESIGN NOTE — this is a deliberate short-term fix.
--   A partner is a PRINCIPAL TYPE, not a staff role. Partners are external
--   white-label accounts, not employees: they do not belong in `staff`, do not
--   draw commission through sale_attributions, and should not be reachable by
--   the staff invite flow in src/auth/invite.mjs. The same is true of the
--   'client' and 'affiliate' entries already referenced in shell.js ROLE_TABS.
--   The correct end state is a separate accounts/principals table with its own
--   auth and its own gate, at which point 'partner' should be REMOVED from this
--   catalog and shell.js should gate on principal type rather than staff.role.
--   Until that table exists, seeding the role here is what makes the shipped
--   screen usable, and it is additive and reversible.
--
-- 001_init.sql and 020_auth.sql are NOT restructured — this is additive only,
-- in the same NOT EXISTS-guarded style as 020's seed, so re-running is a no-op.

-- staff_roles may exist in a foreign shape (see the long comment in
-- 020_auth.sql). Guard exactly as 020 does: if the catalog is not in (key, name)
-- shape, skip the seed and leave the table strictly alone. requireRole.mjs gates
-- on staff.role and reads this table only for display names, so skipping here
-- costs a label, never the gate.
DO $$
DECLARE has_catalog_shape boolean;
BEGIN
  IF to_regclass('public.staff_roles') IS NULL THEN
    RAISE NOTICE '036_partner_role: staff_roles absent — nothing to seed.';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO has_catalog_shape
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name   = 'staff_roles'
     AND column_name IN ('key','name');

  IF NOT has_catalog_shape THEN
    RAISE NOTICE '036_partner_role: staff_roles in an unexpected shape — seed skipped.';
    RETURN;
  END IF;

  EXECUTE $seed$
    INSERT INTO staff_roles (org_id, key, name, description, sort_order)
    SELECT o.id, v.key, v.name, v.description, v.sort_order
      FROM orgs o
      CROSS JOIN (VALUES
        ('partner', 'Partner', 'External white-label partner. Brand Studio and partner galaxy only.', 60)
      ) AS v(key, name, description, sort_order)
     WHERE o.is_default
       AND NOT EXISTS (
         SELECT 1 FROM staff_roles r
          WHERE r.org_id = o.id AND lower(r.key) = lower(v.key)
       )
  $seed$;
END $$;
