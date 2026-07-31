-- 065_mail_campaigns.sql — the direct-mail pipeline's missing tables: a real
-- campaign row, a response log, and the tracked numbers a response arrives on.
--
-- *** THE GATE. NOTHING IN THIS FILE MAILS ANYTHING, AND NOTHING IN THIS FILE
-- *** CAN BE SWITCHED ON TO MAKE IT MAIL ANYTHING.
--
-- Prescreen data requires a firm offer of credit under the FCRA. No drop
-- happens until all three of these are true, and none of them are true today:
--   (a) the FCRA research report is in,
--   (b) Deluxe compliance has reviewed the mail piece AND the offer structure,
--   (c) a lawyer has signed off on the broker/lender-of-record structure.
-- THE BUILD IS NOT GATED, THE DROP IS. This migration ships the same way
-- `mail_universe` shipped in 001_init.sql — "scaffold now, activate after gate"
-- — which is to say: tables, constraints and indexes, and NO ACTIVATION PATH.
-- There is no scheduler here, no cron, no job row a worker polls, no send
-- function, no outbound anything, and deliberately no `enabled` / `active` /
-- `is_live` boolean that a future env var could flip. If wiring a drop path
-- looks like it needs one line in this file, it needs a lawyer first.
--
-- Note that even AFTER the gate lifts, this system still never transmits.
-- Deluxe physically prints and mails. The most this schema will ever do is
-- record that a drop happened somewhere else, which is why `dropped` below is
-- past tense and written after the fact.
--
--
-- WHY THIS EXISTS. `mail_universe` (001_init.sql:349) carries `campaign_id
-- text` with no table behind it and no foreign key to anything. Every record in
-- a drop of a hundred thousand pieces repeats a free-text string, and a
-- campaign therefore has no name, no drop date, no status and nowhere to hang
-- one. A typo in that string does not fail — it silently forks a campaign in
-- two, and the suppression gate then reads one half of it.
--
--
-- `public.campaigns` IS NOT THIS TABLE. `campaigns` (046_ad_platforms.sql:155)
-- is the local mirror of a PAID ADS object — Meta/TikTok/Google — and it
-- requires `partner_id` and `connection_id` NOT NULL against
-- `ad_platform_connections`. A direct-mail batch has no ad platform, no ad
-- account and no connection to mirror, so it cannot be represented there
-- without inventing a fake connection row. This is the same name-collision trap
-- 054_tradelines.sql documented for `cards`, and it is resolved the same way:
-- a distinctly named table rather than an overloaded one.
--
--
-- WHY THERE IS NO FOREIGN KEY ON mail_universe.campaign_id, WHICH IS THE MAIN
-- THING THIS FILE DELIBERATELY DOES NOT DO. The obvious move is to retype
-- `mail_universe.campaign_id` to uuid and point it at `mail_campaigns(id)`.
-- This migration does not do that, on purpose:
--
--   1. The column is TEXT TODAY AND MAY HOLD DATA. An ALTER ... TYPE uuid USING
--      campaign_id::uuid aborts the whole run the moment one row holds a string
--      that is not a uuid — and free-text campaign labels are exactly the sort
--      of thing that is not a uuid. A migration that breaks existing rows is
--      worse than a gap.
--   2. Even ADD CONSTRAINT ... FOREIGN KEY against a text key would validate
--      existing rows and fail for any campaign_id with no matching campaign.
--      NOT VALID would dodge that, but it would still reject future INSERTs,
--      which silently makes campaign-row-creation a prerequisite of ingestion
--      and breaks the ingestion thread rather than this one.
--
-- The linkage is therefore `mail_campaigns.campaign_key` — a text column unique
-- WITHIN AN ORG (uq_mail_campaigns_org_key), holding exactly the string that
-- appears in `mail_universe.campaign_id`. The join is
-- `mail_universe.campaign_id = mail_campaigns.campaign_key` AND matching
-- org_id — never the key alone, which does not identify a campaign. It is a
-- soft link and it is honest about being one. Tightening it to a real FK is a
-- later migration that must FIRST backfill a campaign row per distinct
-- campaign_id, THEN repoint, and it needs to see production data before anyone
-- writes it. Reported as a known gap rather than guessed at here.
--
--
-- THE LOG VERSUS THE LATEST STATE. `mail_universe.responded_at` and
-- `mail_universe.outcome_tier` already exist and are the DENORMALISED LATEST
-- STATE of a record — one value, overwritten. `mail_responses` is the LOG: one
-- row per response event, never overwritten. A record can respond twice (calls
-- the tracked number on Tuesday, hits the PURL on Friday) and the log keeps
-- both while the denormalised pair keeps the most recent. This file does not
-- add a trigger to sync them; keeping them in step is the response-handler's
-- job and belongs in code where it can be tested, not in a trigger that fires
-- invisibly during a bulk load.
--
--
-- OUTCOME_TIER IS UNCONSTRAINED HERE, AND THAT IS A DECISION. There is an
-- `outcome_tier` vocabulary in this schema already — clients.outcome_tier
-- (001_init.sql:60) is FRAUD_HOLD|MANUAL_REVIEW|REPAIR_ONLY|FUNDING_PLUS_REPAIR|
-- FULL_FUNDING|PREMIUM_STACK — but that is the CRS DECISION tier for a client
-- who has already been through a soft pull. A mail respondent has not been
-- through anything yet. Nothing in the schema or the code says the two
-- vocabularies are the same, so this file does not assert that they are and
-- adds no CHECK. An invented tier list here would be a guess wearing a
-- constraint's clothing, and it would be enforced. Left free text; reported.
--
--
-- NO DERIVED COUNTS. `mail_campaigns` carries `records_ordered` — the quantity
-- stated on the vendor order, which is an external fact that exists nowhere
-- else — and does NOT carry a live count of loaded, suppressed or responded
-- records. Those are all count(*) over `mail_universe` and storing them creates
-- a second answer that is wrong from the first suppression onward. This is
-- 054_tradelines.sql's rule ("NOTHING HERE IS DERIVED") applied again. The
-- suppression index at the bottom of this file is what makes computing them
-- cheap enough that caching them is not needed.
--
-- NO MONEY. Postage, print and list costs are real, but nothing in the task or
-- the schema states where they come from or at what grain they land (per piece,
-- per thousand, per order), so there is no cost column to get wrong. When a
-- real invoice shape turns up it lands in a later migration as integer cents
-- with a `_cents` suffix, per the money rule.


