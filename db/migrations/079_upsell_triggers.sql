-- 079_upsell_triggers.sql — a recorded opportunity: this client's own numbers
-- suggest a product conversation, and here is exactly which numbers.
--
-- WHY THIS IS A SEPARATE TABLE FROM `alerts` (078), WHICH LOOKS ALMOST THE SAME.
-- An alert is a problem: something crossed a line and somebody should act. An
-- upsell is a sales opportunity: nothing is wrong, and somebody may make money.
-- Merging them would put "this client's card is at 94%" and "this client could
-- be sold an upgrade" in one queue with one status ladder — and the first time
-- somebody filtered that queue for a compliance question, they would be reading
-- sales prompts as risk signals. The two are also read by different people, kept
-- for different lengths of time, and answerable in different ways ('resolved'
-- versus 'accepted' / 'dismissed').
--
--
-- *** THE EVIDENCE COLUMN IS THE POINT, AND IT IS COMPLIANCE-SHAPED. ***
-- *** `evidence` records WHICH FACTS produced the suggestion. This is a
-- *** regulated consumer-finance product: a recommendation derived from a
-- *** consumer's credit file is not the same object as a recommendation derived
-- *** from what they told a closer on a call, and only one of them has FCRA
-- *** consequences attached. A row that says "suggest an upgrade" without saying
-- *** what it read cannot be reviewed at all.
-- ***
-- *** NOTHING HERE IS AN OFFER, and there is deliberately no column that could
-- *** become one — no rate, no limit, no approval amount, no expiry. A firm offer
-- *** of credit has legal requirements this table does not attempt to satisfy.
-- *** See 065_mail_campaigns.sql for the same boundary drawn around prescreen.
--
--
-- NO PRICE COLUMN, AND THAT IS NOT AN OVERSIGHT. What an upgrade costs is a
-- price, prices are rows (013_commission_rules.sql:1), and there is no tier or
-- upgrade price anywhere in this repository to point at. A price on this row
-- would be a number invented at suggestion time and quoted to a client later.
-- The product conversation names the price from wherever prices eventually live.
--
--
-- WHAT WAS DELIBERATELY NOT DONE (1): NOTHING IS SENT AND NOTHING IS SHOWN. No
-- scheduler, no message, no client-facing copy column. This is an internal
-- record that a conversation might be worth having.
--
-- WHAT WAS DELIBERATELY NOT DONE (2): NO SCORING OR RANKING. No `confidence`, no
-- `priority`, no expected-value column. Any such number would be invented — no
-- model, no historical conversion data, and nothing in this repo to calibrate
-- against. An invented confidence is worse than none: it gets sorted on.
--
-- WHAT WAS DELIBERATELY NOT DONE (3): NO PRODUCT FOREIGN KEY. `products` (010)
-- models one-off purchases; a "card upgrade" is not one of its rows, and
-- pointing at the nearest one would file the suggestion under a product nobody
-- is actually suggesting.

CREATE TABLE IF NOT EXISTS upsell_triggers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- One kind, because one evaluator exists (suggestCardUpgrade in
  -- src/alerts/index.mjs). The CHECK grows when an evaluator does; a kind with
  -- no evaluator behind it is a word.
  kind         text NOT NULL CHECK (kind IN ('card_upgrade')),

  --   suggested — raised, nobody has decided.
  --   accepted  — somebody acted on it.
  --   dismissed — somebody looked and said no. Kept, not deleted: "we already
  --               asked and they said no" is the single most useful thing to
  --               know before asking again.
  status       text NOT NULL DEFAULT 'suggested'
               CHECK (status IN ('suggested', 'accepted', 'dismissed')),

  -- Why, in words, for the human who picks this up. Required and non-empty: a
  -- suggestion nobody can explain is a suggestion nobody should act on.
  rationale    text NOT NULL CHECK (btrim(rationale) <> ''),

  -- WHICH FACTS produced it. See the flag above.
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- What makes two evaluations the same suggestion.
  dedupe_key   text NOT NULL CHECK (btrim(dedupe_key) <> ''),

  suggested_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  -- Who decided. NULL while undecided; NULL after an automated decision is not
  -- a case that exists, because nothing here decides on its own.
  decided_by_staff_id uuid REFERENCES staff(id),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  -- Decided means dated, in both directions. A dismissed row with no decision
  -- date cannot answer "when did we last ask", which is the whole reason a
  -- dismissal is kept.
  CONSTRAINT upsell_triggers_decided_coherent CHECK (
    (status = 'suggested') = (decided_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS upsell_triggers_client_idx
  ON upsell_triggers (org_id, client_id, suggested_at DESC);

-- The sales queue: what has been raised and not yet answered.
CREATE INDEX IF NOT EXISTS upsell_triggers_open_idx
  ON upsell_triggers (org_id, suggested_at)
  WHERE status = 'suggested';

-- One live suggestion per subject, so a nightly re-evaluation does not stack
-- copies. A DISMISSED one does not block a new one — circumstances change, and
-- the dismissal is still on the record for whoever asks again. Per-org.
CREATE UNIQUE INDEX IF NOT EXISTS upsell_triggers_open_dedupe_uq
  ON upsell_triggers (org_id, client_id, dedupe_key)
  WHERE status = 'suggested';

DROP TRIGGER IF EXISTS trg_upsell_triggers_updated ON upsell_triggers;
CREATE TRIGGER trg_upsell_triggers_updated BEFORE UPDATE ON upsell_triggers
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
