-- 168_retire_ghl_agents.sql
-- Owner 2026-08-15: GHL is out. Seeded GHL-* agent rows stay as inventory but
-- must not be selectable for live/shadow reply. Retire them.

UPDATE agents
   SET status = 'retired',
       retired_at = COALESCE(retired_at, now()),
       updated_at = now()
 WHERE code LIKE 'GHL-%'
   AND status IS DISTINCT FROM 'retired';
