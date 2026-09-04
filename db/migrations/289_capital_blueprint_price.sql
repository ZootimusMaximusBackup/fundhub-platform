-- 289_capital_blueprint_price.sql — Capital Blueprint is $5,000, in the one place
-- the database still said $1,000.
--
-- OWNER-SET 2026-09-03. Chris's executed Capital Blueprint service agreement
-- states its own tuition twice (sections 1.3 and 5.1, "five thousand United
-- States dollars"), and it was seeded verbatim by 288_real_contract_text.sql.
-- The catalogue said $1,000. Asked which was right, Chris said the contract. So
-- src/config/offers.mjs UWIQ_DELIVERABLES.priceCents moved to 500000, and this
-- file moves the copy of that number that lives in the database.
--
-- WHY THIS FILE EXISTS AT ALL, given the catalogue is the source of truth.
-- products.default_price is the FALLBACK the money chain records a sale at when
-- a payment arrives carrying no amount of its own (src/handlers/money-chain.mjs
-- line ~235). A real Commas receipt always carries the amount, so this number is
-- rarely read — which is exactly why it sat at $1,000 unnoticed and would have
-- gone on recording a Blueprint sale at a fifth of its price on the one path
-- that reads it. A second copy of a price that nobody looks at is how the
-- original defect was written; leaving one behind while fixing it would be the
-- same mistake with a new number.
--
-- 015_seed_products.sql is NOT edited. It is applied everywhere already, so
-- editing it is a silent no-op (CLAUDE.md §12). Its comment stays true: this
-- product is still variable per client through the Commas custom-amount
-- checkout, and min/max are untouched. Only the default moves.
--
-- products.min_price and max_price are NULL on this row and stay NULL — 015 seeds
-- them that way because the amount is set per client at checkout. The $1,000
-- floor lives in src/config/offers.mjs as priceMinCents, and it stays there too:
-- it is what a closer may discount to on a custom-priced offer, not the list
-- price, and moving a floor is a second decision nobody has made.
--
-- IDEMPOTENT. Guarded on the old value, so running it twice is a no-op and a row
-- somebody has already repriced by hand on the Products screen is left alone.

BEGIN;

UPDATE products
   SET default_price = 5000.00,
       updated_at = now()
 WHERE code = 'consulting-package'
   AND default_price = 1000.00;

DO $notice$
DECLARE v numeric;
BEGIN
  SELECT default_price INTO v FROM products WHERE code = 'consulting-package' LIMIT 1;
  IF v IS NULL THEN
    RAISE NOTICE 'consulting-package has no default_price row to move';
  ELSIF v <> 5000.00 THEN
    RAISE NOTICE 'consulting-package default_price is % — left alone, it was not the $1,000 this file supersedes', v;
  END IF;
END $notice$;

COMMIT;
