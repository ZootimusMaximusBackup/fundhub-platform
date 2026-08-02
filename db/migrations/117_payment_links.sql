-- 117_payment_links.sql — staff-initiated Commas checkout links.
--
-- Distinct from `invoices` (017/031): an invoice records money OWED on the AR
-- ladder (draft/sent/paid/overdue/void) and can be raised without a payment
-- link ever existing. A payment_links row records ONE checkout link a member
-- of staff handed to a client for a specific amount, and its lifecycle is the
-- link's own: created -> sent -> paid, or -> expired / void. Nothing here
-- reads or writes `invoices` — if the two need to be reconciled later, that is
-- a deliberate decision with its own migration, not assumed here.
--
-- `transactions` (src/handlers/client-lifecycle.mjs onPaymentReceived) already
-- records every Commas payment.received as money-in, keyed by the processor's
-- own event id. This table is upstream of that: it is the ASK, not the
-- receipt. A row here reaching 'paid' means the matching transaction exists;
-- the reverse is not true, because a client can pay without ever having been
-- sent a link from this screen.
--
-- ── HOW A WEBHOOK FINDS ITS ROW BACK ─────────────────────────────────────────
-- src/adapters/commas.mjs's own header already carries a CONFIRM banner: its
-- field paths are written from documentation, not an observed payload, same as
-- bland/clickfunnels/lendflow. This table adds one more field to that same
-- unconfirmed surface: `link_ref`, an opaque token this system mints and
-- embeds in the checkout URL as a query parameter, which a real Commas
-- checkout is assumed to echo back on the webhook (as a client-reference/
-- metadata field — see normalizeCommasEvent's `ref` extraction). That
-- assumption is unverified against a live Commas sandbox, same as every other
-- field path in that adapter, and is called out again in
-- docs/PAYMENT-LINKS-SPEC.md. Until it is confirmed, a webhook that does not
-- echo the ref back leaves this row at 'sent' forever with no automatic path
-- to 'paid' — an honest stuck state, not a silent wrong one.

CREATE TABLE payment_links (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES orgs(id),
  client_id            uuid NOT NULL REFERENCES clients(id),

  purpose              text NOT NULL
    CHECK (purpose IN ('deposit', 'diagnostic', 'repair', 'custom')),
  description          text,
  amount_cents         bigint NOT NULL CHECK (amount_cents > 0),
  currency             text NOT NULL DEFAULT 'USD',

  status               text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'sent', 'paid', 'expired', 'void')),

  -- The opaque reference minted at creation and embedded in checkout_url; see
  -- header. Globally unique (not just per-org) because it is also the value we
  -- search the inbound webhook payload for, with no org context available at
  -- that point in the adapter.
  link_ref             text NOT NULL UNIQUE,
  checkout_url         text NOT NULL,

  provider             text NOT NULL DEFAULT 'commas',
  -- Filled only once paid, from the webhook's own event id (evt.id in
  -- commas.mjs) — the same value recorded as transactions.provider_ref.
  commas_session_id    text,
  -- What the webhook actually reported as paid. Can differ from amount_cents
  -- (a client paying a different amount than asked) and is recorded
  -- separately rather than overwriting the requested amount — the ask and the
  -- receipt are different facts.
  paid_amount_cents    bigint,

  created_by_staff_id  uuid REFERENCES staff(id) ON DELETE SET NULL,

  created_at           timestamptz NOT NULL DEFAULT now(),
  sent_at              timestamptz,
  paid_at              timestamptz,
  expired_at           timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

-- A given Commas payment can settle at most one link. WHERE-guarded so
-- multiple never-paid rows (commas_session_id IS NULL) are unaffected.
CREATE UNIQUE INDEX payment_links_commas_session
  ON payment_links(provider, commas_session_id)
  WHERE commas_session_id IS NOT NULL;

CREATE INDEX idx_payment_links_org      ON payment_links(org_id);
CREATE INDEX idx_payment_links_client   ON payment_links(org_id, client_id);
CREATE INDEX idx_payment_links_status   ON payment_links(org_id, status);

CREATE TRIGGER payment_links_updated_at
  BEFORE UPDATE ON payment_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
