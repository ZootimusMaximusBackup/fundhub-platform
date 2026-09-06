-- 340_client_light_affiliate.sql — a client may also hold an affiliate code.
--
-- OWNER DECISION (docs/workflows/portal-rebuild-plan.md §4, option 2, 2026-09-05):
-- pressing "Refer a friend" in the client portal generates that client's own
-- share link and affiliate code and instantly provisions their access to the
-- affiliate screen. They stay a client. They become a LIGHT affiliate alongside
-- it — not a second person, not a second login.
--
-- WHY THIS MIGRATION HAS TO EXIST BEFORE THE BUTTON CAN.
--
-- 044_accounts.sql:65-71 wrote accounts_subject_ck as "exactly one of
-- client_id / affiliate_id / partner_id, and it must match `kind`". Under that
-- constraint a client account carrying an affiliate_id is rejected by Postgres,
-- so there were only ever two ways to build the owner's decision:
--
--   1. Relax the constraint so a CLIENT may also carry an affiliate_id.
--   2. Give the person a second account of kind 'affiliate'.
--
-- (2) is not available and would be wrong even if it were. accounts_email_uniq
-- (044:78) allows exactly one login per email address per org, so the second
-- account would need a second email address — for the same human, who would
-- then have two passwords and two magic-link inboxes for one relationship. It
-- would also split them across two principals, and every screen that asks "who
-- is this" would get a different answer depending on which link they clicked.
--
-- So (1). The change is deliberately the smallest one that works:
--
--   * A CLIENT may now carry an affiliate_id. Everything else is unchanged.
--   * An AFFILIATE still may not carry a client_id. The reverse direction is a
--     different decision — an affiliate becoming a client is a sale, with a
--     contract and a payment behind it, and it is not what section 4 asked for.
--     Left refused on purpose rather than opened "while we are in here".
--   * A PARTNER is untouched. 044's own header explains why a partner cannot
--     self-register; nothing here softens that.
--
-- WHAT DOES NOT CHANGE, and this is the part that keeps the blast radius small:
--
--   * `kind` stays 'client'. The session still resolves to a client principal,
--     so every endpoint gated on ["staff","client"] behaves exactly as before
--     and no endpoint suddenly starts admitting a new kind of caller.
--   * accounts_affiliate_uniq (044:81) still holds — one account per affiliate
--     row — so this cannot become a way for two people to share one code.
--   * No column is added, no column is dropped, nothing is backfilled, and no
--     existing row changes. Every row that satisfied the old constraint
--     satisfies the new one; it is strictly weaker in exactly one direction.
--
-- Editing 044 in place would have been a silent no-op — migrate.mjs keys
-- schema_migrations on <dir>/<file> and never re-runs an applied file
-- (CLAUDE.md §12) — so this supersedes it as a new file, which is the rule.

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_subject_ck;

ALTER TABLE accounts ADD CONSTRAINT accounts_subject_ck CHECK (
  -- A client. May ALSO hold an affiliate code (the light-affiliate case above).
  (kind = 'client'    AND client_id    IS NOT NULL AND partner_id   IS NULL) OR
  -- An affiliate. Unchanged: affiliate only.
  (kind = 'affiliate' AND affiliate_id IS NOT NULL AND client_id    IS NULL AND partner_id   IS NULL) OR
  -- A partner. Unchanged: partner only.
  (kind = 'partner'   AND partner_id   IS NOT NULL AND client_id    IS NULL AND affiliate_id IS NULL)
);

COMMENT ON CONSTRAINT accounts_subject_ck ON accounts IS
  'A client may also carry an affiliate_id (light affiliate, portal-rebuild-plan.md section 4). Every other pairing is still refused.';

-- Finding the client's own affiliate row is now a hot path: the progress page
-- asks "am I enrolled" on every visit.
CREATE INDEX IF NOT EXISTS accounts_client_affiliate_idx
  ON accounts (org_id, affiliate_id)
  WHERE kind = 'client' AND affiliate_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- THE TAX GATE. Two columns, and an honest NULL.
--
-- docs/workflows/portal-rebuild-plan.md §4 asks for the payout hold AND the tax
-- gate to be enforced in the affiliate screen. The hold already had somewhere to
-- live: affiliates.partner_license_signed_at (033_affiliates.sql:85) and
-- affiliate_payouts.status='held' with its hold_reason (033:349-352).
--
-- THE TAX GATE HAD NOWHERE. There is no w9, no tax_, no tax-form column on
-- affiliates, partners, accounts or anywhere else in db/ — searched 2026-09-05.
-- So the screen could not have enforced it: there was nothing to read.
--
-- These two columns are that place, and they are deliberately the smallest
-- possible version of it:
--
--   tax_form_received_at  NULL = WE HOLD NO RECORD. Not "they did not send it".
--                         The distinction matters: an affiliate who posted a
--                         W-9 last year is in exactly this state, and a screen
--                         that told them they had never sent one would be
--                         asserting something this database cannot know.
--                         CLAUDE.md: NULL means unknown and must survive.
--   tax_form_ref          Where the paperwork is — a document id or an envelope
--                         reference — so the screen can link to it instead of
--                         printing a boolean with no route to the evidence.
--                         NULL = we hold no pointer.
--
-- NOTHING WRITES THEM YET, AND THAT IS STATED RATHER THAN HIDDEN. No upload
-- path, no admin control, no workflow. api/read/affiliate-portal.mjs reports
-- them and its header says so; public/app/affiliate.html renders the absence as
-- "we have no record of your tax form", which is true today for everybody.
-- Whoever builds the tax-form upload writes these two columns and the gate
-- starts telling the truth about individuals without any further change here.
--
-- THIS CHANGES NO MONEY. No payout status moves, no hold is placed or released,
-- and no code path reads these columns to decide whether to pay anybody. The
-- gate is informational on the screen, exactly as this migration leaves it.

ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_form_received_at timestamptz;
ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS tax_form_ref text;

COMMENT ON COLUMN affiliates.tax_form_received_at IS
  'When a tax form was received. NULL means no record held, NOT that none was sent. Nothing writes this yet.';
COMMENT ON COLUMN affiliates.tax_form_ref IS
  'Pointer to the tax paperwork (document id or e-sign envelope). NULL means no pointer held.';
