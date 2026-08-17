// Per-partner marketing suite switch, token meter, and hard cap.
//
// Meter only. Nothing here writes an invoice or talks to Commas.

export const DEFAULT_TOKEN_CAP = 250000;
export const SUITE_OFF = "suite_off";
export const CAP_HIT = "token_cap";

export function canAccessPartnerMarketing(principal, partnerId) {
  if (principal && principal.kind === "partner") {
    return Boolean(principal.partnerId && principal.partnerId === partnerId);
  }
  const staff = principal && (principal.staff || principal);
  const role = String((staff && staff.role) || "").trim().toLowerCase();
  return role === "owner" || role === "admin";
}

export function isOwner(principal) {
  if (!principal || principal.kind !== "staff") return false;
  const role = String(principal.role || principal.staff?.role || "").trim().toLowerCase();
  return role === "owner";
}

export async function loadSuiteSettings(db, partnerId) {
  const r = await db.query(
    `SELECT marketing_suite_enabled, ai_token_cap_monthly, org_id
       FROM partner_module_settings
      WHERE partner_id = $1`,
    [partnerId]
  );
  if (r.rows[0]) {
    return {
      enabled: r.rows[0].marketing_suite_enabled === true,
      cap: Number(r.rows[0].ai_token_cap_monthly) || DEFAULT_TOKEN_CAP,
      orgId: r.rows[0].org_id,
      hasRow: true
    };
  }
  const p = await db.query(`SELECT org_id FROM partners WHERE id = $1`, [partnerId]);
  return {
    enabled: false,
    cap: DEFAULT_TOKEN_CAP,
    orgId: p.rows[0]?.org_id || null,
    hasRow: false
  };
}

export async function assertSuiteEnabled(db, partnerId) {
  const s = await loadSuiteSettings(db, partnerId);
  if (!s.enabled) {
    const e = new Error("this partner's marketing suite is off");
    e.code = SUITE_OFF;
    throw e;
  }
  return s;
}

export async function usageThisMonth(db, partnerId) {
  const r = await db.query(
    `SELECT COALESCE(SUM(input_tokens + output_tokens), 0)::int AS used
       FROM partner_ai_usage
      WHERE partner_id = $1
        AND created_at >= date_trunc('month', timezone('utc', now()))`,
    [partnerId]
  );
  return Number(r.rows[0]?.used) || 0;
}

export async function remainingTokens(db, partnerId) {
  const s = await loadSuiteSettings(db, partnerId);
  const used = await usageThisMonth(db, partnerId);
  return {
    enabled: s.enabled,
    cap: s.cap,
    used,
    remaining: Math.max(0, s.cap - used),
    orgId: s.orgId
  };
}

export async function assertUnderCap(db, partnerId, estimate = 1) {
  const snap = await remainingTokens(db, partnerId);
  if (snap.remaining < Math.max(1, Number(estimate) || 1)) {
    const e = new Error("this partner has used this month's writing budget");
    e.code = CAP_HIT;
    e.usage = snap;
    throw e;
  }
  return snap;
}

export async function recordUsage(db, {
  orgId, partnerId, purpose, sourceId = null,
  inputTokens = 0, outputTokens = 0, model = null
} = {}) {
  if (!orgId || !partnerId) throw new Error("recordUsage: orgId and partnerId are required");
  const ins = await db.query(
    `INSERT INTO partner_ai_usage
       (org_id, partner_id, purpose, source_id, input_tokens, output_tokens, model)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, input_tokens, output_tokens, created_at`,
    [orgId, partnerId, purpose,
     sourceId,
     Math.max(0, Math.round(Number(inputTokens) || 0)),
     Math.max(0, Math.round(Number(outputTokens) || 0)),
     model]
  );
  return ins.rows[0];
}

export async function setSuiteEnabled(db, { orgId, partnerId, enabled }) {
  if (!orgId || !partnerId) throw new Error("setSuiteEnabled: orgId and partnerId are required");
  const on = enabled === true;
  const r = await db.query(
    `INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
     VALUES ($1,$2,$3)
     ON CONFLICT (partner_id) DO UPDATE
       SET marketing_suite_enabled = EXCLUDED.marketing_suite_enabled,
           updated_at = now()
     RETURNING marketing_suite_enabled, ai_token_cap_monthly`,
    [orgId, partnerId, on]
  );
  return {
    enabled: r.rows[0].marketing_suite_enabled === true,
    cap: Number(r.rows[0].ai_token_cap_monthly) || DEFAULT_TOKEN_CAP
  };
}

export default {
  DEFAULT_TOKEN_CAP, SUITE_OFF, CAP_HIT,
  canAccessPartnerMarketing, isOwner,
  loadSuiteSettings, assertSuiteEnabled,
  usageThisMonth, remainingTokens, assertUnderCap,
  recordUsage, setSuiteEnabled
};