-- ---------------------------------------------------------------------------
-- A. mail_campaigns — one row per drop, so campaign_id stops being a string
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mail_campaigns (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),

  -- The join key into mail_universe.campaign_id. See the long note above: this
  -- is a soft link by string equality, not a foreign key, because the existing
  -- column is text and may hold data that no FK would accept.
  --
  -- UNIQUE PER ORG, NOT GLOBALLY. See uq_mail_campaigns_org_key below: the
  -- string identifies exactly one campaign WITHIN AN ORG, which is the property
  -- mail_universe.campaign_id never had on its own. A bare column-level UNIQUE
  -- here would have let one org's label ("2026-Q3") permanently block every
  -- other org's, in a table whose first column is org_id.
  campaign_key   text NOT NULL,

  -- What a human calls it. Distinct from campaign_key so the label can be
  -- corrected without orphaning every mail_universe row that references it.
  name           text NOT NULL,

  -- The date the batch is intended to drop, or did. A date and not a
  -- timestamptz: a mail drop happens on a day at a printing plant, and pinning
  -- it to an instant in a timezone would be false precision. NULL = not
  -- scheduled, which is the only honest value for every campaign today.
  batch_date     date,

  -- The vendor-stated quantity on the order. NOT a count of mail_universe rows
  -- (see NO DERIVED COUNTS above) — this is what was ordered, and the
  -- difference between it and what actually loaded is a reconciliation signal
  -- worth being able to see. NULL = unknown, and unknown must survive.
  records_ordered integer CHECK (records_ordered IS NULL OR records_ordered >= 0),

  --   draft           — row exists, nothing loaded.
  --   universe_loaded — mail_universe rows ingested and countable.
  --   compliance_hold — waiting on the FCRA / Deluxe / legal gate. Every real
  --                     campaign is parked here until all three clear, and
  --                     there is no code path in this repo that leaves it.
  --   approved        — all three gate conditions signed off. Set by a human,
  --                     by hand, after the fact. Nothing automates this.
  --   dropped         — Deluxe physically mailed it. Past tense, recorded after
  --                     the fact; this system did not do it and cannot.
  --   cancelled       — abandoned before drop.
  -- There is deliberately no 'sending', 'live', 'active' or 'scheduled' value.
  -- A status vocabulary that contains a present-tense sending state invites
  -- code that tries to advance a row into it.
  status         text NOT NULL DEFAULT 'draft',

  notes          text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mail_campaigns_status_ck
    CHECK (status IN ('draft', 'universe_loaded', 'compliance_hold',
                      'approved', 'dropped', 'cancelled')),
  CONSTRAINT mail_campaigns_name_ck        CHECK (btrim(name) <> ''),
  CONSTRAINT mail_campaigns_key_ck         CHECK (btrim(campaign_key) <> ''),

  -- A campaign cannot claim to have dropped without saying when. Without this,
  -- "has this mailed" has no reliable answer at audit time — and under a
  -- prescreen gate, that is the one question that must always be answerable.
  CONSTRAINT mail_campaigns_dropped_date_ck
    CHECK (status <> 'dropped' OR batch_date IS NOT NULL)
);

