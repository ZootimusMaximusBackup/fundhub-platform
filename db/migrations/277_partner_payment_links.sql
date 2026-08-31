-- 277_partner_payment_links.sql — a payment link may ask a PARTNER for money.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): payment rails. This file changes
-- who a payment ask can be addressed to. It moves no money, mints no link and
-- charges nothing; the ask is still a URL a human clicks.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
--
-- 271_partner_subscriptions_and_addons.sql let a white-label PARTNER hold a
-- subscription and put the three W6 add-ons in `products`. Nothing creates one.
-- The purchase path a partner actually walks is:
--
--   pick an add-on  →  a checkout link  →  they pay  →  a subscription row
--
-- and it stops dead at step two, because `payment_links.client_id` is
--     NOT NULL REFERENCES clients(id)                     (119_payment_links.sql)
-- A partner is not a client (042_partners.sql says so at length: an affiliate
-- refers fundhub's client, a partner runs their own book), so today the ask
-- cannot be recorded at all.
--
-- The alternative was a second table — partner_addon_orders — and with it a
-- second mint path, a second settle path and a second thing the Commas webhook
-- has to know about. src/payment-links/index.mjs is the ONLY module in this
-- repository that mints a checkout URL and records the ask, and
-- src/handlers/payment-links.mjs settles it by `link_ref` without ever reading
-- client_id. Duplicating both to avoid one nullable column is how two payment
-- paths drift apart and only one of them gets the next fix.
--
-- So this follows the shape 265_cards_partner_rail.sql and 271 already set on
-- this exact problem: add partner_id, drop NOT NULL on client_id, and make
-- exactly-one-owner a CHECK. Third time deliberately, not a new idea.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT A NULL client_id CANNOT BREAK, CHECKED READER BY READER
--
-- Every module that reads this table was read before this column was made
-- nullable. None of them dereferences client_id without a guard:
--
--   src/handlers/payment-links.mjs   settles by link_ref / commas_session_id.
--                                    Never mentions client_id. A partner link
--                                    reaches 'paid' by the same path.
--   src/adapters/commas.mjs          loadPaymentLink() selects pl.client_id and
--                                    resolveInboxClientId() guards it with
--                                    `if (link && link.client_id)`. A partner
--                                    link falls through, which is right.
--   src/handlers/money-chain.mjs     its payment_links lookup is
--                                    `WHERE id = $1 AND org_id = $2 AND
--                                    client_id = $3`. A partner link matches
--                                    nothing, so it returns
--                                    'payment_link_context_conflict' and writes
--                                    NOTHING. That is the correct outcome: an
--                                    add-on is FundHub revenue and must never
--                                    become a client sale or a partner_revenue
--                                    accrual (271's note 3, W1 §2).
--   src/fulfillment/read-signals.mjs, src/workflows/s-offer-bucket.mjs,
--   src/staff/comp-alerts.mjs, src/invoices/allocate.mjs
--                                    all filter BY a client id that is supplied
--                                    to them, so a NULL row is invisible to
--                                    every one of them.
--
-- The one honest gap, recorded rather than papered over: if a Commas webhook
-- for a partner add-on carries a payer email that matches an existing client,
-- resolveInboxClientId's third fallback (email) can still attribute that
-- payment to that client. The link row is correctly partner-owned and
-- money-chain still refuses it, but the inbox row is not partner-aware. Fixing
-- that is a change to src/adapters/commas.mjs, which this unit does not own.
--
--
-- SAFETY. Additive and idempotent. Nothing is deleted, nothing is updated, no
-- existing row is touched, and no constraint that held before holds any less
-- for a client row. Editing 119 instead would have been a silent no-op —
-- db/migrate.mjs keys schema_migrations by '<dir>/<file>' (CLAUDE.md §12).

-- ---------------------------------------------------------------------------
-- 1. A payment link may be addressed to a partner.
-- ---------------------------------------------------------------------------
-- ON DELETE CASCADE matches partner_id on `cards` (265) and on `subscriptions`
-- (271). Consistency inside the schema beats a private preference; partners are
-- retired by status, never deleted.
ALTER TABLE payment_links
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;

ALTER TABLE payment_links
  ALTER COLUMN client_id DROP NOT NULL;

-- Exactly one owner. Not both — an ask addressed to a client and a partner at
-- once has no answer to "whose money is this". Not neither — an orphan ask
-- names nobody and still displays a live payable URL.
ALTER TABLE payment_links
  DROP CONSTRAINT IF EXISTS payment_links_client_or_partner_chk;

ALTER TABLE payment_links
  ADD CONSTRAINT payment_links_client_or_partner_chk
  CHECK (
    (client_id IS NOT NULL AND partner_id IS NULL)
    OR (client_id IS NULL AND partner_id IS NOT NULL)
  );

-- A partner ask is never a client sale. `sales.client_id` is NOT NULL, so a
-- sale_id on a partner row could only ever point at somebody else's sale, and
-- 247's payment_links_motion_product_ck already ties sale_motion to a product.
-- Said out loud here rather than left to be discovered.
ALTER TABLE payment_links
  DROP CONSTRAINT IF EXISTS payment_links_partner_no_sale_chk;

ALTER TABLE payment_links
  ADD CONSTRAINT payment_links_partner_no_sale_chk
  CHECK (partner_id IS NULL OR (sale_id IS NULL AND sale_motion IS NULL AND invoice_id IS NULL));

-- ---------------------------------------------------------------------------
-- 2. The read a partner add-on screen makes.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS payment_links_partner_idx
  ON payment_links (org_id, partner_id, created_at DESC)
  WHERE partner_id IS NOT NULL;

COMMENT ON COLUMN payment_links.partner_id IS
  'The white-label partner this ask is addressed to. Exactly one of client_id / partner_id is set. Set only by the partner add-on purchase path (src/subscriptions/partner-addons.mjs).';
