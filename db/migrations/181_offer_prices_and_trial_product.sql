-- 181_offer_prices_and_trial_product.sql
--
-- COMPLIANCE REVIEW REQUIRED — this file sets the money a client is asked for.
--
-- OWNER-SET, 2026-08-18. Chris answered the two questions migration 180's header
-- and BLOCKERS.md #11 left open. Both answers are recorded here as fact, not as
-- a guess this migration made:
--
--   1. "The $200 trial delivers the same letter pack as the $1,000 repair DFY —
--      one round only."
--   2. "Soft pull is fixed at $32. Everything else is variable — set per client
--      by the closer at sale time. Defaults: $3,000 funding DFY + 10% success
--      fee · $1,000 repair DFY · $200 repair test run · $1,000 deliverables
--      package · $5,000 Funding Mastery. Build price as an editable field with
--      those defaults, not hardcoded."
--
-- WHY THIS TOUCHES `products` AND NOT A NEW TABLE. The editable-price-with-a-
-- default model the owner asked for ALREADY EXISTS and shipped in 015: products
-- carries default_price, min_price, max_price, price_is_variable and
-- default_success_fee_percent, and 015's own header says "what matters is
-- sales.agreed_price, set per client". So the default is data a human can edit,
-- the agreed number lives on the sale, and nothing here hardcodes a price into
-- application code. This file only brings that data in line with the answer
-- above and fills in the two products that were never seeded.
--
-- Editing an applied migration is a silent no-op (db/migrate.mjs keys
-- schema_migrations by '<dir>/<file>'), so 015 and 180 are left alone and this
-- supersedes them. Every statement is guarded and re-running is inert.

-- 1. Repair DFY is $1,000, not $2,000 -----------------------------------------
-- 015 seeded 2000.00 and src/config/offers.mjs has said 100000 cents ($1,000)
-- since it was written, so the database and the code have disagreed all along.
-- The owner's number is $1,000. Guarded on the stale value so this cannot
-- clobber a price somebody has since set by hand, and so re-running is inert.
-- Historical sales are untouched: an agreed price lives on sales.agreed_price.
UPDATE products
   SET default_price = 1000.00,
       updated_at    = now()
 WHERE code = 'repair-bundle'
   AND default_price = 2000.00;

-- 2. Only the soft pull is a fixed price --------------------------------------
-- "Everything else is variable" — make that true in the data rather than
-- assumed by a screen. diagnostic keeps price_is_variable=false so the sale form
-- locks it at $32; every other product is variable so the closer can set it.
UPDATE products
   SET price_is_variable = true,
       updated_at        = now()
 WHERE code <> 'diagnostic'
   AND price_is_variable = false;

UPDATE products
   SET price_is_variable = false,
       updated_at        = now()
 WHERE code = 'diagnostic'
   AND price_is_variable = true;

-- 3. The two products that were never seeded ----------------------------------
-- REPAIR TEST RUN ($200). T2-13 recorded that no $200 product existed at all,
-- so a $200 payment could not be matched to anything.
--
-- FUNDING MASTERY ($5,000). category is 'consulting', NOT 'funding', and that is
-- a deliberate choice worth reading before anyone "corrects" it: this is a
-- course, not a funding placement, AND src/handlers/money-chain.mjs has a
-- last-resort clause that attaches an otherwise-unmatched payment to the client's
-- most recent ACTIVE sale whose product category is 'funding'. Filing a $5,000
-- course under 'funding' would make it a magnet for unrelated payments and would
-- pay a funding commission on them.
INSERT INTO products (
  org_id, code, name, description, category,
  default_price, min_price, max_price, price_is_variable,
  default_success_fee_percent, sort_order, notes
)
SELECT o.id, v.code, v.name, v.description, v.category,
       v.default_price, v.min_price, v.max_price, v.price_is_variable,
       v.success_fee, v.sort_order, v.notes
  FROM orgs o
  CROSS JOIN (VALUES
    (
      'repair-trial', 'Repair Test Run',
      'First round of done-for-you credit repair, sold as a test run.',
      'repair',
      200.00, NULL::numeric(14,2), NULL::numeric(14,2), true,
      NULL::numeric, 45,
      'Owner-set 2026-08-18: delivers the SAME letter pack as repair-bundle, one round only. '
      'Nothing in the schema counts rounds — see the note on product_entitlements below.'
    ),
    (
      'funding-mastery', 'Funding Mastery Course',
      'Funding Mastery, A to Z. A course, not a funding placement.',
      'consulting',
      5000.00, NULL::numeric(14,2), NULL::numeric(14,2), true,
      NULL::numeric, 60,
      'category is consulting on purpose: money-chain attaches unmatched payments to the most '
      'recent active funding-category sale, and a course must not be that magnet.'
    )
  ) AS v(code, name, description, category,
         default_price, min_price, max_price, price_is_variable,
         success_fee, sort_order, notes)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM products p WHERE p.org_id = o.id AND p.code = v.code
   );

-- 4. What those two products unlock -------------------------------------------
-- repair-trial -> metro2-letter-pack is the owner's answer quoted at the top of
-- this file, and it is the SAME code repair-bundle grants. That is intended, not
-- the collision T2-14 reported: the trial delivers the same pack.
--
-- READ THIS BEFORE RELYING ON IT: "one round only" is NOT enforced anywhere. The
-- grant is identical, so once either product is paid, nothing in the schema or
-- the handlers distinguishes a one-round trial from the full package. Counting
-- rounds would need a mechanism that does not exist, and inventing one here
-- would decide a product question in a migration. Recorded as a gap.
--
-- funding-mastery -> funding-mastery-course is the sixth catalog code migration
-- 180 added for the tile that public/app/client-portal.html paints but maps to
-- null. The screen still maps it to null; until that one line changes (owned by
-- the client-portal thread) this grant is real but lights nothing.
INSERT INTO product_entitlements (org_id, product_code, entitlement_code)
SELECT o.id, v.product_code, v.entitlement_code
  FROM orgs o
  CROSS JOIN (VALUES
    ('repair-trial',    'metro2-letter-pack'),
    ('funding-mastery', 'funding-mastery-course')
  ) AS v(product_code, entitlement_code)
 WHERE o.is_default
   AND EXISTS (
     SELECT 1 FROM entitlement_catalog ec
      WHERE ec.org_id = o.id AND ec.code = v.entitlement_code
   )
   AND NOT EXISTS (
     SELECT 1 FROM product_entitlements pe
      WHERE pe.org_id = o.id
        AND pe.product_code = v.product_code
        AND pe.entitlement_code = v.entitlement_code
   );

-- 5. The one deliverable that has a fixed price -------------------------------
-- entitlement_catalog.display_price_cents was added by 171 and is NULL on every
-- row (T2-07). It is filled here for the soft-pull deliverable ONLY, because the
-- soft pull is the one thing the owner fixed at $32.
--
-- EVERY OTHER ROW IS LEFT NULL ON PURPOSE, and that is the fix, not a gap. The
-- owner's rule is that every other price is variable and set per client at sale
-- time. Stamping a single number onto a deliverable would show $1,000 to a
-- client who agreed $200 — a wrong price on a regulated consumer-finance
-- product. NULL here means "not a fixed price: read this client's
-- sales.agreed_price", and a screen that wants to show a price must read the
-- sale, not this column.
UPDATE entitlement_catalog
   SET display_price_cents = 3200,
       updated_at          = now()
 WHERE code = 'credit-analysis-report'
   AND display_price_cents IS NULL;
