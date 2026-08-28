-- 259_call_outcome_transcript.sql — word-for-word Meet words on the call log.
-- Filled from a Drive transcript doc (Google Meet Transcript / Gemini notes)
-- or from Whisper on a short recording. Files stay in Drive.

ALTER TABLE call_outcomes
  ADD COLUMN IF NOT EXISTS transcript text;

COMMENT ON COLUMN call_outcomes.transcript IS
  'Word-for-word Meet transcript. Drive companion doc or Whisper. Not closer notes.';
