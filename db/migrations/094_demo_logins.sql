-- 094_demo_logins.sql — nine accounts, one per role, so the portals can be opened.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE PROBLEM THIS FIXES, IN ONE SENTENCE.
--   public/app/shell.js:120 grants tabs to NINE roles — owner, admin,
--   funding_advisor, closer, inquiry_specialist, setter, client, affiliate,
--   partner — and this database has never held a single account able to sign in
--   as any of them except the six founding staff in src/auth/seed-staff.mjs,
--   which covers six of the nine and none of the three portals. The affiliate
--   portal, the client portal and the white-label partner portal were shipped
--   screens that nobody could reach. Every review of every one of them was
--   blocked behind a login form that had nothing to type into it.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHAT IT WRITES
--   staff        6 rows — the six employee roles, is_demo = true
--   clients      2 rows — one direct, one owned by the demo partner
--   affiliates   1 row
--   partners     1 row  + partner_brand 1 row (brand-studio.html reads it)
--   accounts     3 rows — the client / affiliate / partner PRINCIPALS
--                (db/migrations/044_accounts.sql), each linked to its subject
--   entitlements 3 rows for the demo client, so GET /api/read/entitlements —
--                the one endpoint a client principal may read — is not empty
--
-- WHAT IT NEVER DOES
--   No DELETE. No UPDATE. No overwrite. Every insert is guarded by NOT EXISTS
--   on the natural key, so re-running this file after the owner has edited a
--   demo row leaves his edit alone, and re-running it against a database full of
--   real customers writes nothing it did not write the first time. The three
--   ALTER TABLE ... ADD COLUMN IF NOT EXISTS statements default to false, so no
--   existing row changes meaning.
--
-- WHY EDITING THIS FILE LATER WILL DO NOTHING. db/migrate.mjs records each file
-- in schema_migrations keyed '<dir>/<file>' and skips anything already there.
-- Once 'migrations/094_demo_logins.sql' is applied, changing these bytes is a
-- silent no-op. Supersede it with 095, do not edit it.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THE SAFETY, WHICH IS THE POINT.
--
-- 1. NONE OF THESE ROWS CAN AUTHENTICATE UNLESS DEMO_LOGINS_ENABLED IS SET.
--    src/auth/demo-logins.mjs fails closed on an unset or unrecognised value,
--    the same way src/banking/plaid.mjs:isPlaidEnabled() does, and for the same
--    recorded reason (AUDIT-FINDINGS.md: an adapter that read a missing key as
--    "no check needed"). src/auth/login.mjs and src/auth/account-session.mjs
--    both consult it AFTER the password has already verified — this is a refusal
--    layered on top of the real check, never a replacement for it.
--
-- 2. THE PASSWORD IS A REAL SCRYPT VERIFIER, NOT A BYPASS. The literal below
--    was produced by src/auth/hash.mjs:hashPassword() via
--    scripts/db/demo-password-hash.mjs — the same function the login path
--    verifies against. There is one hashing implementation in this repo and
--    these rows go through it like everybody else. The cleartext is
--    'demo-portal-2026', published on purpose in public/login.html, and it opens
--    nothing at all when the switch in (1) is off.
--
-- 3. THEY ARE UNMISTAKABLE. Addresses on demo.fundhub.local — a .local name that
--    resolves nowhere and can never receive mail. Names that all begin "DEMO ".
--    An is_demo column on every table that holds one, so a staff list, a client
--    list or an assignment dropdown can exclude them and an operator can see
--    what they are without knowing this file exists.
--
-- 4. ORG SCOPING IS NOT OPTIONAL. Every row binds the default org's id. Audit
--    C1: a staff row with no org_id now fails CLOSED on every read endpoint —
--    it signs in, then shows empty screens everywhere, which is the single most
--    confusing way this seed could fail.
-- ─────────────────────────────────────────────────────────────────────────────

-- ---------------------------------------------------------------------------
-- A. The is_demo flag. Additive, defaulted false, so no existing row moves.
-- ---------------------------------------------------------------------------
-- On the two tables that hold a credential …
ALTER TABLE staff      ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE accounts   ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
-- … and on the three subject tables, because those are the rows that show up in
-- an operator's lists. A demo client sitting unlabelled in the client roster is
-- how somebody works a fake file for an afternoon.
ALTER TABLE clients    ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE partners   ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN staff.is_demo IS
  'true = seeded demo row (db/migrations/094_demo_logins.sql). Cannot sign in unless DEMO_LOGINS_ENABLED is set — see src/auth/demo-logins.mjs. Not a real person.';
COMMENT ON COLUMN accounts.is_demo IS
  'true = seeded demo principal (db/migrations/094_demo_logins.sql). Cannot sign in unless DEMO_LOGINS_ENABLED is set — see src/auth/demo-logins.mjs. Not a real customer.';

