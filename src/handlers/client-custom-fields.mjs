// Typed carbon-copy of cf_svy_* survey answers onto client_custom_fields.
// Source of truth stays clients.custom_fields (jsonb). This table is what sales/
// agents join for typed columns — RUN4 found rows=0 because no writer existed.

/** Columns that exist on client_custom_fields as typed cf_svy_* fields. */
export const CF_SVY_TYPED_COLUMNS = Object.freeze([
  "cf_svy_tried_restoration_before",
  "cf_svy_your_why",
  "cf_svy_planned_use",
  "cf_svy_annual_income_range",
  "cf_svy_money_change_now",
  "cf_svy_income_verifiable",
  "cf_svy_what_matters_most",
  "cf_svy_self_reported_fico",
  "cf_svy_funding_target_amount",
  "cf_svy_clarity_first",
  "cf_svy_has_business",
  "cf_svy_business_revenue",
  "cf_svy_revenue_verifiable",
  "cf_svy_available_capital",
  "cf_svy_has_negatives",
]);

/** Postgres text[] columns — answers may arrive as array or single string. */
export const CF_SVY_ARRAY_COLUMNS = Object.freeze(new Set(["cf_svy_money_change_now"]));

/**
 * Pick only known typed cf_svy_* keys from a survey answers object.
 * @param {Record<string, unknown>} answers
 * @returns {Record<string, unknown>}
 */
export function pickTypedSurveyAnswers(answers) {
  if (!answers || typeof answers !== "object") return {};
  const out = {};
  for (const key of CF_SVY_TYPED_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(answers, key)) continue;
    const v = answers[key];
    if (v === undefined || v === null) continue;
    if (CF_SVY_ARRAY_COLUMNS.has(key)) {
      if (Array.isArray(v)) out[key] = v.map((x) => String(x));
      else if (String(v).trim() !== "") out[key] = [String(v)];
      continue;
    }
    const s = String(v).trim();
    if (s !== "") out[key] = s;
  }
  return out;
}

/**
 * Upsert typed cf_svy_* columns for one client.
 * No-op when nothing to write. Idempotent under ON CONFLICT.
 *
 * @param {{ query: Function }} db
 * @param {{ clientId: string, orgId: string, answers: Record<string, unknown> }} args
 */
export async function upsertSurveyCarbonCopy(db, { clientId, orgId, answers }) {
  if (!db || !clientId || !orgId) return { written: 0 };
  const patch = pickTypedSurveyAnswers(answers);
  const keys = Object.keys(patch);
  if (keys.length === 0) return { written: 0 };

  const cols = ["client_id", "org_id", ...keys];
  const params = [clientId, orgId, ...keys.map((k) => patch[k])];
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const updates = keys.map((k) => `${k} = EXCLUDED.${k}`);

  await db.query(
    `INSERT INTO client_custom_fields (${cols.join(", ")}, updated_at)
     VALUES (${placeholders.join(", ")}, now())
     ON CONFLICT (client_id) DO UPDATE SET
       ${updates.join(", ")},
       org_id = EXCLUDED.org_id,
       updated_at = now()`,
    params
  );
  return { written: keys.length };
}
