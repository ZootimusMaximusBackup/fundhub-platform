-- 180_product_entitlements_seed.sql — fill in the product → entitlement mapping
-- that 032 deliberately left blank, but ONLY where shipped code already answers
-- it. Everything shipped code does not answer stays blank, on purpose.
--
-- WHY THIS FILE EXISTS.
--   032_entitlements.sql built three tables and seeded two of them. It left
--   product_entitlements EMPTY with a written reason: "Which PRODUCT grants
--   which of them is NOT documented anywhere in this repo ... Guessing it would
--   decide an offer question in a migration". That was correct then. The
--   consequence, measured live on 2026-08-18, is that money lands and nothing
--   opens: src/entitlements/entitlements.mjs grantFromTransaction() returns
--   { unmapped: true, granted: [] } when no row matches, so every paid purchase
--   grants nothing, silently. Three sales rows existed for the test client and
--   the client held zero entitlements.
--
-- WHAT CHANGED SINCE 032. Nothing about the offer was decided by an agent. What
-- changed is that shipped code now states the answer for four pairs, and a
-- migration that copies shipped code is not a guess. Each row below carries its
-- own evidence chain. If a chain is not in this file, the row is not in this
-- file.
--
-- THE CHAIN, link by link:
--   public/app/client-portal.html:1326-1333  MAP — screen tile key → entitlement
--                                            code. This is the portal deciding
--                                            which code unlocks which tile.
--   src/config/offers.mjs                    tile key → offer (name, price,
--                                            paymentPurpose).
--   src/handlers/money-chain.mjs BUCKET_TO_CODE  semantic bucket → products.code.
--   db/migrations/015_seed_products.sql      the five product codes and their
--                                            categories, names and prices.
--
-- ROW 1 — diagnostic → credit-analysis-report
--   Portal MAP: SOFT_PULL → 'credit-analysis-report'.
--   offers.mjs SOFT_PULL: paymentPurpose 'diagnostic', priceCents 3200.
--   BUCKET_TO_CODE.diagnostic = BUCKET_TO_CODE.crs = 'diagnostic'.
--   015: products.code 'diagnostic', category 'diagnostic', default_price 32.00
--        — the same $32, and "Triggers analysis.completed".
--   032 catalog: credit-analysis-report is "The analyzer output the client
--        receives." The analyzer is what the $32 diagnostic triggers.
--   Corroborated by two shipped fixtures that seed this exact pair
--   (src/verification/fixtures.mjs, src/handlers/money-chain.pg.test.mjs).
--
-- ROW 2 — card-stacking-dfy → funding-snapshot
--   Portal MAP: FUNDING_DFY → 'funding-snapshot'; the portal also names
--   'funding-snapshot' as FUNDING_CODE, the code it treats as "the funding file
--   is open" (client-portal.html:1341).
--   offers.mjs FUNDING_DFY: paymentPurpose 'deposit', priceCents 300000,
--        successFeePercent 10.
--   BUCKET_TO_CODE.deposit = 'card-stacking-dfy'.
--   015: 'card-stacking-dfy', category 'funding', default_price 3000.00,
--        default_success_fee_percent 10.0000 — price AND fee both match.
--   Same two shipped fixtures seed this pair.
--
-- ROW 3 — repair-bundle → metro2-letter-pack
--   Portal MAP: REPAIR_DFY → 'metro2-letter-pack'.
--   offers.mjs REPAIR_DFY: paymentPurpose 'repair', letters: true.
--   015: 'repair-bundle' is the ONLY product with category 'repair'.
--   And 032's own header writes this pair out as its worked example:
--     "INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
--      SELECT id, 'repair-bundle', 'metro2-letter-pack' FROM orgs WHERE is_default;"
--
-- ROW 4 — consulting-package → metro2-letter-pack
--   032 catalog: metro2-letter-pack is "The paid DIY letter pack. Delivered by
--        ds-02."
--   src/workflows/ds-02-diy-letters.mjs is that workflow, and it gates on the
--        product NAME "Consulting Services Package" — "the $1,000 DIY product"
--        (its own header, and isDiyProduct() at :32-34).
--   BUCKET_TO_CODE.diy = 'consulting-package'; 015 calls that product "DIY
--        consulting" and warns its name must stay exactly "Consulting Services
--        Package" because that is the Commas product.
--   Same two shipped fixtures seed this pair.
--   Two products granting the same code is not a conflict: the unique key is
--   (org_id, product_code, entitlement_code), and the repair bundle and the DIY
--   package are both routes to the same letter pack.
--
-- WHAT IS STILL DELIBERATELY BLANK — do not fill these in without an owner
-- answer. Each is an OFFER decision, not a lookup:
--   * inquiry-removal — no shipped code anywhere says what an inquiry removal
--     entitles the client to. No portal tile maps to it. Left unmapped.
--   * REPAIR_TRIAL ("Repair test run", $200) — has NO products row at all, and
--     the portal maps it to the SAME code as the $1,000 REPAIR_DFY
--     (client-portal.html:1329-1330). Mapping it as-is would let a $200 trial
--     unlock the $1,000 deliverable; the portal even hides the trial tile once
--     metro2-letter-pack is active (client-portal.html:1750-1753). Giving the
--     trial its own code without changing that MAP line would leave the trial
--     buyer LOCKED, which is worse. Blocked on the owner.
--   * UWIQ_DELIVERABLES ("UnderwriteIQ Deliverables Package") — no products row.
--     Its contents list (offers.mjs) names five deliverables at once, while the
--     portal maps the tile to one code. Blocked on the owner.
--   * bank-lender-match-list — in the catalog, in the portal's OWN_CODES, and
--     the target of no MAP entry. Nothing says which purchase delivers it.
--   * duration_days is NULL on every row below: perpetual. Nothing in shipped
--     code states a term for any of these, and 032's rule is that a delivered
--     document stays delivered. A term is an owner decision; NULL is the
--     no-decision value, not a default dressed up as one.
--
-- SAFETY. Additive only. NOT EXISTS-guarded in the style of 032:189-208, so
-- re-running is inert. Default org only. No PII. Nothing is deleted, nothing is
-- revoked, no existing row is rewritten. Editing 032 instead would have been a
-- silent no-op (CLAUDE.md §12 — migrate.mjs keys schema_migrations by
-- '<dir>/<file>'), which is why this is a new file.
--
-- COMPLIANCE REVIEW REQUIRED: this decides what a payment entitles a client to.