CREATE INDEX IF NOT EXISTS staff_is_demo_idx    ON staff (org_id)    WHERE is_demo;
CREATE INDEX IF NOT EXISTS accounts_is_demo_idx ON accounts (org_id) WHERE is_demo;

-- ---------------------------------------------------------------------------
-- B. The rows.
--
-- One DO block because the account rows need the ids of the subject rows and of
-- the demo owner (accounts.invited_by), and 044's trigger REQUIRES invited_by
-- for kind='partner' — a partner is a commercial relationship and may not
-- self-register. The demo owner is the inviter of record.
--
-- The dollar-quote tag is $demo094$ and not $$ on purpose: the scrypt verifier
-- literal below contains '$scrypt$' and '$'-delimited fields, and a bare $$ body
-- is harder to read past. It contains no '$demo094$' sequence, so the body
-- terminates exactly where it looks like it does.
-- ---------------------------------------------------------------------------
DO $demo094$
DECLARE
  v_org        uuid;
  -- scrypt N=32768,r=8,p=1 verifier for 'demo-portal-2026'.
  -- Regenerate with: node scripts/db/demo-password-hash.mjs
  v_hash       constant text := '$scrypt$N=32768,r=8,p=1$pwNZdJbOVIfhXuKT4apKrA$UfZ2k0IhGzTosIKwi9btqi2aArNky7fOzz6bIS3fkKM';
  v_owner      uuid;
  v_client     uuid;
  v_affiliate  uuid;
  v_partner    uuid;
