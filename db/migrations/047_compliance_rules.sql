-- 047_compliance_rules.sql — the guardrail engine's rule sets, as config
-- (Creative Factory UNIT 4).
--
-- A MIGRATION THE SPEC DID NOT NUMBER. It allocated three (creative factory, ad
-- platforms, metering) and said UNIT 4's rule sets are "stored as config rows so
-- they're editable without a deploy" — without saying where. They are not ad
-- platform config and they are not creative storage, so they get their own file
-- rather than being wedged into a migration whose subject they are not. That
-- pushes metering to 048.
--
-- THE ENGINE IS DETERMINISTIC AND DOES NOT ASK AN LLM. These rows are patterns
-- and literals, matched by src/compliance/screen.mjs. Nothing in this path calls a
-- model, because a compliance decision that varies run-to-run is not a control —
-- it is a coin flip that occasionally passes an advance-fee promise.
--
-- WHY THE PATTERNS ARE ROWS AND NOT CODE. The offer changes, counsel revises
-- wording, and a platform tightens a policy on a Tuesday. Each of those must be a
-- row edit, not a deploy. What is NOT a row: the TikTok credit-repair block, the
-- Meta special-ad-category force, and the credit-repair human-approval gate. Those
-- are structural — CHECK constraints in 046 and unconditional branches in
-- screen.mjs — precisely so no config edit can turn them off.
--
-- SEEDED PATTERNS ARE FROM THE SPEC, NOT INVENTED. Every row below is one of the
-- banned categories the spec enumerates for CROA and for claims. Where the spec
-- named a category rather than a phrase ("advance-fee or upfront-payment
-- language"), the pattern is the ordinary way that category is written in ad copy.
-- Rates, thresholds and cadences remain unset — see 048 and the config table at
-- the end of this file.

-- ---------------------------------------------------------------------------
-- A. compliance_rules — org-level config, not partner-level
-- ---------------------------------------------------------------------------
--
-- ORG-SCOPED ON PURPOSE, so no partner_id and no RLS. These are fundhub's
-- compliance floor and must be identical for every partner: a per-partner rule
-- table would be a per-partner way to be less compliant, which is the override
-- flag the spec forbids wearing a different hat.

CREATE TABLE IF NOT EXISTS compliance_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id),

  --   croa       — Credit Repair Organizations Act banned promises
  --   claims     — cross-offer claim limits
  --   disclosure — required disclosures
  --   platform   — platform category/targeting rules
  rule_set     text NOT NULL,
  rule_key     text NOT NULL,

  -- Which offer types this applies to. Empty array = all of them.
  offer_types  jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Which platforms. Empty array = all.
  platforms    jsonb NOT NULL DEFAULT '[]'::jsonb,

  --   regex    — pattern matched case-insensitively against copy
  --   phrase   — literal substring, case-insensitive
  --   required — something that must be PRESENT, not absent
  match_type   text NOT NULL DEFAULT 'regex',
  pattern      text NOT NULL,

  -- block: hard stop. warn: recorded, does not stop a launch.
  severity     text NOT NULL DEFAULT 'block',
  -- Shown to the partner in the review queue, so it must say what to change.
  message      text NOT NULL,
  citation     text,

  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT compliance_rules_set_ck
    CHECK (rule_set IN ('croa', 'claims', 'disclosure', 'platform')),
  CONSTRAINT compliance_rules_match_ck
    CHECK (match_type IN ('regex', 'phrase', 'required')),
  CONSTRAINT compliance_rules_severity_ck CHECK (severity IN ('block', 'warn')),
  CONSTRAINT compliance_rules_pattern_ck  CHECK (btrim(pattern) <> ''),
  CONSTRAINT compliance_rules_message_ck  CHECK (btrim(message) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS compliance_rules_key_uniq
  ON compliance_rules (org_id, rule_set, rule_key);
CREATE INDEX IF NOT EXISTS compliance_rules_active_idx
  ON compliance_rules (org_id, rule_set) WHERE active;

-- A stored regex is compiled by Postgres on validation and by JS at screen time.
-- A malformed one would fail closed at screen time (which is correct) but silently
-- — so it is rejected at write time instead, where an operator can see it.
CREATE OR REPLACE FUNCTION compliance_rule_valid_regex() RETURNS trigger AS $$
BEGIN
  IF NEW.match_type = 'regex' THEN
    BEGIN
      PERFORM 'x' ~* NEW.pattern;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'compliance rule %/% has an invalid regex: %',
        NEW.rule_set, NEW.rule_key, NEW.pattern;
    END;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_compliance_rules_regex ON compliance_rules;
CREATE TRIGGER trg_compliance_rules_regex
  BEFORE INSERT OR UPDATE OF pattern, match_type ON compliance_rules
  FOR EACH ROW EXECUTE FUNCTION compliance_rule_valid_regex();

-- ---------------------------------------------------------------------------
-- B. compliance_screenings — the audit trail of every screen
-- ---------------------------------------------------------------------------
--
-- "No creative reaches a platform without passing the guardrail engine" is only
-- checkable after the fact if each pass leaves a record. Partner-scoped and RLS'd
-- like everything else, append-only like action_log.

CREATE TABLE IF NOT EXISTS compliance_screenings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES orgs(id),
  partner_id    uuid NOT NULL REFERENCES partners(id) ON DELETE RESTRICT,

  subject_type  text NOT NULL,
  subject_id    uuid,

  offer_type    text,
  platform      text,

  state         text NOT NULL,
  reasons       jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What was actually screened, so a later dispute can be reproduced against the
  -- exact text rather than against whatever the asset says today.
  screened_text text,
  rules_version text,

  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT compliance_screenings_subject_ck
    CHECK (subject_type IN ('creative_asset', 'campaign', 'ad_set', 'ad', 'social_post')),
  CONSTRAINT compliance_screenings_state_ck
    CHECK (state IN ('passed', 'blocked', 'needs_approval')),
  CONSTRAINT compliance_screenings_reasons_ck
    CHECK (state = 'passed' OR jsonb_array_length(reasons) > 0)
);