-- THE JOIN KEY IS SCOPED TO THE ORG. Every comparable key in this schema is
-- org-scoped and not global — hiring_roles (org_id, key), candidates
-- (org_id, email), accounts (org_id, lower(email)), staff_roles
-- (org_id, lower(key)), clients_org_email_uniq, documents_org_key_uniq. A
-- global UNIQUE on campaign_key would break that pattern in the one direction
-- that cannot be undone quietly: the first org to use an obvious label like
-- "2026-Q3" or "spring-mailer" takes it away from every other org forever,
-- and the failure surfaces as a duplicate-key error on a tenant that has done
-- nothing wrong.
--
-- The code already assumes this scoping: src/mail/suppression.mjs joins
-- `ON mc.campaign_key = mu.campaign_id AND mc.org_id = mu.org_id`, which is
-- only meaningful if the key is unique within an org rather than across all
-- of them. This index makes the schema agree with the query.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_campaigns_org_key
  ON mail_campaigns (org_id, campaign_key);

-- The list screen: this org's campaigns, most recent drop first. NULLS FIRST
-- because an unscheduled campaign is the one still being worked on.
CREATE INDEX IF NOT EXISTS idx_mail_campaigns_org
  ON mail_campaigns (org_id, batch_date DESC NULLS FIRST);


-- ---------------------------------------------------------------------------
-- B. mail_tracked_numbers — the inbound numbers a batch is keyed to
-- ---------------------------------------------------------------------------
--
-- CHECKED FIRST, AS INSTRUCTED: there is no phone-number table anywhere to
-- reuse. 001_init.sql has no numbers table at all — `clients.phone` is a
-- column, and `messages` records `provider`/`provider_ref` but never the number
-- the traffic arrived on. Nothing in db/migrations/ creates one either. So this
-- table is new rather than a reuse, and it is scoped to mail: it exists to
-- answer "which campaign did this call come in on", not to be a general
-- telephony inventory. If a broader numbers table is ever built, this one
-- becomes a join table against it.
--
-- INBOUND ONLY. A tracked number is a thing calls arrive AT. There is no
-- outbound dialling here, no click-to-call, and no capability column that could
-- grow one.

