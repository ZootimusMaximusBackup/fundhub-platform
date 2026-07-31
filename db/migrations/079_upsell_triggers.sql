-- 079_upsell_triggers.sql — a detected opportunity to offer a client something,
-- and what happened when we did.
--
-- WHY THIS IS A SEPARATE TABLE FROM `alerts` (078). They look alike and they are
-- not the same thing. An alert is a fact about the client's own file that a
-- human should look at. An upsell trigger is a SALES OPPORTUNITY, and it carries
-- an outcome — presented, accepted, declined — that an alert has no concept of.
-- Merging them would mean a screen that lists "things wrong with your credit"
-- would also list "things we want to sell you", and one of those two lists is
-- allowed to be shown to the client.
--
-- *** COMPLIANCE: THIS TABLE IS INTERNAL. *** A row here is our commercial
-- judgement, not the client's data. `rationale` is written for a salesperson and
-- must never be rendered to a consumer, because "this client looks squeezed
-- enough to buy" is not a sentence anyone should read about themselves. Nothing
-- here may state or imply what a purchase would do to a credit score — no claim
-- about credit outcomes, ever, which is the same rule the whole repo runs under.
--
-- CONFIDENCE IS STORED AND IS ALLOWED TO BE LOW. The detectors are heuristics
-- over incomplete data — a client with two known cards out of nine looks very
-- different from one whose file is complete. A trigger whose confidence is 0.2
-- is a guess and must be presented as a guess. There is no threshold in this
-- schema that hides low-confidence rows, deliberately: hiding them would let a
-- reader assume everything they can see is solid.
--
-- NOTHING HERE CONTACTS ANYBODY. No campaign, no send, no scheduler. Detecting
-- an opportunity and acting on one are different jobs and only the first exists.

CREATE TABLE IF NOT EXISTS upsell_triggers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),
  client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- What was detected. Free text for the same reason alerts.kind is: a new
  -- detector must not need a migration to exist. The emitted vocabulary lives in
  -- src/alerts/evaluate.mjs.
  trigger_kind text NOT NULL,

  -- What we would offer. NULLABLE and NOT a required link: a detector can spot
  -- that a client is a candidate for "a higher-limit card" long before anybody
  -- decides which catalog product that is, and refusing the row until the
  -- catalog catches up would lose the opportunity rather than fix the catalog.
  product_id   uuid REFERENCES products(id),

  --   new       — detected, nobody has acted
  --   presented — offered to the client
  --   accepted  — they took it
  --   declined  — they said no
  --   expired   — the condition that produced it no longer holds
  status       text NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'presented', 'accepted', 'declined', 'expired')),

  -- 0..1. How much the detector trusts its own finding, given how much of the
  -- client's file it could actually see. NULL means the detector did not express
  -- one — which is different from 0 (certain it is a bad fit) and must not be
  -- rendered as 0 or as 100%.
  confidence   numeric(4,3) CHECK (confidence >= 0 AND confidence <= 1),

  -- Written for a salesperson. INTERNAL ONLY — see the header.
  rationale    text,

  -- The numbers behind the detection, same job as alerts.evidence: a trigger
  -- nobody can check is a trigger nobody should act on.
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,

  dedupe_key   text,

  detected_at  timestamptz NOT NULL DEFAULT now(),
  presented_at timestamptz,
  resolved_at  timestamptz,

  -- Who offered it. NULL while nobody has.
  presented_by uuid REFERENCES staff(id),

  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One live opportunity per (client, kind, dedupe_key). Live means still
-- actionable; a declined or expired trigger does not block the same opportunity
-- being detected again later, because circumstances change and a second look is
-- a real event.
CREATE UNIQUE INDEX IF NOT EXISTS uq_upsell_triggers_live_dedupe
  ON upsell_triggers (client_id, trigger_kind, dedupe_key)
  WHERE dedupe_key IS NOT NULL AND status IN ('new', 'presented');

CREATE INDEX IF NOT EXISTS idx_upsell_triggers_client
  ON upsell_triggers (client_id, detected_at DESC);

-- The sales queue: everything still actionable in the org, newest first.
CREATE INDEX IF NOT EXISTS idx_upsell_triggers_org_open
  ON upsell_triggers (org_id, detected_at DESC) WHERE status IN ('new', 'presented');

-- A presented trigger must say when it was presented. Without this, "we offered
-- it" is unfalsifiable, and the accepted/declined counts below it mean nothing.
ALTER TABLE upsell_triggers DROP CONSTRAINT IF EXISTS upsell_triggers_presented_timestamp;
ALTER TABLE upsell_triggers ADD CONSTRAINT upsell_triggers_presented_timestamp
  CHECK (status NOT IN ('presented', 'accepted', 'declined') OR presented_at IS NOT NULL);

COMMENT ON TABLE upsell_triggers IS
  'Detected sales opportunities and their outcome. INTERNAL — rationale is written for a salesperson and must never be shown to a consumer. Separate from alerts (078) because an alert is a fact about the client file and this is our commercial judgement, and only one of those may be shown to the client. NOTHING HERE CONTACTS ANYBODY. See db/migrations/079_upsell_triggers.sql.';

COMMENT ON COLUMN upsell_triggers.confidence IS
  '0..1, how much the detector trusts itself given how much of the file it could see. NULL = not expressed, which is NOT 0 and NOT certainty. Low-confidence rows are deliberately not hidden by this schema — hiding them would let a reader assume everything visible is solid.';

COMMENT ON COLUMN upsell_triggers.product_id IS
  'Nullable on purpose: a detector can spot a candidate before anybody decides which catalog product fits. Refusing the row until the catalog catches up loses the opportunity instead of fixing the catalog.';