CREATE INDEX IF NOT EXISTS compliance_screenings_partner_idx
  ON compliance_screenings (partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS compliance_screenings_subject_idx
  ON compliance_screenings (subject_type, subject_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_compliance_screenings_no_delete ON compliance_screenings;
CREATE TRIGGER trg_compliance_screenings_no_delete
  BEFORE DELETE ON compliance_screenings
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION fundhub_no_delete();

DO $$ BEGIN PERFORM fundhub_apply_partner_rls('compliance_screenings'); END $$;

-- ---------------------------------------------------------------------------
-- C. The credit-repair disclosure link
-- ---------------------------------------------------------------------------
--
-- "Credit-repair funnels must have the Consumer Credit File Rights disclosure
-- asset present and LINKED before launch." Linked is the operative word: a
-- disclosure that exists in the library but is not attached to the campaign is not
-- attached to anything the consumer sees.
--
-- Note what is absent, mirroring 043_partner_brand.sql's reasoning: there is no
-- column holding the disclosure TEXT. The copy comes from a master template with
-- the partner's entity name injected, never edited per partner. A column for it
-- here would be the bug.

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS disclosure_asset_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_disclosure_fk') THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_disclosure_fk
      FOREIGN KEY (disclosure_asset_id) REFERENCES creative_assets(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- A credit-repair campaign cannot go live without one. At the engine, so no API
-- path and no backfill can skip it.
CREATE OR REPLACE FUNCTION campaign_disclosure_gate() RETURNS trigger AS $$
BEGIN
  IF NEW.approval_state = 'live'
     AND NEW.offer_type = 'credit_repair'
     AND NEW.disclosure_asset_id IS NULL THEN
    RAISE EXCEPTION
      'credit-repair campaign requires the Consumer Credit File Rights disclosure asset linked before launch (047)';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_campaign_disclosure_gate ON campaigns;
CREATE TRIGGER trg_campaign_disclosure_gate
  BEFORE INSERT OR UPDATE OF approval_state, disclosure_asset_id ON campaigns
  FOR EACH ROW EXECUTE FUNCTION campaign_disclosure_gate();

-- ---------------------------------------------------------------------------
-- D. Seed — the rule sets the spec enumerates
-- ---------------------------------------------------------------------------
--
-- Guarded so re-running is a no-op, in the style of 032's catalog seed.

INSERT INTO compliance_rules
  (org_id, rule_set, rule_key, offer_types, platforms, match_type, pattern, severity, message, citation)
SELECT o.id, v.rule_set, v.rule_key, v.offer_types::jsonb, v.platforms::jsonb,
       v.match_type, v.pattern, v.severity, v.message, v.citation
  FROM orgs o
  CROSS JOIN (VALUES
    -- 1. CROA — applies when offer_type = 'credit_repair'.
    ('croa', 'guaranteed-score-increase', '["credit_repair"]', '[]', 'regex',
     '(guarantee\w*|promis\w*|assur\w*)[^.!?]{0,40}(\d{2,3}\s*(\+|point|pt)|score\s*(increase|boost|jump|rise))|(\d{2,3}\s*point[s]?\s*(increase|boost|guarantee))',
     'block',
     'Promising a specific or guaranteed credit-score increase is prohibited. State what the service does, not what the score will do.',
     'CROA 15 U.S.C. 1679b(a)(3)'),

    ('croa', 'promise-to-remove-accurate-info', '["credit_repair"]', '[]', 'regex',
     '(remove|delete|erase|wipe|eliminate|clear)[^.!?]{0,40}(negative|derogatory|accurate|truthful|legitimate)[^.!?]{0,20}(item|informa|mark|entr|record)',
     'block',
     'Claiming to remove accurate or verifiable negative information is prohibited. Only inaccurate or unverifiable items may be disputed.',
     'CROA 15 U.S.C. 1679b(a)(3)'),

    ('croa', 'remove-late-payments-collections', '["credit_repair"]', '[]', 'regex',
     '(remove|delete|erase|wipe|eliminate|get\s+rid\s+of)[^.!?]{0,30}(late\s*payment|collection|charge[\s-]?off|bankruptc|repossess|foreclos|judgment|tax\s*lien)',
     'block',
     'Claiming to remove late payments, collections or similar accurate tradelines is prohibited.',
     'CROA 15 U.S.C. 1679b(a)(3)'),

    ('croa', 'advance-fee', '["credit_repair"]', '[]', 'regex',
     '(pay|fee|deposit|charge|\$\s*\d)[^.!?]{0,30}(upfront|up\s*front|in\s*advance|before\s+we\s+(start|begin)|to\s+get\s+started)|(upfront|up\s*front|advance)\s+(fee|payment|deposit)',
     'block',
     'Charging or advertising a fee before credit-repair services are fully performed is prohibited.',
     'CROA 15 U.S.C. 1679b(b)'),

    -- NOTE ON WORD BOUNDARIES. These patterns are compiled by BOTH Postgres (the
    -- validation trigger above) and JavaScript (src/compliance/screen.mjs), and
    -- the two disagree about boundary escapes: Postgres ARE spells word boundary
    -- \y and reads \b as a backspace character, while JavaScript spells it \b and
    -- reads \y as a literal "y". A pattern using either would compile in both and
    -- silently match nothing in one of them. (\y(cpn)\y in JS requires a literal
    -- "y" on each side, so the CPN rule would never fire — a compliance rule that
    -- reports clean because it cannot match is worse than no rule.) So boundaries
    -- are written as explicit character classes, which mean the same in both.
    ('croa', 'file-segregation-cpn', '["credit_repair"]', '[]', 'regex',
     '(^|[^a-z0-9])(cpn|credit\s*privacy\s*number|file\s*segregation|new\s*credit\s*(file|identity)|second\s*social|ein\s+instead\s+of\s+ssn)([^a-z0-9]|$)',
     'block',
     'File segregation, CPNs and new-credit-identity offers are federal fraud. This copy cannot run.',
     'CROA 15 U.S.C. 1679b(a)(1)-(2)'),

    ('croa', 'guaranteed-timeline', '["credit_repair"]', '[]', 'regex',
     '(guarantee\w*|promis\w*)[^.!?]{0,40}(\d+\s*(day|week|month))|(\d+\s*(day|week|month)[^.!?]{0,20}guarantee\w*)|results?\s+in\s+\d+\s*(day|week)s?\s+(guaranteed|or\s+your\s+money)',
     'block',
     'Guaranteeing a timeframe for credit-repair results is prohibited. Outcomes and timing vary by file.',
     'CROA 15 U.S.C. 1679b(a)(3)'),

    -- 2. Claims — ALL offer types (empty offer_types array).
    ('claims', 'guaranteed-approval', '[]', '[]', 'regex',
     '(guarantee\w*|100%|assured|no\s+way\s+to\s+be\s+denied)[^.!?]{0,30}(approv|accept|qualif)|approval\s+guaranteed|everyone\s+(is\s+)?approved',
     'block',
     'Guaranteed approval cannot be advertised. Approval depends on underwriting.',
     'FTC Act 15 U.S.C. 45'),

    ('claims', 'guaranteed-funding-amount', '[]', '[]', 'regex',
     '(guarantee\w*|assured|promis\w*|get)[^.!?]{0,25}\$\s*\d[\d,]*\s*(k|,000|000)?[^.!?]{0,15}(funding|capital|credit\s*line|approved)|\$\s*\d[\d,]*(k)?\s+guaranteed',
     'block',
     'Guaranteeing a specific funding amount is prohibited. Use "up to" with qualifying conditions stated.',
     'FTC Act 15 U.S.C. 45'),

    ('claims', 'fabricated-testimonial', '[]', '[]', 'regex',
     '(actor\s*portrayal\s*of\s*(a\s*)?real|paid\s+to\s+say|not\s+a\s+real\s+(client|customer)\s+but)|results\s+are\s+typical',
     'block',
     'Testimonials must be genuine and results disclaimed as atypical. "Results are typical" cannot be claimed.',
     'FTC Endorsement Guides 16 CFR 255'),

    ('claims', 'income-wealth-targeting-cue', '[]', '[]', 'regex',
     '(are\s+you\s+(broke|poor|struggling\s+financially))|(bad\s+credit\?\s*no\s+problem)|(low[\s-]income\s+(families|people|households)\s+(only|welcome))|(if\s+you\s+(make|earn)\s+(less|under)\s+\$)',
     'block',
     'Copy that targets or implies the viewer''s income or financial distress is prohibited in this vertical.',
     'Meta special ad category / ECOA'),

    -- 3. Disclosure — required PRESENCE, not absence.
    ('disclosure', 'croa-consumer-rights', '["credit_repair"]', '[]', 'required',
     'consumer\s+credit\s+file\s+rights\s+under\s+state\s+and\s+federal\s+law',
     'block',
     'Credit-repair funnels must carry the "Consumer Credit File Rights Under State and Federal Law" disclosure, linked to the campaign before launch.',
     'CROA 15 U.S.C. 1679c(a)'),

    -- 4. Platform — TikTok's outright prohibition, restated for the engine. The
    -- structural block is the CHECK in 046; this row is what produces a readable
    -- reason instead of a constraint name.
    ('platform', 'tiktok-credit-repair-prohibited', '["credit_repair"]', '["tiktok"]', 'regex',
     '.*',
     'block',
     'TikTok prohibits credit repair and debt relief advertising outright. This offer cannot run on TikTok on any account, with any creative.',
     'TikTok Advertising Policies — Prohibited Industries')
  ) AS v(rule_set, rule_key, offer_types, platforms, match_type, pattern, severity, message, citation)
 WHERE o.is_default
   AND NOT EXISTS (
     SELECT 1 FROM compliance_rules cr
      WHERE cr.org_id = o.id AND cr.rule_set = v.rule_set AND cr.rule_key = v.rule_key
   );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_compliance_rules_updated_at'
                    AND tgrelid = 'public.compliance_rules'::regclass) THEN
      CREATE TRIGGER trg_compliance_rules_updated_at BEFORE UPDATE ON compliance_rules
        FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    END IF;
  END IF;
END $$;