CREATE TABLE IF NOT EXISTS mail_tracked_numbers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES orgs(id),

  -- A REAL foreign key, unlike the mail_universe link. This table is new and
  -- empty, so there are no existing rows for the constraint to break. RESTRICT
  -- because deleting a campaign out from under the number that routes to it
  -- would silently strand inbound calls with nowhere to attribute them.
  mail_campaign_id uuid NOT NULL REFERENCES mail_campaigns(id) ON DELETE RESTRICT,

  -- E.164, as Twilio hands it to us — the twilio adapter's normalized `to`
  -- field (src/adapters/twilio.mjs) is what matches against this.
  phone_number    text NOT NULL,

  provider        text NOT NULL DEFAULT 'twilio',
  -- The provider's own identifier for the number (Twilio PhoneNumber SID).
  provider_ref    text,

  assigned_at     timestamptz NOT NULL DEFAULT now(),
  -- Set when the number is returned to the pool. A released number may later be
  -- assigned to a different campaign, which is why history is kept as rows
  -- rather than by overwriting mail_campaign_id.
  released_at     timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mail_tracked_numbers_phone_ck CHECK (btrim(phone_number) <> ''),
  CONSTRAINT mail_tracked_numbers_released_ck
    CHECK (released_at IS NULL OR released_at >= assigned_at)
);

-- ONE ACTIVE ASSIGNMENT PER NUMBER. Same shape as uq_shifts_one_open
-- (060_shifts_one_open.sql): partial unique on the "still open" predicate. A
-- number pointing at two live campaigns at once makes every call that arrives
-- on it unattributable, and no read would flag it — the attribution would just
-- quietly pick one. Only a unique index can stop two INSERTs racing.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_tracked_numbers_active
  ON mail_tracked_numbers (org_id, phone_number)
  WHERE released_at IS NULL;

-- The routing lookup: given a campaign, its active numbers.
CREATE INDEX IF NOT EXISTS idx_mail_tracked_numbers_campaign
  ON mail_tracked_numbers (mail_campaign_id)
  WHERE released_at IS NULL;


-- ---------------------------------------------------------------------------
-- C. mail_responses — the append-only log behind the denormalised latest state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mail_responses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES orgs(id),

  -- The linkage. A response is always against a specific mailed record; a
  -- response that cannot be tied to one is not a mail response and does not
  -- belong in this table. CASCADE so purging a universe purges its log with it.
  mail_universe_id  uuid NOT NULL REFERENCES mail_universe(id) ON DELETE CASCADE,

  -- When the person responded, which is not when the row was written. A batch
  -- of call records imported on Friday describes Tuesday's calls. created_at
  -- keeps the write time; this keeps the truth time.
  response_at       timestamptz NOT NULL,

  --   voice — inbound call to a tracked number.
  --   sms   — inbound text to a tracked number.
  --   web   — the PURL / QR hit. record_slug's own comment in 001_init.sql
  --           calls it a "per-record PURL/QR slug"; this is that slug resolving.
  --   mail  — a physical business reply card came back.
  --   email — carried for completeness so a response round-trips.
  -- voice/sms/email match messages.channel (001_init.sql:264) rather than
  -- inventing a parallel spelling for the same three things.
  channel           text NOT NULL,

  -- Free text on purpose. See the OUTCOME_TIER note in the header: the
  -- clients.outcome_tier vocabulary is a post-soft-pull CRS decision and there
  -- is no source saying it applies to a mail respondent. No CHECK is asserted
  -- over values nobody has defined yet.
  outcome_tier      text,

  -- Which number it came in on, when it came in on one. NULL for web and mail
  -- responses, which have no number, and NULL for a voice response whose number
  -- has since been deleted — hence SET NULL rather than CASCADE: losing the
  -- number must not delete the evidence that somebody responded.
  tracked_number_id uuid REFERENCES mail_tracked_numbers(id) ON DELETE SET NULL,

  -- The client this response became, once it becomes one. NULL is the normal
  -- state — a response is a stranger until they are created as a client, and
  -- most never are. Never defaulted, never backfilled with a guess.
  client_id         uuid REFERENCES clients(id) ON DELETE SET NULL,

  -- The provider's identifier for the underlying event (Twilio CallSid /
  -- MessageSid). Drives the dedupe index below.
  provider_ref      text,

  -- The unparsed inbound record, kept verbatim, same rationale as
  -- tradelines.raw and bank_inbox.raw: when a parsed reading is disputed, this
  -- is what settles it.
  raw               jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT mail_responses_channel_ck
    CHECK (channel IN ('voice', 'sms', 'web', 'mail', 'email'))
);

