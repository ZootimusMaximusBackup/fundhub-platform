// GET /api/dashboard/pipeline?key=sales
//
// The board, as the database actually holds it: the pipeline's stages in
// sort_order, each with the client cards currently sitting in it.
//
// This exists because /api/dashboard/clients returns journey flags
// (crs_paid, deposit_paid, sale_closed) but no stage, and a board built by
// inferring stage from payment flags would be a guess dressed as data. The
// real position is cards.stage_id — one row per client per pipeline — so the
// board reads it directly and no mapping is invented anywhere.
//
// Read-only. SELECT only. Mirrors api/dashboard/clients.mjs style.
import { db } from "../../src/db.mjs";
import { requireDashboardAccess } from "../../src/http/dashboard-auth.mjs";
import { boundedLimit, CLIENT_DATA_ERRORS, requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { safeError } from "../../src/http/health.mjs";
import { orgDemoModeEnabled } from "../../src/demo/exclude-demo.mjs";
import { surveyFicoBand } from "../../src/survey/cf-question-map.mjs";

// Stages first, so a stage with no cards still renders as an empty column
// rather than vanishing from the board. Org always from the session.
const STAGES_SQL = `
  SELECT s.id, s.key, s.name, s.sort_order
    FROM pipeline_stages s
    JOIN pipelines p ON p.id = s.pipeline_id
   WHERE p.key = $1 AND p.org_id = $2
   ORDER BY s.sort_order ASC, s.name ASC
`;

const CARDS_SQL = `
  SELECT
    cd.id,
    cd.stage_id,
    cd.owner,
    cd.entered_at,
    c.id            AS client_id,
    c.first_name,
    c.last_name,
    c.email,
    c.phone,
    c.outcome_tier,
    c.funded,
    c.funded_amount,
    c.is_demo,
    (c.custom_fields->>'total_funding_estimate') AS total_funding_estimate,
    c.custom_fields->>'cf_svy_self_reported_fico' AS survey_fico_raw,
    c.custom_fields->>'cf_svy_self_reported_fico_label' AS survey_fico_label,
    pr.name AS partner_name,
    pr.contact_email AS partner_email,
    EXISTS (
      SELECT 1
        FROM conversations conv
        JOIN LATERAL (
          SELECT m.direction
            FROM messages m
           WHERE m.conversation_id = conv.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
        ) last ON true
       WHERE conv.client_id = c.id
         AND conv.org_id = p.org_id
         AND conv.channel IN ('sms', 'text')
         AND last.direction = 'inbound'
    ) AS sms_needs_reply,
    EXISTS (
      SELECT 1
        FROM conversations conv
        JOIN LATERAL (
          SELECT m.direction
            FROM messages m
           WHERE m.conversation_id = conv.id
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
        ) last ON true
       WHERE conv.client_id = c.id
         AND conv.org_id = p.org_id
         AND conv.channel = 'email'
         AND last.direction = 'inbound'
    ) AS email_needs_reply,
    /* A BANK SAID YES AND NOBODY HAS RECORDED HOW MUCH.
       An approved amount is optional at the moment a bank comes back
       (owner-set 2026-08-29) — the fulfillment team often has to ask the
       client or wait for the bank's approval email before they know the limit.
       That is allowed, but it cannot be allowed to rot: until the dollars are
       in, that approval is left out of the round's lender breakdown
       (src/funding/closeout.mjs filters COALESCE(approved_amount,0) > 0), so
       the client is never billed a success fee for it.
       NULL means UNKNOWN here, and only NULL. A recorded 0 is a fact somebody
       entered and is not flagged. */
    EXISTS (
      SELECT 1
        FROM applications a
       WHERE a.client_id = c.id
         AND a.org_id = p.org_id
         AND a.status = 'Approved'
         AND a.approved_amount IS NULL
    ) AS approval_amount_missing
  FROM cards cd
  JOIN pipelines p ON p.id = cd.pipeline_id
  LEFT JOIN clients c ON c.id = cd.client_id AND c.org_id = p.org_id
  LEFT JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = p.org_id
  WHERE p.key = $1 AND p.org_id = $2 AND cd.org_id = $2
    AND (c.id IS NOT NULL OR pr.id IS NOT NULL)
    AND ($4::boolean OR COALESCE(c.is_demo, false) = false)
    AND (c.custom_fields->>'crm_archived_at' IS NULL)
  ORDER BY cd.entered_at DESC
  LIMIT $3
`;

export default async function handler(req, res) {
  // Staff session first; DASHBOARD_SECRET stays as the fallback until cutover,
  // matching the other dashboard routes.
  // GET only. These answered POST/PUT/DELETE/PATCH with 200 and the full
  // client book, so any method reached read data that only GET should serve.
  if (req.method && req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await requireDashboardAccess(req, res, { db });
  if (!staff) return;
  if (staff !== true && !requireRole(res, staff, ROLE_SETS.STAFF)) return;
  // Org from the session ONLY. Pipeline key alone used to cross every company
  // that shared a key name (e.g. "sales").
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const key = String(req.query?.key || "sales");
  const limit = boundedLimit(req.query?.limit, { fallback: 500, cap: 2000 });

  try {
    const stagesRes = await db.query(STAGES_SQL, [key, orgId]);
    if (stagesRes.rows.length === 0) {
      return res.status(404).json({ ok: false, error: "unknown_pipeline", key });
    }
    const demoOn = await orgDemoModeEnabled(db, orgId);
    const cardsRes = await db.query(CARDS_SQL, [key, orgId, limit, demoOn]);

    // Group in one pass; a card whose stage was filtered out is dropped rather
    // than silently re-homed into the first column.
    const byStage = new Map(stagesRes.rows.map((s) => [s.id, []]));
    for (const r of cardsRes.rows) {
      const bucket = byStage.get(r.stage_id);
      if (!bucket) continue;
      const est = r.funded_amount ?? r.total_funding_estimate ?? null;
      bucket.push({
        id: r.id,
        client_id: r.client_id,
        name: (r.is_demo ? "DEMO · " : "") + ([r.first_name, r.last_name].filter(Boolean).join(" ") || r.partner_name || "(unnamed)"),
        email: r.email || r.partner_email || null,
        phone: r.phone || null,
        sms_needs_reply: !!r.sms_needs_reply,
        email_needs_reply: !!r.email_needs_reply,
        // One approval on this client's file said yes with no dollar amount.
        approval_amount_missing: !!r.approval_amount_missing,
        owner: r.owner ?? null,
        entered_at: r.entered_at,
        outcome_tier: r.outcome_tier ?? null,
        funded: r.funded ?? false,
        amount: est === null ? null : Number(est),
        is_demo: !!r.is_demo,
        survey_fico: surveyFicoBand({
          cf_svy_self_reported_fico: r.survey_fico_raw,
          cf_svy_self_reported_fico_label: r.survey_fico_label
        })
      });
    }

    const stages = stagesRes.rows.map((s) => {
      const cards = byStage.get(s.id) || [];
      return {
        key: s.key,
        name: s.name,
        sort_order: s.sort_order,
        count: cards.length,
        // Column money is the sum of what is actually in the column, so it can
        // never disagree with the cards under it.
        amount: cards.reduce((a, c) => a + (c.amount || 0), 0),
        cards
      };
    });

    return res.status(200).json({
      ok: true,
      pipeline: key,
      stages,
      total: cardsRes.rows.length
    });
  } catch (err) {
    /* Not everything is an outage. This reported EVERY failure as
       503 db:"down", including a caller's bad parameter, so a malformed query
       string told every screen the database was unreachable — and echoed the
       raw driver message while doing it. Classify first, scrub the rest. */
    if (CLIENT_DATA_ERRORS.has(err && err.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    return res.status(503).json({ ok: false, db: "down", error: safeError(err) });
  }
}
