-- 281_partner_recruited_by.sql — record WHICH partner recruited which.
--
-- WHAT WAS BROKEN. The recruit bonus (W0-decisions.md, W1-money-model.md §5/D7)
-- has been written and tested since src/partners/revenue.mjs landed:
-- accrueRecruitBonus() writes the $2,000 partner_revenue row correctly. It has
-- never once fired, because nothing in this database records that partner A
-- brought partner B. The function takes `recruiterPartnerId` as an argument and
-- there was no column anywhere that could answer it. The money was correct and
-- unreachable.
--
-- ONE NULLABLE COLUMN, SELF-REFERENCING. Most partners are not recruited by
-- anybody, so NULL is the normal case and means exactly that: nobody is owed a
-- recruit bonus for this partner. NULL is UNKNOWN/NONE and must survive — it is
-- never to be backfilled with a guess, because a guess here pays somebody
-- $2,000 of real money.
--
-- WHY THE FOREIGN KEY IS COMPOSITE. `(recruited_by_partner_id, org_id)` points at
-- `(id, org_id)`, not at `id` alone. A single-column FK would happily let a
-- partner in org A be recorded as recruited by a partner in org B, which is the
-- same cross-tenant hole 042 spent its whole header closing — and here it would
-- also route money across the boundary. The composite form makes that a database
-- error. It needs a unique index on (id, org_id) to point at; `id` is already the
-- primary key so that index adds no new uniqueness rule, only a target.
--
-- ON DELETE RESTRICT, matching clients_partner_fk in 042. Deleting a partner who
-- recruited others must not silently erase the record of who is owed what.
--
-- A PARTNER CANNOT RECRUIT THEMSELVES. partners_no_self_recruit_ck. Without it the
-- shape above is satisfied by `recruited_by_partner_id = id`, which pays a partner
-- $2,000 for signing up, forever, on every entry fee. Cheapest possible fraud, so
-- it is refused in the database rather than in application code.
--
-- WHAT THIS DOES NOT FORBID: a two-partner loop (A recruited B, B recruited A).
-- That is commercially impossible — A was already a partner before B existed —
-- and it is not money-unsafe if it happens, because each side paid a real
-- $10,000. src/partners/recruit.mjs refuses it in the writer anyway; the database
-- only guards the case that is unambiguously wrong.
--
-- SAFETY. Additive and idempotent. No DELETE, no UPDATE of an existing row,
-- nothing revoked. Editing 042 instead would have been a silent no-op —
-- db/migrate.mjs keys schema_migrations by '<dir>/<file>' (CLAUDE.md §12) —
-- which is why this is a new file.

ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS recruited_by_partner_id uuid;

-- The FK target. Not a new uniqueness rule: id is already the primary key.
CREATE UNIQUE INDEX IF NOT EXISTS partners_id_org_uniq
  ON partners (id, org_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partners_recruiter_fk') THEN
    ALTER TABLE partners
      ADD CONSTRAINT partners_recruiter_fk
      FOREIGN KEY (recruited_by_partner_id, org_id)
      REFERENCES partners (id, org_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE partners DROP CONSTRAINT IF EXISTS partners_no_self_recruit_ck;
ALTER TABLE partners
  ADD CONSTRAINT partners_no_self_recruit_ck
  CHECK (recruited_by_partner_id IS NULL OR recruited_by_partner_id <> id);

-- "Who did this partner bring?" is the payout question, and it is asked per org.
-- Partial: the overwhelming majority of rows are NULL and index entries for them
-- would answer nothing.
CREATE INDEX IF NOT EXISTS partners_recruited_by_idx
  ON partners (org_id, recruited_by_partner_id)
  WHERE recruited_by_partner_id IS NOT NULL;

COMMENT ON COLUMN partners.recruited_by_partner_id IS
  'The partner who brought this partner in, or NULL for nobody. Read by src/partners/recruit.mjs to decide who is owed the one-time $2,000 recruit bonus (W1-money-model.md D7) when the $10,000 entry fee''s cash lands. NULL means no recruit bonus is owed and must never be backfilled with a guess.';
