-- 007 — unique constraint on cards(client_id, pipeline_id).
-- Prevents duplicate pipeline cards on concurrent moveCardToStage calls.
-- Pairs with ON CONFLICT DO UPDATE in moveCardToStage.
CREATE UNIQUE INDEX IF NOT EXISTS cards_client_pipeline_idx ON cards(client_id, pipeline_id);
