-- 020_staff_targets_model_bars.sql
-- AI-set 2026-08-24. One pod = closer + funding advisor. Same bar for both.
-- Per pod: 27 deposits and 27 funded files (half of the 54 FA time-max).
-- Supersedes seed 019's spoken 20/20.

WITH org AS (SELECT id FROM orgs WHERE slug = 'fundhub' LIMIT 1)
UPDATE staff_targets st
SET target_value = v.target_value
FROM org
JOIN (VALUES
  ('closer',           'monthly', 'deposits', 27),
  ('funding_advisor',  'monthly', 'files',    27)
) AS v(role, period, metric, target_value) ON TRUE
WHERE st.org_id = org.id
  AND st.staff_id IS NULL
  AND st.role = v.role
  AND st.period = v.period
  AND st.metric = v.metric;

WITH org AS (SELECT id FROM orgs WHERE slug = 'fundhub' LIMIT 1)
INSERT INTO staff_targets (org_id, staff_id, role, period, metric, target_value)
SELECT org.id, NULL, v.role, v.period, v.metric, v.target_value
FROM org
JOIN (VALUES
  ('closer',           'monthly', 'deposits', 27),
  ('funding_advisor',  'monthly', 'files',    27)
) AS v(role, period, metric, target_value) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM staff_targets st
  WHERE st.org_id = org.id
    AND st.staff_id IS NULL
    AND st.role = v.role
    AND st.period = v.period
    AND st.metric = v.metric
);
