-- 019_staff_targets_starting_bars.sql
-- Spoken 20/20 from 2026-08-24. Superseded by seed 020 (30 deposits / 27 files).
-- Left in place so migrate history stays honest. Do not copy these values.

WITH org AS (SELECT id FROM orgs WHERE slug = 'fundhub' LIMIT 1)
INSERT INTO staff_targets (org_id, staff_id, role, period, metric, target_value)
SELECT org.id, NULL, v.role, v.period, v.metric, v.target_value
FROM org
JOIN (VALUES
  ('closer',           'monthly', 'deposits', 20),
  ('funding_advisor',  'monthly', 'files',    20)
) AS v(role, period, metric, target_value) ON TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM staff_targets st
  WHERE st.org_id = org.id
    AND st.staff_id IS NULL
    AND st.role = v.role
    AND st.period = v.period
    AND st.metric = v.metric
);
