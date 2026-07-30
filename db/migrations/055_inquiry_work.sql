-- 055_inquiry_work.sql — make the Inquiry Remover dashboard's actions persist.
--
-- WHAT IS BROKEN TODAY. `inquiry-remover.html` renders the real queue through
-- /api/read/inquiries, and every interaction on it — expand, log an attempt,
-- mark confirmed — is LOCAL ONLY. There is no write path for inquiry_log, so a
-- click updates the screen and is lost on reload. HANDOFF.md calls this "the
-- next job on this screen". It is Alvin's daily driver.
--
-- TWO THINGS THIS ADDS, AND ONE IT DELIBERATELY DOES NOT.
--
-- 1. Attribution columns on inquiry_log. HANDOFF records that the "Worked" stat
--    keeps its sample value because "nothing in inquiry_log records who worked a
--    row or when, and deriving it from call_attempts > 0 would be a guess". That
--    is exactly right, and the fix is to record it rather than to infer it.
--
-- 2. inquiry_attempts — an append-only log of each attempt. call_attempts is a
--    counter, and a counter cannot answer "what happened on the second call".
--    The dashboard's expand row wants the history; a bureau dispute wants a
--    dated trail. Incrementing a counter destroys both.
--
-- WHAT IT DOES NOT ADD: a status enum. `inquiry_log.status` is free text and the
-- screen already reports unmapped values on a neutral pill rather than guessing.
-- Constraining it here would reject rows the external Airtable runtime writes
-- today and would silently redefine statuses nobody has agreed. The status
-- vocabulary is a business decision, not a migration.

ALTER TABLE inquiry_log
  -- Who last worked this row, and when. NULL means untouched — which is what
  -- makes the "Worked" stat derivable without inventing anything.
  ADD COLUMN IF NOT EXISTS worked_by  uuid REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worked_at  timestamptz,
  -- Set when a removal is confirmed. Separate from `status` on purpose: status
  -- is free text from several writers, and a timestamp is unambiguous.
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_inqlog_worked ON inquiry_log (worked_at DESC NULLS LAST);

-- Append-only. No UPDATE path in the application, no delete: this is the record
-- of what a human did on a consumer's credit file, and a mutable version of that
-- is not evidence of anything.
CREATE TABLE IF NOT EXISTS inquiry_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  inquiry_id    uuid NOT NULL REFERENCES inquiry_log(id) ON DELETE CASCADE,

  -- The staff member who made the attempt. NOT NULL: an attempt nobody made is
  -- not an attempt, and an unattributed row cannot be defended later.
  staff_id      uuid NOT NULL REFERENCES staff(id),

  --   call     — phoned the furnisher or the bureau
  --   letter   — mailed a correction request
  --   portal   — filed through a bureau portal
  --   note     — a working note that is not itself an attempt (does NOT
  --              increment the counter — see src/inquiries/work.mjs)
  kind          text NOT NULL DEFAULT 'call'
                CHECK (kind IN ('call', 'letter', 'portal', 'note')),

  -- Free text, same reasoning as inquiry_log.status: the outcome vocabulary
  -- belongs to whoever runs the desk, not to this file.
  outcome       text,
  note          text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inqattempt_inquiry
  ON inquiry_attempts (inquiry_id, created_at DESC);
