-- 292_insight_marketing_gate.sql — an interview answer cannot be marked
-- ad-usable unless the client actually granted marketing_use, and it stops
-- being ad-usable the moment they take that back.
--
-- COMPLIANCE REVIEW REQUIRED. Consent capture and marketing reuse of a
-- consumer's words. Nothing here publishes anything.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE HOLE THIS CLOSES
--
-- 166_customer_insights.sql stores what a client said on a mid check-in or a
-- post interview, and its own header says those answers "may later feed ads /
-- VSL / landing pages" and flags the consent question as unresolved. 291 added
-- the marketing_use consent kind. Without this file the two never meet: any
-- row in customer_insights looks as usable as any other, and the only thing
-- standing between a client who never agreed and a paid ad quoting them is
-- somebody remembering.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A COLUMN **AND** A VIEW, WHICH LOOKS LIKE ONE THING TOO MANY
--
-- A stored boolean alone is wrong, because consent is revocable and a boolean
-- written last March cannot know about a revocation last week. A live lookup
-- alone is also wrong, because it loses the fact that a human made a clearing
-- decision about THIS recording — a client can hold blanket marketing_use and
-- still have said "not that bit" about one call.
--
-- So both, meaning different things:
--
--   customer_insights.marketing_cleared — the human decision about this
--     recording, made after the call. Defaults false. Never auto-set.
--   v_insight_ad_eligible — the answer to "may we cut an ad from this today",
--     which is the column AND a live marketing_use consent, evaluated now.
--
-- ANYTHING CHOOSING FOOTAGE READS THE VIEW. The column on its own is a
-- historical fact, not a permission. A revoked consent empties the view
-- without rewriting a single insight row, which is the behaviour that makes
-- "they asked us to stop using it" work at all.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ONE COPY OF THE LIVE-CONSENT RULE, NOT TWO
--
-- src/consent/index.mjs holds VALID_PREDICATE and warns, at length, that a
-- second hand-typed copy is the defect class this repo keeps finding — and
-- that it drifts in the permissive direction. A trigger cannot call
-- JavaScript, so a database-side copy is unavoidable. It is therefore written
-- ONCE, here, as consent_is_live(), and both the trigger and the view call it.
--
-- The boundaries are copied deliberately and must not be "tidied":
--   expires_at > now()   — a consent expires AT its expiry, not after.
--   granted_at <= now()  — a consent is live from the instant it is given.
--
-- src/consent/marketing-gate.pg.test.mjs pins this function against
-- CONSENT_VALID_SQL. If someone edits one, that test fails rather than the
-- two quietly disagreeing about whether an ad may run.
--
-- DEPENDS ON: 099_client_consents.sql, 166_customer_insights.sql,
--             291_recording_and_marketing_consent.sql.

-- 1. The live-consent rule, once, database-side.
CREATE OR REPLACE FUNCTION consent_is_live(
  p_org_id    uuid,
  p_client_id uuid,
  p_kind      text
) RETURNS boolean
LANGUAGE sql
STABLE
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM client_consents c
     WHERE c.org_id    = p_org_id
       AND c.client_id = p_client_id
       AND c.kind      = p_kind
       AND c.revoked_at IS NULL
       AND (c.expires_at IS NULL OR c.expires_at > now())
       AND c.granted_at <= now()
  );
$fn$;

COMMENT ON FUNCTION consent_is_live(uuid, uuid, text) IS
  'Does this client hold a live, unrevoked, unexpired consent of this kind right now? The database-side twin of VALID_PREDICATE in src/consent/index.mjs — one copy, pinned by src/consent/marketing-gate.pg.test.mjs. Fails closed: an unknown client or kind is false.';

-- 2. The human decision about one recording.
ALTER TABLE customer_insights
  ADD COLUMN IF NOT EXISTS marketing_cleared boolean NOT NULL DEFAULT false;

ALTER TABLE customer_insights
  ADD COLUMN IF NOT EXISTS marketing_cleared_at timestamptz;

ALTER TABLE customer_insights
  ADD COLUMN IF NOT EXISTS marketing_cleared_by uuid REFERENCES staff(id);

-- Cleared is all-or-nothing: the flag, the time and the person who decided
-- arrive together. An unattributed clearance is the record that cannot be
-- answered for later, which is the one that matters when a client objects.
ALTER TABLE customer_insights
  DROP CONSTRAINT IF EXISTS customer_insights_cleared_ck;
ALTER TABLE customer_insights
  ADD CONSTRAINT customer_insights_cleared_ck CHECK (
    (marketing_cleared = false
       AND marketing_cleared_at IS NULL AND marketing_cleared_by IS NULL)
    OR
    (marketing_cleared = true
       AND marketing_cleared_at IS NOT NULL AND marketing_cleared_by IS NOT NULL)
  );

-- 3. The gate. A CHECK cannot ask another table, so this is a trigger.
CREATE OR REPLACE FUNCTION customer_insights_marketing_gate() RETURNS trigger
LANGUAGE plpgsql
AS $tg$
BEGIN
  IF NEW.marketing_cleared IS TRUE
     AND (TG_OP = 'INSERT' OR OLD.marketing_cleared IS DISTINCT FROM TRUE)
  THEN
    IF NOT consent_is_live(NEW.org_id, NEW.client_id, 'marketing_use') THEN
      RAISE EXCEPTION
        'customer_insights %: cannot mark marketing_cleared — client % holds no live marketing_use consent. Capture it first (src/consent/), or leave this recording uncleared.',
        COALESCE(NEW.id::text, '(new)'), NEW.client_id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$tg$;

DROP TRIGGER IF EXISTS trg_customer_insights_marketing_gate ON customer_insights;
CREATE TRIGGER trg_customer_insights_marketing_gate
  BEFORE INSERT OR UPDATE ON customer_insights
  FOR EACH ROW EXECUTE FUNCTION customer_insights_marketing_gate();

-- 4. The read anything picking footage must use.
DROP VIEW IF EXISTS v_insight_ad_eligible;
CREATE VIEW v_insight_ad_eligible AS
  SELECT i.*
    FROM customer_insights i
   WHERE i.marketing_cleared IS TRUE
     AND consent_is_live(i.org_id, i.client_id, 'marketing_use');

COMMENT ON VIEW v_insight_ad_eligible IS
  'Interview answers that may be cut into advertising TODAY: a human cleared this specific recording AND the client''s marketing_use consent is live right now. Revoking consent empties this view without touching a single insight row. Never select from customer_insights directly to choose ad footage.';

COMMENT ON COLUMN customer_insights.marketing_cleared IS
  'A human decided, after the call, that this recording is usable in advertising. A historical fact, NOT a permission — permission is v_insight_ad_eligible, which also checks the consent is still live.';
