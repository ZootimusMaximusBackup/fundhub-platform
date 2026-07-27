-- 009_staff_targets.sql
-- Galaxy Command Center §4: to show "on pace / behind" the system needs targets.
-- A target per role per period, with an optional per-person override. Pace is then
-- computed as output-to-date vs expected-to-date (not stored here — derived at read time).
-- Target VALUES are set by Chris (derive from staff.comp §14); this is the structural home.

CREATE TABLE IF NOT EXISTS staff_targets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  -- Exactly one of (staff_id) or (role) identifies the target's scope:
  --   staff_id set  → per-person override
  --   role set      → role-level default (staff_id NULL)
  staff_id      uuid REFERENCES staff(id) ON DELETE CASCADE,
  role          text,   -- funding_advisor | closer | inquiry_specialist | setter | admin
  period        text NOT NULL,   -- daily | weekly | monthly
  metric        text NOT NULL,   -- calls | files | submissions | removals | deposits | funded_amount | bookings
  target_value  numeric(14,2) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_targets_scope_ck CHECK (staff_id IS NOT NULL OR role IS NOT NULL)
);

-- One target per scope+period+metric. A per-person row (staff_id) and a role row are
-- distinct scopes; NULLs are distinguished via COALESCE keys in the two partial indexes.
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_targets_person
  ON staff_targets (org_id, staff_id, period, metric) WHERE staff_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_targets_role
  ON staff_targets (org_id, role, period, metric) WHERE staff_id IS NULL;
