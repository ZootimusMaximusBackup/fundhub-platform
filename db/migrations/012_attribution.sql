-- 012 — ATTRIBUTION. Who gets credit, and how that survives the calendar.
--
-- The whole problem this solves: a round funds in October for a deal closed in
-- July. By October the client may have a different owner, the closer may have
-- left, the advisor may have been reassigned twice. None of that is allowed to
-- change who gets paid.
--
-- The answer is that attribution ATTACHES AT THE SALE and is never recalculated.
-- Every commission read walks a fixed chain:
--
--     funding_round -> funding_round_sales -> sale -> sale_attributions -> staff
--
-- and each ledger row snapshots the codes at the moment of earning, so even a
-- later edit to a staff or client record leaves the payout report intact.

-- ---------------------------------------------------------------------------
-- Employee identification codes.
--
-- Added to the existing staff table (001_init.sql is not edited; this is an
-- additive ALTER). Auto-assigned EMP-000001 upward, but only when NULL — an
-- import or a migration can supply its own codes and they are respected.
-- ---------------------------------------------------------------------------
ALTER TABLE staff ADD COLUMN IF NOT EXISTS employee_code text;
ALTER TABLE staff ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE SEQUENCE IF NOT EXISTS employee_code_seq START 1;

CREATE OR REPLACE FUNCTION assign_employee_code() RETURNS trigger AS $$
BEGIN
  IF NEW.employee_code IS NULL OR btrim(NEW.employee_code) = '' THEN
    NEW.employee_code := 'EMP-' || lpad(nextval('employee_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_employee_code ON staff;
CREATE TRIGGER trg_staff_employee_code
  BEFORE INSERT ON staff
  FOR EACH ROW EXECUTE FUNCTION assign_employee_code();

-- Backfill anyone already in the table. Idempotent: only touches NULLs.
UPDATE staff
   SET employee_code = 'EMP-' || lpad(nextval('employee_code_seq')::text, 6, '0')
 WHERE employee_code IS NULL OR btrim(employee_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS staff_org_employee_code_uniq
  ON staff (org_id, upper(employee_code)) WHERE employee_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Client identification codes.
--
-- clients.client_master_key (001_init.sql) stays exactly as it is — it is the
-- legacy/parallel-run key and this migration does not touch it. client_code is
-- the customer-lifecycle identifier: short, human-quotable, stamped onto every
-- commission row so a payout report is readable without a join.
-- ---------------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_code text;

CREATE SEQUENCE IF NOT EXISTS client_code_seq START 1;

CREATE OR REPLACE FUNCTION assign_client_code() RETURNS trigger AS $$
BEGIN
  IF NEW.client_code IS NULL OR btrim(NEW.client_code) = '' THEN
    NEW.client_code := 'FH-' || lpad(nextval('client_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clients_client_code ON clients;
CREATE TRIGGER trg_clients_client_code
  BEFORE INSERT ON clients
  FOR EACH ROW EXECUTE FUNCTION assign_client_code();

UPDATE clients
   SET client_code = 'FH-' || lpad(nextval('client_code_seq')::text, 6, '0')
 WHERE client_code IS NULL OR btrim(client_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS clients_org_client_code_uniq
  ON clients (org_id, upper(client_code)) WHERE client_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- staff_roles — roles are rows, not a constant in code.
--
-- Same split as products: `key` is the stable handle commission rules reference,
-- `name` is the editable label the team reads. Chris can rename "Funding Advisor"
-- to anything and no rule breaks. Adding a new role is a row, not a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS staff_roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id),
  key         text NOT NULL,   -- stable: closer, funding_advisor, ...
  name        text NOT NULL,   -- editable display label
  description text,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS staff_roles_org_key_uniq ON staff_roles (org_id, lower(key));

-- Seeded from staff.role's documented values in 001_init.sql.
INSERT INTO staff_roles (org_id, key, name, description, sort_order)
SELECT o.id, v.key, v.name, v.description, v.sort_order
  FROM orgs o
  CROSS JOIN (VALUES
    ('closer',             'Closer',             'Closes the sale. Earns front end.',            10),
    ('funding_advisor',    'Funding Advisor',    'Works the file to funding. Earns back end.',   20),
    ('inquiry_specialist', 'Inquiry Specialist', 'Inquiry removal work.',                        30),
    ('setter',             'Setter',             'Books the call.',                              40),
    ('admin',              'Admin',              'Operations and oversight.',                    50)
  ) AS v(key, name, description, sort_order)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM staff_roles r WHERE r.org_id = o.id AND lower(r.key) = lower(v.key)
   );

-- ---------------------------------------------------------------------------
-- sale_attributions — the credit itself.
--
-- One row per person PER BASIS. This is what makes both required cases fall out
-- of the same table with no special casing:
--
--   role-based credit  — closer gets front_end, advisor gets back_end on the
--                        same client: two rows, different basis, different role.
--   split credit       — two closers on one deal: two front_end rows at 50/50.
--
-- A person doing both jobs on one deal simply has two rows.
--
-- Rows can be ADDED after the sale — the funding advisor is usually assigned
-- when the file starts being worked, not at signature. That is fine and expected.
-- What never changes is an attribution that has already produced a ledger row:
-- the ledger row is frozen independently (see 014).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_attributions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES orgs(id),
  sale_id        uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  staff_id       uuid NOT NULL REFERENCES staff(id),

  -- Snapshot of the employee code at attribution time. Denormalised on purpose:
  -- it keeps a historical payout report readable even if codes are ever reissued.
  employee_code  text,

  role           text NOT NULL,   -- references staff_roles.key (soft, by design)

  -- front_end — commission on the sale itself
  -- back_end  — commission on funding, earned later at round.funded
  basis          text NOT NULL CHECK (basis IN ('front_end', 'back_end')),

  -- Split credit. 100 = sole credit. Two people at 50 each.
  split_percent  numeric(7,4) NOT NULL DEFAULT 100
    CHECK (split_percent > 0 AND split_percent <= 100),

  attributed_at  timestamptz NOT NULL DEFAULT now(),
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sale_attributions_uniq
  ON sale_attributions (sale_id, staff_id, role, basis);
CREATE INDEX IF NOT EXISTS sale_attributions_sale_idx  ON sale_attributions (sale_id, basis);
CREATE INDEX IF NOT EXISTS sale_attributions_staff_idx ON sale_attributions (staff_id);

-- Over-allocation is always an error, so it is rejected immediately rather than
-- deferred. Under-allocation (a deal only 50% attributed) is allowed — the file
-- may not have an advisor yet — and the calculator reports the unallocated
-- remainder rather than silently inflating anyone's share to cover it.
CREATE OR REPLACE FUNCTION sale_attributions_check_split() RETURNS trigger AS $$
DECLARE total numeric(9,4);
BEGIN
  SELECT COALESCE(SUM(split_percent), 0) INTO total
    FROM sale_attributions
   WHERE sale_id = NEW.sale_id
     AND basis   = NEW.basis
     AND id     <> NEW.id;

  IF total + NEW.split_percent > 100.0001 THEN
    RAISE EXCEPTION
      'sale % % split would total %%% (max 100%%). Reduce an existing share first.',
      NEW.sale_id, NEW.basis, total + NEW.split_percent;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_attributions_split ON sale_attributions;
CREATE TRIGGER trg_sale_attributions_split
  BEFORE INSERT OR UPDATE ON sale_attributions
  FOR EACH ROW EXECUTE FUNCTION sale_attributions_check_split();

-- Fill employee_code from staff at insert if the caller did not supply it.
CREATE OR REPLACE FUNCTION sale_attributions_stamp_code() RETURNS trigger AS $$
BEGIN
  IF NEW.employee_code IS NULL THEN
    SELECT s.employee_code INTO NEW.employee_code FROM staff s WHERE s.id = NEW.staff_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sale_attributions_stamp_code ON sale_attributions;
CREATE TRIGGER trg_sale_attributions_stamp_code
  BEFORE INSERT ON sale_attributions
  FOR EACH ROW EXECUTE FUNCTION sale_attributions_stamp_code();

-- ---------------------------------------------------------------------------
-- updated_at triggers.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_staff_roles_updated ON staff_roles;
CREATE TRIGGER trg_staff_roles_updated BEFORE UPDATE ON staff_roles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_sale_attributions_updated ON sale_attributions;
CREATE TRIGGER trg_sale_attributions_updated BEFORE UPDATE ON sale_attributions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
