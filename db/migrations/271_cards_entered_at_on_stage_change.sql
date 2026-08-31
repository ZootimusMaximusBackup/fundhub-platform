-- ---------------------------------------------------------------------------
-- cards.entered_at must mean "when this card entered the stage it is in now".
--
-- It never did. 001_init gave the column `DEFAULT now()` at insert and nothing
-- has updated it since: `moveCardToStage` (src/workflows/cards.mjs) and
-- `placeWhiteLabelRailCard` (api/public/partner-apply.mjs) both run a bare
-- `UPDATE cards SET stage_id = ...` and leave the clock alone. So the board's
-- "20d in stage" was really "this card was created 20 days ago" — a card moved
-- into Funded five minutes ago read exactly as stale as one nobody had touched
-- in three weeks. The single number that tells a funding advisor which round
-- has gone quiet could not tell them anything.
--
-- WHY A TRIGGER AND NOT APPLICATION CODE
-- Two production writers already move a card, in two different files, and
-- neither knows about the other. A third path moves cards in raw SQL
-- (161_optimization_repair_pipeline.sql re-pointed every optimization card at
-- a new stage). Application code would have to be right in all of them and in
-- every future one. A trigger is right once, and cannot be forgotten by the
-- next person who writes `UPDATE cards SET stage_id`.
--
-- ONLY ON A REAL CHANGE
-- The WHEN clause gates on `IS DISTINCT FROM`, so re-writing a card's current
-- stage — which both writers do routinely, they are find-or-create and run
-- twice by design — does not reset the clock. A no-op move leaves the age
-- alone. `ON CONFLICT ... DO UPDATE SET stage_id` fires this trigger too;
-- Postgres runs BEFORE UPDATE triggers on the upsert's update branch.
--
-- AN EXPLICIT entered_at STILL WINS
-- The second half of the WHEN clause skips the trigger when the same statement
-- also changed entered_at itself. Backdating a card is a legitimate thing to
-- write on purpose — fixtures and tests need a card that has genuinely sat for
-- four days without waiting four days for it — and a caller who names the value
-- should get the value they named. The trigger only fills in a clock that
-- nobody set.
--
-- INSERT needs nothing: the column default already stamps now(), and a brand
-- new card really did just enter its first stage.
--
-- NO BACKFILL, DELIBERATELY.
--
-- Nothing in this database records when a card last changed stage. There is no
-- card history table and no audit row; `events` holds round.* payloads for one
-- pipeline only, keyed by client, and carries no card id or stage.
--
-- cards.updated_at is the near miss, and it was considered and rejected. Every
-- `UPDATE cards` in this codebase happens to be a stage write, so 001_init's
-- generic trg_cards_updated does make updated_at look like a stage-change log.
-- It is not one. It has no WHEN clause, so it also fires on the idempotent
-- re-write of a card's CURRENT stage — and both writers are find-or-create and
-- documented as safe to run twice, so that happens constantly. It also fired
-- for every optimization card at once when 161 bulk-repointed them.
--
-- Backfilling from it would therefore stamp "moved recently" onto cards that
-- were only touched, which is the exact failure this migration exists to fix,
-- pointed the other way. Reading too STALE is the safe direction: it over-
-- reports cards needing a look instead of hiding a round that has gone quiet.
--
-- So rows that exist today keep entered_at = their creation time and stay
-- wrong until their next real move, at which point they become right forever.
-- See docs/journeys/CHANGELOG.md.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_card_entered_at() RETURNS trigger AS $$
BEGIN NEW.entered_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cards_entered_at ON cards;
CREATE TRIGGER trg_cards_entered_at
  BEFORE UPDATE ON cards
  FOR EACH ROW
  WHEN (
    OLD.stage_id IS DISTINCT FROM NEW.stage_id
    AND NEW.entered_at IS NOT DISTINCT FROM OLD.entered_at
  )
  EXECUTE FUNCTION set_card_entered_at();