-- The log read: every response for one record, newest first. Also what a
-- handler uses to recompute mail_universe.responded_at / outcome_tier, since
-- the newest row is the denormalised latest state by definition.
CREATE INDEX IF NOT EXISTS idx_mail_responses_record
  ON mail_responses (mail_universe_id, response_at DESC);

-- Re-importing a call log must not double-count a response. Partial, because
-- provider_ref is absent for anything hand-entered and NULLs would otherwise
-- collide into a single allowed row. Same shape as uq_tradelines_account.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mail_responses_provider_ref
  ON mail_responses (provider_ref)
  WHERE provider_ref IS NOT NULL;

-- NO INDEX IS ADDED FOR LOOKUP BY record_slug, DELIBERATELY. The task called
-- for "whatever the response lookup by slug needs", and the answer after
-- checking is: nothing. mail_universe.record_slug is already UNIQUE
-- (001_init.sql:353), and a unique constraint is backed by a btree, so
-- resolving a slug to its mail_universe row is already an index lookup.
-- Adding a second index on the same column would be a duplicate that only
-- costs write throughput on a hundred-thousand-row bulk load.


-- ---------------------------------------------------------------------------
-- D. The suppression gate index
-- ---------------------------------------------------------------------------
--
-- THE MOST IMPORTANT INDEX IN THE FILE. The question asked before any drop is
-- "which records in this campaign are NOT suppressed", and the existing
-- idx_mail_campaign (001_init.sql:362) is on campaign_id alone — so answering
-- it means reading every record in the campaign and filtering. At mail volumes
-- that is the whole universe, per check. This makes the suppression state part
-- of the index so the gate reads only the rows it is allowed to mail, and makes
-- the suppressed/loaded counts cheap enough that caching them on
-- mail_campaigns was not necessary (see NO DERIVED COUNTS).
CREATE INDEX IF NOT EXISTS idx_mail_universe_campaign_suppressed
  ON mail_universe (campaign_id, suppressed);


-- ---------------------------------------------------------------------------
-- E. updated_at triggers
-- ---------------------------------------------------------------------------
-- Same idempotent attach pattern as 051_hiring.sql: guarded on the function
-- existing and on the trigger not already being present, so re-running is a
-- no-op rather than a duplicate-object error.
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    FOREACH t IN ARRAY ARRAY[
      'mail_campaigns', 'mail_tracked_numbers', 'mail_responses'
    ] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_' || t || '_updated_at'
                      AND tgrelid = ('public.' || t)::regclass) THEN
        EXECUTE format(
          'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
          'trg_' || t || '_updated_at', t);
      END IF;
    END LOOP;
  END IF;
END $$;

COMMENT ON TABLE mail_campaigns IS
  'Direct-mail (Deluxe) campaign. NOTHING MAILS: prescreen data requires a firm offer of credit under FCRA, and no drop happens until the FCRA research, Deluxe compliance review and legal sign-off on lender-of-record are all in. No activation path is wired — see db/migrations/065_mail_campaigns.sql and src/mail/README.md.';
COMMENT ON COLUMN mail_campaigns.campaign_key IS
  'Soft join key: equals mail_universe.campaign_id. Unique per org, not globally — always join on org_id as well. Not a foreign key: that column is text and may hold data. See the 065 header.';
COMMENT ON TABLE mail_responses IS
  'Append-only log of responses against a mail_universe record. mail_universe.responded_at / outcome_tier are the denormalised latest state; this is the history.';
COMMENT ON TABLE mail_tracked_numbers IS
  'Inbound-only tracked numbers per campaign batch. No outbound dialling path exists or may be added here.';
