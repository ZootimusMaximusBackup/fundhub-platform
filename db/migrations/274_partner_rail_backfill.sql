-- 274_partner_rail_backfill.sql — put the partners who already exist on R-08.
--
-- WHAT THE 2026-08-27 END-TO-END WALK FOUND. Pipeline R-08
-- ('affiliates_white_label') was open, every stage read 0, and the footer said
-- "nobody has been placed here" — while the staff Partner Galaxy census on the
-- same night counted 13 partners. CRM search returned nothing for a partner's
-- name or company either, and that is the same fact wearing a second hat: the
-- search reads pipeline CARDS, so a partner with no card is invisible to it.
--
-- 265_cards_partner_rail.sql fixed the SHAPE — cards.client_id may now be NULL
-- and cards.partner_id exists — and boarded exactly one partner by uuid, the one
-- the walk had just created. api/public/partner-apply.mjs boards every partner
-- who applies from now on. Neither of those does anything for the partners who
-- were already on file when the shape changed, and there is no other code path
-- that ever will.
--
-- WHAT THIS DOES. One card per partner who has none, on the stage that matches
-- the status the partners row already carries. 042_partners.sql constrains that
-- column to exactly three values and 115_affiliates_white_label.sql seeded a
-- stage named for each of them, so the mapping is a join, not a judgement:
--
--     invited -> 'Invited'      active -> 'Active'      paused -> 'Paused'
--
-- 'recruiting' and 'agreement_signed' are deliberately never chosen. Nothing in
-- the schema records that a partner is being sourced, and agreement_signed_at is
-- a payout gate rather than a lifecycle stage — a signed agreement on an active
-- partner still leaves them active. Guessing either would put a card in a column
-- the data does not support.
--
-- IDEMPOTENT AND NON-DESTRUCTIVE. NOT EXISTS on (partner_id, pipeline_id) means
-- a re-run inserts nothing, and a partner whose card a human has already dragged
-- somewhere is left exactly where they were put. No card is moved and none is
-- deleted. cards_partner_pipeline_idx (265) is the backstop if two runs race.

INSERT INTO cards (org_id, partner_id, pipeline_id, stage_id)
SELECT p.org_id, p.id, pl.id, st.id
  FROM partners p
  JOIN pipelines pl
    ON pl.org_id = p.org_id
   AND pl.key = 'affiliates_white_label'
  JOIN pipeline_stages st
    ON st.pipeline_id = pl.id
   AND st.org_id = p.org_id
   AND st.key = p.status
 WHERE NOT EXISTS (
         SELECT 1 FROM cards c
          WHERE c.partner_id = p.id
            AND c.pipeline_id = pl.id
       );

DO $$
DECLARE
  boarded int;
  stranded int;
BEGIN
  SELECT count(*)::int INTO boarded
    FROM cards c
    JOIN pipelines pl ON pl.id = c.pipeline_id AND pl.key = 'affiliates_white_label'
   WHERE c.partner_id IS NOT NULL;

  -- A partner whose org has no R-08 rail at all. Reported, not invented: the
  -- rail belongs to whichever org 115 seeded, and a second company would need
  -- its own.
  SELECT count(*)::int INTO stranded
    FROM partners p
   WHERE NOT EXISTS (
           SELECT 1 FROM pipelines pl
            WHERE pl.org_id = p.org_id AND pl.key = 'affiliates_white_label'
         );

  RAISE NOTICE 'R-08 now carries % partner card(s); % partner(s) have no white-label rail in their org', boarded, stranded;
END $$;
