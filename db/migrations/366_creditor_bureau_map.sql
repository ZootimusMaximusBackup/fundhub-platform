-- 366_creditor_bureau_map.sql — which bureau a creditor pulls, by state.
--
-- Reference data for inquiry removal and card stacking: given a creditor name
-- on a credit report and the client's state, which bureau did that pull hit.
-- Source is docs/legacy-strong/inquiry-master-database.csv (Alec / Legacy
-- Strong, 5,443 raw rows). The rows land in db/seed/025_creditor_bureau_map.sql.
-- OCR variants in the source ("Exporian", "TranaUnion", "Equilax") are
-- normalised to EX / TU / EQ at generation time; 135 unparseable rows and 63
-- state-header rows were dropped, not guessed.
--
-- Global reference data: no org_id. RLS is switched on WITH a policy, in the
-- same breath, so src/security/rls-shape.test.mjs cannot fail a build on it the
-- way it failed six of them on 2026-09-06 (see 364).

CREATE TABLE IF NOT EXISTS public.creditor_bureau_map (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state         char(2) NOT NULL,
  creditor      text NOT NULL,
  creditor_key  text NOT NULL,
  bureau        text NOT NULL CHECK (bureau IN ('EX','EQ','TU')),
  source        text NOT NULL DEFAULT 'legacy-strong/inquiry-master-database.csv',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (state, creditor_key)
);
CREATE INDEX IF NOT EXISTS creditor_bureau_map_key_idx ON public.creditor_bureau_map (creditor_key);

ALTER TABLE public.creditor_bureau_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creditor_bureau_map FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS creditor_bureau_map_app_all ON public.creditor_bureau_map;
CREATE POLICY creditor_bureau_map_app_all ON public.creditor_bureau_map FOR ALL USING (true) WITH CHECK (true);