BEGIN
  SELECT id INTO v_org FROM orgs WHERE is_default LIMIT 1;
  IF v_org IS NULL THEN
    RAISE NOTICE '094_demo_logins: no default org — nothing seeded.';
    RETURN;
  END IF;

  -- -------------------------------------------------------------------------
  -- B1. Six staff. Roles are the catalog keys from db/schema/020_auth.sql and
  -- they must match public/app/shell.js ROLE_TABS character for character —
  -- the shell folds with lower(btrim()) and an unrecognised role silently falls
  -- back to the shared staff tabs, which would hide the thing being reviewed.
  -- src/http/demo-logins.test.mjs fails if this list and ROLE_TABS drift apart.
  -- -------------------------------------------------------------------------
  INSERT INTO staff (org_id, email, name, role, status, password_hash, is_demo)
  SELECT v_org, v.email, v.name, v.role, 'active', v_hash, true
    FROM (VALUES
      ('owner@demo.fundhub.local',   'DEMO Owner',              'owner'),
      ('admin@demo.fundhub.local',   'DEMO Admin',              'admin'),
      ('advisor@demo.fundhub.local', 'DEMO Funding Advisor',    'funding_advisor'),
      ('closer@demo.fundhub.local',  'DEMO Closer',             'closer'),
      ('inquiry@demo.fundhub.local', 'DEMO Inquiry Specialist', 'inquiry_specialist'),
      ('setter@demo.fundhub.local',  'DEMO Setter',             'setter')
    ) AS v(email, name, role)
   WHERE NOT EXISTS (
     SELECT 1 FROM staff s WHERE s.org_id = v_org AND lower(s.email) = v.email
   );

  SELECT id INTO v_owner FROM staff
   WHERE org_id = v_org AND lower(email) = 'owner@demo.fundhub.local' LIMIT 1;

  -- -------------------------------------------------------------------------
  -- B2. The white-label partner, and its brand row.
  --
  -- partner-galaxy.html is the partner's own screen; brand-studio.html reads
  -- /api/partner-brand, and public/app/shell.js:applyBrand() themes the whole
  -- shell from it. Without a partner_brand row the partner signs in to the
  -- fundhub default brand and the white-label story is invisible — which is
  -- precisely what the owner wants to look at.
  -- -------------------------------------------------------------------------
  INSERT INTO partners (org_id, name, brand_name, slug, status,
                        revenue_share_pct, agreement_signed_at, contact_email, notes, is_demo)
  SELECT v_org, 'DEMO Partner — Northlight Capital', 'Northlight Capital', 'demo-partner',
         'active', 50, now(), 'partner@demo.fundhub.local',
         'Seeded by db/migrations/094_demo_logins.sql. NOT A REAL PARTNER — no agreement exists.',
         true
   WHERE NOT EXISTS (SELECT 1 FROM partners p WHERE p.org_id = v_org AND p.slug = 'demo-partner');

  SELECT id INTO v_partner FROM partners
   WHERE org_id = v_org AND slug = 'demo-partner' LIMIT 1;

  -- Six-stop ramp, hex only — 043's CHECK rejects anything else, and the ramp
  -- must be exactly six stops or empty.
  INSERT INTO partner_brand (org_id, partner_id, ink, paper, ramp,
                             display_face, mono_face, voice,
                             entity_name, entity_address, support_email, domain,
                             approval_status, approved_at, approved_by)
  SELECT v_org, v_partner, '#0A0A0A', '#FFFFFF',
         '["#1B3A5C","#2E6E9E","#5AA9D6","#8FCBE8","#C4E4F3","#E8F5FB"]'::jsonb,
         'Inter', 'JetBrains Mono',
         'Plain, direct, no hype.',
         'Northlight Capital DEMO', '1 Demo Way, Suite 000, Demo City',
         'support@demo.fundhub.local', 'demo-partner.fundhub.local',
         'approved', now(), v_owner
   WHERE v_partner IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM partner_brand b WHERE b.partner_id = v_partner);

  -- -------------------------------------------------------------------------
  -- B3. The affiliate.
  --
  -- balance_due, payout_status and direct_downline_count ARE NOT SET HERE, and
  -- that is deliberate. 033_affiliates.sql section E makes all three DERIVED
  -- columns with a guard trigger that rejects any hand-written value: they roll
  -- up affiliate_referrals and affiliate_payouts, and "the counter drifted" is
  -- explicitly not a failure mode that schema allows. Typing a nice-looking
  -- $1,250.50 in here would be a number that disagrees with every table it is
  -- supposed to summarise — a fake that the drift view would then report as a
  -- bug in the affiliate ledger.
  --
  -- SO THE AFFILIATE PORTAL WILL SHOW $0.00 ACCRUED, AND THAT IS THE TRUTH.
  -- affiliate_commission_rules ships EMPTY because AF-04 — the commission
  -- schedule — has not been decided. public/app/affiliate.html says so in its
  -- own comment and shows accrued balance rather than inventing a percentage.
  -- An unrated conversion carries commission_due NULL, which rolls up to zero.
  -- Inventing a rate here to make the screen look better would be inventing the
  -- commission schedule of a live business from a seed file.
  -- -------------------------------------------------------------------------
  INSERT INTO affiliates (org_id, name, status, tracking_id, tier_level,
                          activated_at, partner_license_signed_at, is_demo)
  SELECT v_org, 'DEMO Affiliate — Rivera Referrals', 'active', 'DEMO-AFF-0001', 'tier1',
         now(), now(), true
   WHERE NOT EXISTS (
     SELECT 1 FROM affiliates a WHERE a.org_id = v_org AND a.tracking_id = 'DEMO-AFF-0001'
   );

  SELECT id INTO v_affiliate FROM affiliates
   WHERE org_id = v_org AND tracking_id = 'DEMO-AFF-0001' LIMIT 1;

  -- -------------------------------------------------------------------------
  -- B4. Two clients.
  --
  -- The first is the demo client principal's own file — a direct fundhub client
  -- (partner_id NULL). The second belongs to the demo partner, so
  -- partner-galaxy.html and src/partners/scope.mjs have a book to scope to
  -- rather than an empty one. clients.partner_id IS the tenancy model (042).
  --
  -- NO PII. No SSN, no date of birth, no real address — pii_identity is not
  -- touched by this file. A demo file with fabricated identity data is a demo
  -- file somebody eventually runs a credit pull against.
  -- -------------------------------------------------------------------------
  INSERT INTO clients (org_id, first_name, last_name, email, phone,
                       funded, funded_amount, days_to_fund, outcome_tier,
                       channel_source, tags, consent_sms, is_demo)
  SELECT v_org, 'Dana', 'DEMO-Client', 'client@demo.fundhub.local', '+15550100',
         true, 47500.00, 38, 'FUNDING_PLUS_REPAIR', 'demo-seed',
         ARRAY['demo','seeded'], false, true
   WHERE NOT EXISTS (
     SELECT 1 FROM clients c
      WHERE c.org_id = v_org AND lower(c.email) = 'client@demo.fundhub.local'
   );

  SELECT id INTO v_client FROM clients
   WHERE org_id = v_org AND lower(email) = 'client@demo.fundhub.local' LIMIT 1;

  INSERT INTO clients (org_id, first_name, last_name, email, phone,
                       funded, funded_amount, days_to_fund, outcome_tier,
                       channel_source, tags, consent_sms, partner_id, is_demo)
  SELECT v_org, 'Pat', 'DEMO-PartnerClient', 'partner-client@demo.fundhub.local', '+15550101',
         true, 82000.00, 51, 'PREMIUM_STACK', 'demo-seed',
         ARRAY['demo','seeded','white-label'], false, v_partner, true
   WHERE v_partner IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM clients c
        WHERE c.org_id = v_org AND lower(c.email) = 'partner-client@demo.fundhub.local'
     );

  -- One real referral, so the affiliate has actually referred somebody rather
  -- than existing as a name with no history. commission_due is left NULL — see
  -- B3: no rule is in force, and NULL means "not calculated", which is what the
  -- schema wants and what the portal is written to display.
  --
  -- ON CONFLICT DO NOTHING against affiliate_referrals_client_tier_uniq: first
  -- touch wins, forever. If this client already has a direct attribution — from
  -- a real affiliate — this statement leaves it exactly where it is rather than
  -- stealing somebody's commission, which is the whole point of that index.
  INSERT INTO affiliate_referrals (org_id, affiliate_id, client_id, tier,
                                   tracking_id_used, attributed_at, source,
                                   converted_at, status, notes)
  SELECT v_org, v_affiliate, v_client, 'direct', 'DEMO-AFF-0001',
         now() - interval '30 days', 'manual',
         now() - interval '22 days', 'converted',
         'Seeded by db/migrations/094_demo_logins.sql. No commission rule in force (AF-04).'
   WHERE v_affiliate IS NOT NULL AND v_client IS NOT NULL
  ON CONFLICT (client_id, tier) DO NOTHING;

  -- Three deliverables for the demo client. GET /api/read/entitlements is the
  -- one endpoint a CLIENT principal is admitted to (api/read/entitlements.mjs),
  -- so this is the difference between a client portal with contents and a
  -- client portal that answers an empty list. Codes are the ones already seeded
  -- by db/migrations/032_entitlements.sql — nothing new is invented.
  INSERT INTO entitlements (org_id, client_id, entitlement_code, granted_by, grant_reason)
  SELECT v_org, v_client, v.code, v_owner,
         'Seeded by db/migrations/094_demo_logins.sql for the demo client portal.'
    FROM (VALUES
      ('credit-analysis-report'),
      ('credit-optimization-roadmap'),
      ('funding-snapshot')
    ) AS v(code)
   WHERE v_client IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM entitlements e
        WHERE e.org_id = v_org AND e.client_id = v_client AND e.entitlement_code = v.code
     );

  -- -------------------------------------------------------------------------
  -- B5. The three principals.
  --
  -- These are ACCOUNTS, not staff. A client is not an employee: it holds no
  -- internal role, draws no commission through sale_attributions and must never
  -- appear in a closer's queue. 044_accounts.sql exists for exactly this and its
  -- CHECK enforces that the subject link matches the kind.
  --
  -- invited_by is set on all three even though only 'partner' requires it (the
  -- 044 trigger). Recording who created a login is right regardless, and it
  -- keeps the three rows identical in shape.
  -- -------------------------------------------------------------------------
  INSERT INTO accounts (org_id, kind, email, name, password_hash, status,
                        client_id, affiliate_id, partner_id,
                        invited_by, invited_at, activated_at, is_demo)
  SELECT v_org, 'client', 'client@demo.fundhub.local', 'DEMO Client', v_hash, 'active',
         v_client, NULL::uuid, NULL::uuid, v_owner, now(), now(), true
   WHERE v_client IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM accounts a
        WHERE a.org_id = v_org AND lower(a.email) = 'client@demo.fundhub.local'
     );

  INSERT INTO accounts (org_id, kind, email, name, password_hash, status,
                        client_id, affiliate_id, partner_id,
                        invited_by, invited_at, activated_at, is_demo)
  SELECT v_org, 'affiliate', 'affiliate@demo.fundhub.local', 'DEMO Affiliate', v_hash, 'active',
         NULL::uuid, v_affiliate, NULL::uuid, v_owner, now(), now(), true
   WHERE v_affiliate IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM accounts a
        WHERE a.org_id = v_org AND lower(a.email) = 'affiliate@demo.fundhub.local'
     );

  INSERT INTO accounts (org_id, kind, email, name, password_hash, status,
                        client_id, affiliate_id, partner_id,
                        invited_by, invited_at, activated_at, is_demo)
  SELECT v_org, 'partner', 'partner@demo.fundhub.local', 'DEMO Partner', v_hash, 'active',
         NULL::uuid, NULL::uuid, v_partner, v_owner, now(), now(), true
   WHERE v_partner IS NOT NULL
     AND v_owner IS NOT NULL   -- 044's trigger rejects a partner with no inviter
     AND NOT EXISTS (
       SELECT 1 FROM accounts a
        WHERE a.org_id = v_org AND lower(a.email) = 'partner@demo.fundhub.local'
     );

  RAISE NOTICE '094_demo_logins: nine demo logins present. They authenticate ONLY when DEMO_LOGINS_ENABLED is set.';
END
$demo094$;
