# W4a — Supabase branch rehearsal (revised 2026-08-12)

**Status:** **PLAN ONLY — not executed**  
**Provider:** Supabase (production project `oqpnlusrotpxfenysfxz`)  
**Neon:** dropped. Do not ask for Neon. Do not use Neon.

## Why this rewrite

Earlier W4a text asked for a Neon branch. Wrong target. Prod is Supabase.  
Rehearsal = **Supabase database branch** off production, then apply 160 → 161 there only.

## Standing gates (owner-set)

1. **161 UPDATEs** approved in principle only.
2. W4a reports **card-count-per-stage BEFORE and AFTER** the 161 remap.
3. Flag any card whose stage after remap is **not** one of the intended new keys (or still on a retired key).
4. **Nothing touches production** until W4a is green **AND** owner says **go**.
5. **Forbidden command form** (do not run against prod):
   ```bash
   DATABASE_URL="$(netlify env:get MIGRATION_DATABASE_URL --context production)" node db/migrate.mjs
   ```
   `migrate.mjs` applies **every** pending file in order. If pending is still `160` + `161`, that hits production remaps before the card-count gate.

## Target

| Item | Value |
|------|--------|
| Source | Production Supabase project `oqpnlusrotpxfenysfxz` |
| Rehearsal | New **Supabase branch** cloned from production |
| Connection | Branch `DATABASE_URL` / pooler URI — gitignored only; never commit |
| Netlify prod env | **unchanged** this phase |

## W4a steps (when owner says run — not now)

1. Confirm branch URL points at the **branch**, not production (host / project ref / branch name check).
2. Snapshot **BEFORE 161** on the branch:
   ```sql
   SELECT ps.key, count(c.id) AS cards
   FROM pipeline_stages ps
   JOIN pipelines p ON p.id = ps.pipeline_id AND p.key = 'optimization'
   LEFT JOIN cards c ON c.stage_id = ps.id
   GROUP BY ps.key
   ORDER BY ps.key;
   ```
3. Apply **only** `160_metro2_dispute_engine.sql` on the branch (explicit single-file apply — not bare `migrate.mjs` against an unknown pending set). Record in branch `schema_migrations`.
4. Apply **only** `161_optimization_repair_pipeline.sql` on the branch. Record.
5. Snapshot **AFTER 161** with the same card-count query.
6. Diff before → after. Expected remaps:
   - `round_sent` → `in_transit`
   - `bureau_processing` → `awaiting_response`
   - `portal_updated` → `response_received`
   - `upgrade_invite` → `program_complete`
7. **Flags (fail W4a if any > 0):**
   - Cards still on retired keys: `round_sent`, `bureau_processing`, `portal_updated`, `upgrade_invite`
   - Cards on any optimization stage key **outside** intended new keys + known retired (empty) keys
8. Optional: additive 160 smoke (dispute case / letter write) on branch only.
9. Write evidence to `docs/workflows/e2e-verify-run4-evidence/w4a/` and mark this board **PASS** or **FAIL**.

## W4b (later — blocked)

- Only after W4a **PASS** + explicit owner **go**.
- Prod apply must be a **controlled** apply of the approved files — never the forbidden one-liner that blindly drains all pending against production without the card-count gate in the same turn.

## What this turn did / did not do

| Done | Not done |
|------|----------|
| Pushed `eb45dea` → `origin/main` | Did not create Supabase branch |
| Rewrote W4a for Supabase branch | Did not run any migration |
| Posted this plan | Did not touch production schema |
