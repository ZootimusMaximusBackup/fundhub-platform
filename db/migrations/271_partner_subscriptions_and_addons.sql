-- 271_partner_subscriptions_and_addons.sql — let a PARTNER hold a subscription,
-- and put the three white-label add-ons in `products`.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): this file records a recurring price
-- and the cadence money is asked for. The prices are owner-set (2026-08-31,
-- docs/specs/W0-decisions.md + the pricing run that closed W6's open prices).
-- The label is a marker, not a request to revisit the decision.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS EXISTS
--
-- docs/specs/W6-pricing-menu.md sells three monthly/per-unit add-ons to a
-- WHITE-LABEL PARTNER. `subscriptions` (075_subscriptions.sql) is the only
-- recurring-arrangement table in this schema, and its `client_id` is
--     NOT NULL REFERENCES clients(id)
-- A partner is not a client, so today a partner add-on cannot be recorded at
-- all — not wrongly, not at all. W6 names three ways out and recommends the
-- first; this is that one:
--
--   1. a nullable partner_id on `subscriptions` + exactly-one check   <- HERE
--   2. a parallel partner_subscriptions table — duplicates the no-overlap and
--      immutability triggers, which is the divergence that rots
--   3. partners as `clients` rows — pollutes every client-scoped query
--
-- 265_cards_partner_rail.sql already did precisely this to `cards` (add
-- partner_id, drop NOT NULL on client_id, XOR check). This file follows that
-- shape deliberately rather than inventing a second one.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE PART THAT IS EASY TO GET WRONG: THE NO-OVERLAP CONSTRAINT
--
-- 075 carries `subscriptions_no_overlap`, an EXCLUDE constraint keyed on
-- (org_id, client_id, tstzrange(effective_from, effective_to)). It is what makes
-- the version chain a chain rather than a pile: without it a double-submitted
-- upgrade writes two open rows, both look live, and the client is billed twice.
--
-- POSTGRES SKIPS AN EXCLUSION CHECK WHEN AN INDEXED VALUE IS NULL. A partner row
-- has client_id NULL, so every partner row slides past that constraint without
-- being compared to anything. Left there, two live subscriptions for the same
-- partner and the same add-on become possible and nothing complains — the exact
-- double-billing hole the client side is protected from.
--
-- So `subscriptions_partner_no_overlap` below covers the partner rows. Note two
-- decisions inside it:
--
--   * `subscriptions_no_overlap` IS NOT TOUCHED. It needs no WHERE clause added
--     and no rebuild: NULL client_id already makes it inert for partner rows,
--     and every client row still meets it exactly as before. Dropping and
--     re-adding a live exclusion constraint to add a redundant predicate is
--     risk with no return.
--
--   * THE PARTNER KEY CARRIES THE ADD-ON (`tier`), THE CLIENT KEY DOES NOT.
--     075's own header settles this: "THIS SAYS ONE SUBSCRIPTION PER CLIENT AT A
--     TIME ... If a client ever needs two concurrent subscriptions the key gains
--     a column (a product, a rail) — it does not get dropped, because dropping
--     it re-opens the double-billing case." A partner needs exactly that: W6's
--     menu is "monthly, stack freely, cancel freely", three independent add-ons,
--     and its worked example has one partner holding all three in the same
--     month. So the key gains the column, as 075 instructed, and what stays
--     impossible is the thing that bills twice — two live rows for the SAME
--     partner and the SAME add-on. `lower(btrim(tier))` is in the key rather
--     than raw `tier` so 'Lead Flow' and 'lead-flow  ' cannot both be live.
--
--     The client half is unchanged. One subscription per client at a time still
--     holds, because nothing here alters that constraint.
--
--
-- THE OTHER TWO GUARANTEES 075 MAKES, AND HOW THEY HOLD FOR A PARTNER ROW
--
--   trg_subscriptions_terms_immutable — freezes tier, price_cents, currency,
--     effective_from, org_id and client_id on a live row, so a plan change must
--     close the row and open a new one instead of restating history. It did not
--     know about partner_id, which would have left a partner subscription
--     movable to a different partner by UPDATE. The function is redefined below
--     with partner_id added to the same check. Everything else is 075's body,
--     unchanged.
--
--   subscriptions_card_fk (added by 076_client_cards.sql) — FOREIGN KEY
--     (card_id, client_id) REFERENCES client_cards (id, client_id). A composite
--     foreign key with a NULL column is NOT CHECKED (MATCH SIMPLE), so on a
--     partner row card_id would point anywhere it liked, including at another
--     client's stored instrument. There is no partner card table in this
--     repository — `client_cards` is client-scoped and 265's `cards` is the
--     pipeline board, not an instrument — so the honest state today is that a
--     partner subscription has no card. `subscriptions_partner_card_chk` says
--     that out loud instead of leaving the hole open.
--     TO UNDO IT LATER: when a partner instrument table exists, drop this check
--     in a NEW migration and add the matching composite FK for partner rows.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
-- 1. IT DOES NOT CHARGE ANYTHING. Same as 075: no scheduler, no processor call,
--    no next_charge_at. W6 flags this itself — "Recording a subscription and
--    collecting money monthly are different things ... a partner can be marked
--    active on a plan that never bills." Recording the arrangement is what this
--    file makes possible. Collecting is a payment-rail change and is not here.
--
-- 2. IT DOES NOT REGISTER THE ADD-ONS IN `entitlement_catalog`, AND THAT IS A
--    FINDING, NOT AN OMISSION. That table is the CLIENT deliverable catalogue:
--    `entitlements.client_id` is NOT NULL REFERENCES clients(id),
--    src/entitlements/entitlements.mjs reads it as forClient(db,{orgId,clientId}),
--    and 171_content.sql documents display_price_cents as "Price shown on the
--    locked tile in the client portal". A partner cannot hold a row in it.
--    Adding three rows anyway would also break a shipped test that pins the
--    catalogue to exactly the six client deliverables the portal renders, all of
--    kind 'deliverable' (src/entitlements/entitlements.pg.test.mjs — "the
--    catalog holds a code for every deliverable tile the portal renders", and
--    the locked-tile counts of 6 / 5 / 4 below it). Partner entitlements need a
--    partner-scoped grant rail that does not exist yet; inventing one here would
--    decide a product question in a migration. Recorded, not filled in.
--
--    For the same reason there is no `product_entitlements` row for these three:
--    a mapping can only point at a catalogue code, and there is none to point at.
--
-- 3. IT DOES NOT WRITE ANY partner_revenue ROW, AND MUST NEVER CAUSE ONE. These
--    three add-ons are FundHub revenue. `products.category` is 'partner_service',
--    which is not 'funding' and not 'repair', so they sit outside
--    FUNDING_PRODUCT_CODES / REPAIR_PRODUCT_CODES in
--    src/affiliates/economics.mjs, outside the funding/repair boards in
--    src/handlers/purchase-routing.mjs, and outside money-chain's last-resort
--    clause that attaches an unmatched payment to a 'funding' sale
--    (src/handlers/money-chain.mjs). W1-money-model.md §2 requires the partner
--    share to run off an ALLOW-LIST of service codes; these codes must not be
--    added to it.
--
-- SAFETY. Additive and idempotent. No DELETE, no UPDATE of an existing row, no
-- data removed, nothing revoked. Editing 075 or 181 instead would have been a
-- silent no-op — db/migrate.mjs keys schema_migrations by '<dir>/<file>'
-- (CLAUDE.md §12) — which is why this is a new file.

-- ---------------------------------------------------------------------------
-- 1. A partner may hold a subscription.
-- ---------------------------------------------------------------------------
-- ON DELETE CASCADE matches `client_id` on this same table (075) and
-- `partner_id` on `cards` (265). Consistency inside the table wins over a
-- private preference; partners are retired by status, not deleted.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;

ALTER TABLE subscriptions
  ALTER COLUMN client_id DROP NOT NULL;

-- Exactly one owner. Not both — a subscription billed to a partner and a client
-- at once has no answer to "whose money is this". Not neither — an orphan row
-- bills nobody and reads as live.
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_client_or_partner_chk;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_client_or_partner_chk
  CHECK (
    (client_id IS NOT NULL AND partner_id IS NULL)
    OR (client_id IS NULL AND partner_id IS NOT NULL)
  );

-- See the header: a composite FK with a NULL column is not enforced, so without
-- this a partner row could point at any client's stored card.
ALTER TABLE subscriptions
  DROP CONSTRAINT IF EXISTS subscriptions_partner_card_chk;

ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_partner_card_chk
  CHECK (partner_id IS NULL OR card_id IS NULL);

-- ---------------------------------------------------------------------------
-- 2. No partner may hold two live versions of the SAME add-on.
--
-- btree_gist is already installed by 075; the guard keeps a standalone run of
-- this file honest.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'subscriptions_partner_no_overlap'
  ) THEN
    ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_partner_no_overlap
      EXCLUDE USING gist (
        org_id     WITH =,
        partner_id WITH =,
        (lower(btrim(tier))) WITH =,
        tstzrange(effective_from, effective_to, '[)') WITH &&
      ) WHERE (partner_id IS NOT NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The reads a partner screen makes, mirroring 075's client indexes.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS subscriptions_partner_idx
  ON subscriptions (org_id, partner_id, effective_from DESC)
  WHERE partner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_partner_live_idx
  ON subscriptions (org_id, partner_id)
  WHERE partner_id IS NOT NULL AND effective_to IS NULL;

-- ---------------------------------------------------------------------------
-- 4. partner_id is a term, and terms are frozen.
--
-- 075's body verbatim, with partner_id added to the identity check. Replacing
-- the function is enough — trg_subscriptions_terms_immutable already binds it
-- by name.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION subscriptions_terms_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id THEN
    RAISE EXCEPTION
      'subscriptions %: org_id, client_id and partner_id are immutable — a subscription cannot be moved to another client, partner or org',
      OLD.id;
  END IF;

  IF NEW.tier IS DISTINCT FROM OLD.tier
     OR NEW.price_cents IS DISTINCT FROM OLD.price_cents
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
    RAISE EXCEPTION
      'subscriptions %: tier, price and effective_from are immutable — close this row (effective_to) and INSERT the new terms',
      OLD.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN subscriptions.partner_id IS
  'The white-label partner this arrangement belongs to. Exactly one of client_id / partner_id is set. `tier` carries the add-on''s products.code.';

-- ---------------------------------------------------------------------------
-- 5. The three add-ons, as products.
--
-- WHY products AND NOT A NEW TABLE: 010_products.sql is already the record of
-- "what we sell", `code` is the durable handle src/config/offers.mjs points at
-- (Offer.productCode), and 181_offer_prices_and_trial_product.sql set the
-- precedent of seeding a product whose price the owner had just fixed. An offer
-- naming a products.code that does not exist is a dangling reference: a payment
-- link built from it cannot be matched back to anything.
--
-- price_is_variable IS FALSE ON THE TWO MONTHLY ONES. 181 made everything except
-- the soft pull variable because the owner said every other price is set per
-- client at sale time. That rule is about CLIENT offers sold by a closer. These
-- three are a published partner menu at one owner-set price, so the price is not
-- the closer's to move.
--
-- LEAD FLOW IS THE EXCEPTION: its UNIT price is locked at $99, but what is
-- charged is $99 x booked calls, so the amount on a sale genuinely varies.
-- price_is_variable stays true for it and default_price is the unit price.
--
-- default_success_fee_percent is NULL on all three: there is no success fee on
-- an add-on. NULL is the same not-applicable value 181 wrote for repair-trial
-- and funding-mastery.
--
-- category 'partner_service' is new and deliberate — see note 3 in the header.
-- 010_products.sql leaves category free text with no CHECK for exactly this.
-- ---------------------------------------------------------------------------
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
      'creative-intelligence', 'Creative Intelligence',
      'White-label partner add-on. Hooks written for the partner''s offer, their segment assigned so partners do not bid against each other, the Winner''s Board, and their own performance data read back to them.',
      'partner_service',
      297.00, NULL::numeric(14,2), NULL::numeric(14,2), false,
      NULL::numeric, 70,
      'Owner-set 2026-08-31: $297/month. Billed monthly to a PARTNER, never to a client. '
      'Recorded as a subscriptions row with partner_id set and tier = this code. '
      'FundHub revenue: never on the partner accrual allow-list, never a partner_revenue row.'
    ),
    (
      'dfy-marketing', 'Done-For-You Marketing',
      'White-label partner add-on. FundHub builds the creative, runs the campaigns and manages the ad account. The partner still funds their own ad spend, which never touches FundHub''s books.',
      'partner_service',
      2497.00, NULL::numeric(14,2), NULL::numeric(14,2), false,
      NULL::numeric, 80,
      'Owner-set 2026-08-31: $2,497/month PLUS the partner''s own ad spend, which is not billed here. '
      'Billed monthly to a PARTNER. This is the add-on that turns on FundHub creative sign-off '
      '(docs/specs/W0-decisions.md). FundHub revenue: never a partner_revenue row.'
    ),
    (
      'lead-flow', 'Lead Flow',
      'White-label partner add-on. Booked, screened calls with business owners handed to the partner. Priced per booked call, not monthly.',
      'partner_service',
      99.00, NULL::numeric(14,2), NULL::numeric(14,2), true,
      NULL::numeric, 90,
      'Owner-set 2026-08-31: $99 PER BOOKED CALL. default_price is the unit price; '
      'price_is_variable stays true because the amount on a sale is $99 x calls delivered. '
      'FundHub revenue: never a partner_revenue row.'
    )
  ) AS v(code, name, description, category,
         default_price, min_price, max_price, price_is_variable,
         success_fee, sort_order, notes)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM products p WHERE p.org_id = o.id AND lower(p.code) = v.code
   )
   -- products carries a unique index on (org_id, lower(name)) as well as on
   -- (org_id, lower(code)); a re-run against an org that already named one of
   -- these something else must not raise.
   AND NOT EXISTS (
     SELECT 1 FROM products p WHERE p.org_id = o.id AND lower(p.name) = lower(v.name)
   );
