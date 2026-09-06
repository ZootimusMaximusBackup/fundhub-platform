-- 369_waypoint_nudge_destination_cap.sql — cap the day on the PHONE, not on the
-- record; and let a claim hold the day before the send resolves.
--
-- COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging cadence on
-- a consumer-finance file. NOTHING IN THIS FILE SENDS ANYTHING. Both changes
-- below can only ever produce FEWER messages than 365 alone.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CHANGE 1 — ONE PERSON, TWO CLIENT ROWS, TWO TEXTS
--
-- 365's daily cap is UNIQUE (client_id, client_local_date). It counts RECORDS.
-- A person with two client rows on the same phone number — an ordinary thing in
-- any CRM, and the exact shape behind the 2026-09-03 incident where one phone
-- received 51 messages — is two records, so they got two texts in a day and
-- both caps reported themselves satisfied.
--
-- Measured on a scratch database on 2026-09-06: two client rows, phone
-- '+15550004000' and '+1 (555) 000-4000', one overdue checklist item each, one
-- pass. Outbound messages: 2.
--
-- So this adds a SECOND cap keyed on where the message actually goes:
--
--   waypoint_nudges_dest_day_uq  UNIQUE (org_id, destination_key,
--                                        client_local_date)
--
-- The 365 cap is KEPT, not replaced, and that ordering matters. Replacing it
-- would loosen the product: one client with a phone and an email would newly be
-- reachable twice in a day, once per destination. With both caps in force the
-- rule is the stricter of the two — one message per client per day AND one
-- message per destination per day — and ON CONFLICT DO NOTHING at the single
-- writer absorbs whichever one bites.
--
-- SCOPED BY org_id, DELIBERATELY. A destination key alone would let one
-- white-label partner's send silence another partner's, which is a tenant
-- leaking into a tenant. Two partners genuinely sharing an end customer is rare
-- and visible; cross-tenant coupling is neither. Owner-set trade, recorded here
-- rather than in a comment nobody finds.
--
-- destination_key is NORMALISED by src/nudge/destination.mjs before it is
-- written: a phone becomes its digits with a US country code stripped, an email
-- becomes lowercase and trimmed. '+1 (555) 000-4000' and '+15550004000'
-- therefore collide, which is the entire point.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- CHANGE 2 — A CRASH MID-SEND MUST NOT READ AS A DELIVERED MESSAGE
--
-- 365's header describes claim-then-queue, with outcome='claimed' meaning "the
-- send has not resolved yet". The code shipped alongside it did not do that: it
-- INSERTed outcome='queued' before sendTemplated was called, so a pass that
-- died between the two left a row that read exactly like a delivered nudge.
--
-- Measured on a scratch database on 2026-09-06 by reading the row from inside
-- the send callback: the outcome read as "queued" while sendTemplated was still
-- running.
--
-- The code is fixed to insert 'claimed' and resolve it afterwards. That needs
-- one constraint relaxed, because the claim has to carry client_local_date —
-- the local date IS how the daily cap is taken, and taking it after the send
-- would reopen the check-then-write race the whole design exists to avoid.
--
--   was:  client_local_date IS NULL OR outcome = 'queued'
--   now:  client_local_date IS NULL OR outcome IN ('claimed', 'queued')
--
-- This is not a loosening of the cap. A 'claimed' row occupies the client's day
-- exactly as a 'queued' row does, which is the conservative reading: we do not
-- know whether that message went out, so we do not send a second one. The
-- outcomes that definitely queued nothing — no_contact, template_pending,
-- refused — still may not hold a date, and the runner clears it on all three.
--
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NULL MEANS UNKNOWN (CLAUDE.md §12)
--
--   destination_key NULL — no client-facing address was involved. Every step-4
--     staff-task row is NULL here, and so is any row written before this
--     migration existed. NULL never joins the unique index, so an unknown
--     destination silently blocks nobody. Never an empty string: a CHECK
--     refuses blank, so a screen or a query cannot treat whitespace as an
--     address.
--
--
-- SAFETY. Additive. Adds one nullable column, one CHECK on that column, one
-- partial unique index, and relaxes one CHECK. Touches no existing row. Drops
-- no data.
--
-- BACKFILL: none, and none is possible. waypoint_nudges arrives in 365 on this
-- same branch and has never been applied to production, so there is no historic
-- row whose destination could be reconstructed. Existing rows, if any exist in
-- a scratch database, keep destination_key NULL and are exempt from the new cap
-- — which is correct, because we do not know where they went.

ALTER TABLE public.waypoint_nudges
  ADD COLUMN IF NOT EXISTS destination_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'waypoint_nudges_destination_key_ck'
       AND conrelid = 'public.waypoint_nudges'::regclass
  ) THEN
    ALTER TABLE public.waypoint_nudges
      ADD CONSTRAINT waypoint_nudges_destination_key_ck
      CHECK (destination_key IS NULL OR destination_key ~ '[^[:space:]]');
  END IF;
END $$;

-- A staff task has no destination. Nothing may claim one.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'waypoint_nudges_destination_kind_ck'
       AND conrelid = 'public.waypoint_nudges'::regclass
  ) THEN
    ALTER TABLE public.waypoint_nudges
      ADD CONSTRAINT waypoint_nudges_destination_kind_ck
      CHECK (destination_key IS NULL OR kind = 'client_message');
  END IF;
END $$;

-- A local date is a claim on a person's day, so it may only sit beside a
-- destination we can name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'waypoint_nudges_day_needs_destination_ck'
       AND conrelid = 'public.waypoint_nudges'::regclass
  ) THEN
    ALTER TABLE public.waypoint_nudges
      ADD CONSTRAINT waypoint_nudges_day_needs_destination_ck
      CHECK (client_local_date IS NULL OR destination_key IS NOT NULL);
  END IF;
END $$;

-- THE SECOND DAILY CAP. Partial for the same reason 365's is: a row that queued
-- nothing must not occupy anybody's day.
CREATE UNIQUE INDEX IF NOT EXISTS waypoint_nudges_dest_day_uq
  ON public.waypoint_nudges (org_id, destination_key, client_local_date)
  WHERE client_local_date IS NOT NULL AND destination_key IS NOT NULL;

-- Relax the outcome gate so a claim may hold the day while the send is in
-- flight. Dropped and recreated because a CHECK cannot be altered in place.
ALTER TABLE public.waypoint_nudges
  DROP CONSTRAINT IF EXISTS waypoint_nudges_day_outcome_ck;
ALTER TABLE public.waypoint_nudges
  ADD CONSTRAINT waypoint_nudges_day_outcome_ck CHECK (
    client_local_date IS NULL OR outcome IN ('claimed', 'queued')
  );

COMMENT ON COLUMN public.waypoint_nudges.destination_key IS
  'The normalised address this nudge was aimed at — phone digits with a US country code stripped, or a lowercased email (src/nudge/destination.mjs). NULL = no client-facing address was involved, which is every step-4 staff-task row; NULL never joins the daily cap. Never blank.';
COMMENT ON COLUMN public.waypoint_nudges.outcome IS
  'claimed = the claim is written and the send has NOT resolved; it is never retried and it still holds the client''s day, because we do not know whether that message went out. queued = a messages row exists. no_contact = no address for that channel, step spent on purpose so it is not retried forever. template_pending = no approved template. refused = the send path declined and detail says why. staff_task = step 4, a human took it.';
