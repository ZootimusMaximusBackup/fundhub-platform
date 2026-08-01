-- 096_demo_client_entitlements.sql — give the demo client something to look at.
--
-- WHAT WENT WRONG. db/migrations/094_demo_logins.sql:273 inserts three
-- entitlements for the demo client, and after 094 applied cleanly the
-- `entitlements` table held ZERO rows — not zero for that client, zero
-- altogether. Every part it depends on resolves correctly:
--
--   clients.email = 'client@demo.fundhub.local'   exists
--   staff.email   = 'owner@demo.fundhub.local'    exists
--   entitlement_catalog                            holds all three codes
--   the client's org, the owner's org and the default org are the SAME uuid
--   org_id, client_id and entitlement_code are the only NOT NULL columns
--     without a default, and 094 supplies all three
--
-- So the statement ran and matched nothing. Its guard is a WHERE against
-- variables set earlier in the same DO block, and a WHERE that matches nothing
-- inserts nothing SILENTLY — no error, no warning, and the migration records
-- itself as applied. That is the failure mode: a seed that reports success and
-- writes nothing.
--
-- 094 cannot be edited to fix it. db/migrate.mjs keys `schema_migrations` on
-- `<dir>/<file>`, so editing an applied file is a silent no-op and the change
-- would never run on any database that already has 094. Superseding it with a
-- new file is the only mechanism that works, and it is what 089 did for 088.
--
--
-- WHY IT MATTERS MORE THAN A FIXTURE USUALLY WOULD.
--
-- GET /api/read/entitlements is the ONE endpoint a client principal is admitted
-- to (api/read/entitlements.mjs declares `principals: new Set(["client"])`).
-- With no rows the demo client portal answers an empty list, and the owner —
-- who is signing in as each role specifically to judge whether that portal
-- looks finished — sees a blank screen and cannot tell "this portal is not
-- built" from "this account has nothing on it". An empty demo teaches him
-- nothing, which is the whole reason the demo data exists.
--
--
-- SET-BASED, NOT VARIABLE-BASED, AND THAT IS THE POINT.
--
-- No DO block, no local variables, no procedural guard. Every value is resolved
-- inline by the INSERT's own SELECT, so there is no state that can be unset by
-- the time the statement runs — which is precisely how 094's version came to
-- match nothing. It joins `clients` to `entitlement_catalog`, so a code that is
-- not in the catalog cannot be invented here either.
--
-- Idempotent and safe to re-run: NOT EXISTS on the same three columns. Nothing
-- is deleted, nothing is overwritten, and a real client's entitlements are
-- untouched — the join pins this to one seeded email on one org.

INSERT INTO entitlements (org_id, client_id, entitlement_code, granted_by, grant_reason)
SELECT c.org_id,
       c.id,
       cat.code,
       (SELECT s.id FROM staff s
         WHERE s.org_id = c.org_id
           AND lower(s.email) = 'owner@demo.fundhub.local'
         LIMIT 1),
       'Seeded by db/migrations/096_demo_client_entitlements.sql. 094 intended to write these and matched nothing.'
  FROM clients c
  JOIN entitlement_catalog cat
    ON cat.code IN ('credit-analysis-report',
                    'credit-optimization-roadmap',
                    'funding-snapshot')
 WHERE lower(c.email) = 'client@demo.fundhub.local'
   AND NOT EXISTS (
     SELECT 1 FROM entitlements e
      WHERE e.org_id = c.org_id
        AND e.client_id = c.id
        AND e.entitlement_code = cat.code
   );
