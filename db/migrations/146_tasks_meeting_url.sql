-- 146_tasks_meeting_url.sql — meeting join URL on calendar/task rows.
--
-- Renumbered at merge from t143_tasks_meeting_url.sql → 146 (main max was 143).
--
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS meeting_url text;
