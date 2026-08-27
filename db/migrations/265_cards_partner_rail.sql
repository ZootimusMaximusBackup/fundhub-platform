-- 265_cards_partner_rail.sql — let a white-label partner sit on R-08.
--
-- cards.client_id was NOT NULL. A partner is not a client, so /affiliates/
-- White-Label apply created a partners row and never a board card. Pipeline
-- R-08 stayed empty. This lets a card point at partner_id instead.

ALTER TABLE cards
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE CASCADE;

ALTER TABLE cards
  ALTER COLUMN client_id DROP NOT NULL;

ALTER TABLE cards
  DROP CONSTRAINT IF EXISTS cards_client_or_partner_chk;

ALTER TABLE cards
  ADD CONSTRAINT cards_client_or_partner_chk
  CHECK (
    (client_id IS NOT NULL AND partner_id IS NULL)
    OR (client_id IS NULL AND partner_id IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS cards_partner_pipeline_idx
  ON cards (partner_id, pipeline_id)
  WHERE partner_id IS NOT NULL;

-- Reused 2026-08-27 white-label partner already applied with no card.
INSERT INTO cards (org_id, partner_id, pipeline_id, stage_id)
SELECT p.org_id, p.id, pl.id, st.id
  FROM partners p
  JOIN pipelines pl ON pl.org_id = p.org_id AND pl.key = 'affiliates_white_label'
  JOIN pipeline_stages st ON st.pipeline_id = pl.id AND st.key = 'active'
 WHERE p.id = 'ed962d4b-e373-444d-8e47-8a156446d5be'
   AND NOT EXISTS (
     SELECT 1 FROM cards c
      WHERE c.partner_id = p.id AND c.pipeline_id = pl.id
   );
