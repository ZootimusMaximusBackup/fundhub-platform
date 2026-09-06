-- 301_creative_copy_text.sql — the words of a written ad get a place to live.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS FILE EXISTS
--
-- The creative factory can make three kinds of asset: a picture, a video, and
-- copy — copy meaning the written words of an ad. Pictures and videos are files,
-- so 045_creative_factory.sql gave creative_assets a storage_key pointing at the
-- file in object storage.
--
-- Copy is not a file. It is a paragraph of text. And 045 gave the table nowhere
-- to put it.
--
-- So today this happens, every time:
--
--   1. The copy provider writes the ad. (src/creative/providers/copy.mjs)
--   2. The words are handed to the service as `text` on the asset.
--   3. storeAsset() inserts a row with storage_key NULL — see storageKeyFor(),
--      which returns null for kind='copy' on purpose, because there is no file.
--   4. The compliance screen reads the words, decides, and writes its verdict.
--   5. The words are thrown away.
--
-- What survives is a row that says "a copy asset was made, and it passed", with
-- no copy in it. The library screen has nothing to show. Nobody can read the ad
-- that was written, reuse it, or check what the screen actually approved. We are
-- paying a provider to generate text and then deleting the text.
--
-- (One partial copy does survive, in compliance_screenings.screened_text, but
-- that is the compliance record — it is cut off at 8000 characters, it is keyed
-- to a screening rather than to the asset, and it is not what the library reads.
-- It is evidence of a decision, not the asset itself.)
--
-- WHAT BREAKS WITHOUT THIS COLUMN: nothing crashes. That is the problem. Copy
-- generation looks like it works and quietly produces nothing usable.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY NULLABLE
--
-- A picture has no words. A video has no words. Making this NOT NULL would mean
-- inventing an empty string for every image the factory has ever made, which is
-- exactly the "NULL means unknown, do not default it to 0" mistake CLAUDE.md §12
-- warns about with money. NULL here means "this asset has no text", and for a
-- picture that is the true answer.
--
-- Every creative_assets row that exists today gets NULL, and that is correct.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY NOT `CHECK (copy_text IS NULL OR kind = 'copy')`
--
-- Tempting, and it would reject nothing today. But a video script and an image's
-- on-canvas headline are both words attached to a non-copy asset, and both are
-- plausible next steps. A constraint that forbids them buys nothing now and costs
-- a migration later. Left off deliberately, not forgotten.
--
-- WHY NOT `CHECK (kind <> 'copy' OR copy_text IS NOT NULL)`
--
-- That one WOULD reject rows that are valid today: every copy asset already in
-- the table has NULL here, and storeAsset inserts the row before it knows the
-- screen's verdict. Adding it would break the existing data and the existing
-- write path at once. Not added.
--
-- The one guard that is safe is below: if there IS text, it has to be actual
-- text. An empty string is not an ad, and it would render as a blank card in the
-- library that looks like a loading bug. Same shape as brand_kits_name_ck and
-- generation_jobs_idem_ck in 045.

ALTER TABLE creative_assets ADD COLUMN IF NOT EXISTS copy_text text;

-- Guarded so re-running this file, or a database where the constraint already
-- landed, does not error. Same pattern as the brand_kits_logo_fk block in 045.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'creative_assets_copy_text_ck') THEN
    ALTER TABLE creative_assets
      ADD CONSTRAINT creative_assets_copy_text_ck
      CHECK (copy_text IS NULL OR btrim(copy_text) <> '');
  END IF;
END $$;

COMMENT ON COLUMN creative_assets.copy_text IS
  'The generated words of a written ad. NULL for a picture or a video, which have no words and keep their file in storage_key instead. Written by storeAsset() in src/creative/generate.mjs for blocked assets as well as passed ones — a blocked ad that nobody can read is one nobody can fix.';

-- ═══════════════════════════════════════════════════════════════════════════
-- NAMING NOTE, so nobody "tidies" this later
--
-- The column is copy_text and not, say, copy_storage_text. src/http/read-api.mjs
-- drops any field whose name contains storage_key, storage_path, s3_key,
-- object_key, password or token_hash before a read API answers. That redactor
-- matches on a substring of the NAME, not on the value. A column named with any
-- of those inside it would be silently deleted from every API response and the
-- screen would show blank with no error anywhere. copy_text is clear of all of
-- them.
--
-- No index. The library reads copy alongside the rest of an asset row and filters
-- on partner/state/kind, which creative_assets_library_idx already covers. There
-- is no search-the-text feature, so a full-text index would be storage and write
-- cost for a query nobody makes.