-- ---------------------------------------------------------------------------
-- 1. The sixth entitlement code.
--
-- public/app/client-portal.html:605 ships a real tile,
--   <article class="tile locked" data-tile="FUNDING_MASTERY">
-- and the MAP entry for it is null (:1332), so paintTile always takes the
-- "no code" branch (:1736-1740) and the tile can NEVER open — not "is locked
-- until paid", but cannot open at all. The catalog has five codes; the portal
-- paints six tiles.
--
-- A code has to exist before that can ever be fixed, and naming it is not an
-- offer decision: the name is copied verbatim from the shipped offer
-- (src/config/offers.mjs FUNDING_MASTERY.name) and the code is its slug.
-- sort_order 60 continues 032's 10..50 sequence.
--
-- THIS ALONE DOES NOT OPEN THE TILE. public/app/client-portal.html is owned by
-- another workstream; until MAP's `FUNDING_MASTERY: null` becomes this code, the
-- tile stays shut. No product maps to it either — FUNDING_MASTERY has no
-- products row (015 has five codes, none of them a course).
INSERT INTO entitlement_catalog (org_id, code, name, description, kind, sort_order)
SELECT o.id, v.code, v.name, v.description, 'deliverable', v.sort_order
  FROM orgs o
  CROSS JOIN (VALUES
    ('funding-mastery-course', 'Funding Mastery course (A to Z)',
     'The A-to-Z funding course. Sold as the FUNDING_MASTERY offer (src/config/offers.mjs). Code added so the shipped portal tile has something to gate on.', 60)
  ) AS v(code, name, description, sort_order)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM entitlement_catalog ec
      WHERE ec.org_id = o.id AND ec.code = v.code
   );

-- ---------------------------------------------------------------------------
-- 2. The mapping. Four rows, each with its chain in the header above.
INSERT INTO product_entitlements (org_id, product_code, entitlement_code, duration_days)
SELECT o.id, v.product_code, v.entitlement_code, NULL::integer
  FROM orgs o
  CROSS JOIN (VALUES
    ('diagnostic',         'credit-analysis-report'),
    ('card-stacking-dfy',  'funding-snapshot'),
    ('repair-bundle',      'metro2-letter-pack'),
    ('consulting-package', 'metro2-letter-pack')
  ) AS v(product_code, entitlement_code)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM product_entitlements pe
      WHERE pe.org_id = o.id
        AND lower(btrim(pe.product_code)) = v.product_code
        AND pe.entitlement_code = v.entitlement_code
   )
   -- Never map to a code the catalog does not hold: a grant of an uncatalogued
   -- code renders nowhere and reads as a silent success.
   AND EXISTS (
     SELECT 1 FROM entitlement_catalog ec
      WHERE ec.org_id = o.id AND ec.code = v.entitlement_code
   )
   -- Never map a product this org does not sell.
   AND EXISTS (
     SELECT 1 FROM products p
      WHERE p.org_id = o.id AND lower(btrim(p.code)) = v.product_code
   );
