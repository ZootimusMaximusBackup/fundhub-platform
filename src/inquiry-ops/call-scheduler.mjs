// Call clock: delivery timestamp + configured business-day wait per bureau/channel.
// No statutory 30-day window. Fires existing bureau agents when due.

import { addBusinessDays } from "./business-days.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { logAttempt } from "../inquiries/work.mjs";
import {
  normalizeMailServiceLevel,
  DEFAULT_MAIL_SERVICE_LEVEL
} from "../messaging/providers/lob-letter.mjs";

const DEFAULT_WAIT = Object.freeze({ portal: 1, mail: 3 });

/**
 * Load wait days for a bureau + channel from ai_bureau_config.
 */
export async function loadWaitBusinessDays(db, { orgId, bureau, channel }) {
  const code = String(bureau || "").toUpperCase();
  const ch = String(channel || "mail").toLowerCase() === "portal" ? "portal" : "mail";
  const r = await db.query(
    `SELECT portal_wait_business_days, mail_wait_business_days
       FROM ai_bureau_config
      WHERE org_id = $1::uuid AND bureau_code = $2
      LIMIT 1`,
    [orgId, code]
  );
  const row = r.rows[0];
  if (!row) return DEFAULT_WAIT[ch];
  const n = ch === "portal"
    ? Number(row.portal_wait_business_days)
    : Number(row.mail_wait_business_days);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_WAIT[ch];
}

/**
 * Lob mail service level for a bureau. Per-send override wins when valid.
 * @returns {Promise<'priority'|'priority_express'>}
 */
export async function loadMailServiceLevel(db, { orgId, bureau, override = null } = {}) {
  if (override != null && String(override).trim() !== "") {
    return normalizeMailServiceLevel(override, DEFAULT_MAIL_SERVICE_LEVEL);
  }
  const code = String(bureau || "").toUpperCase();
  const r = await db.query(
    `SELECT mail_service_level
       FROM ai_bureau_config
      WHERE org_id = $1::uuid AND bureau_code = $2
      LIMIT 1`,
    [orgId, code]
  );
  return normalizeMailServiceLevel(r.rows[0]?.mail_service_level, DEFAULT_MAIL_SERVICE_LEVEL);
}

/**
 * Record first delivery (if earlier/unset) and compute call_due_at from config.
 * Never schedules off send time — only off delivery.
 */
export async function scheduleFromDelivery(db, {
  caseId,
  orgId,
  deliveredAt,
  channel,
  providerId = null
} = {}) {
  if (!caseId || !orgId || !deliveredAt || !channel) {
    throw new Error("caseId, orgId, deliveredAt, channel required");
  }
  const ch = channel === "portal" ? "portal" : "mail";
  const when = new Date(deliveredAt);
  if (!Number.isFinite(when.getTime())) throw new Error("invalid deliveredAt");

  const caseR = await db.query(
    `SELECT * FROM inquiry_removal_cases WHERE id = $1::uuid AND org_id = $2::uuid`,
    [caseId, orgId]
  );
  const caseRow = caseR.rows[0];
  if (!caseRow) throw new Error("case not found");

  // First delivery wins — ignore later channels.
  if (caseRow.first_delivery_at) {
    return { case: caseRow, scheduled: false, reason: "already_scheduled" };
  }

  const waitDays = await loadWaitBusinessDays(db, {
    orgId,
    bureau: caseRow.selected_bureaus_raw,
    channel: ch
  });
  const due = addBusinessDays(when, waitDays);

  const upd = await db.query(
    `UPDATE inquiry_removal_cases
        SET first_delivery_at = $2::timestamptz,
            first_delivery_channel = $3,
            call_due_at = $4::timestamptz,
            letter_provider_id = COALESCE($5, letter_provider_id),
            case_status = 'In Progress'::inquiry_case_status,
            updated_at = now()
      WHERE id = $1
        AND first_delivery_at IS NULL
      RETURNING *`,
    [caseId, when.toISOString(), ch, due.toISOString(), providerId]
  );

  const row = upd.rows[0] || caseRow;
  await moveCardToStage(db, {
    orgId,
    clientId: row.client_id,
    pipelineKey: "inquiry_removal",
    stageKey: "calls_in_progress"
  });

  return { case: row, scheduled: true, waitDays, callDueAt: due };
}

/**
 * Fire AI bureau calls for cases whose call_due_at has elapsed.
 * Writes kind=call attempts. Does not invent a new agent runtime — enqueues
 * via inquiry_log call_state + attempt row for the existing voice path.
 */
export async function fireDueCalls(db, {
  orgId,
  now = new Date(),
  staffId = null,
  limit = 50
} = {}) {
  const params = [now.toISOString(), Math.min(Math.max(Number(limit) || 50, 1), 200)];
  let orgClause = "";
  if (orgId) {
    params.push(orgId);
    orgClause = `AND org_id = $${params.length}::uuid`;
  }
  const due = await db.query(
    `SELECT *
       FROM inquiry_removal_cases
      WHERE call_due_at IS NOT NULL
        AND call_due_at <= $1::timestamptz
        AND call_fired_at IS NULL
        AND case_status::text = ANY(ARRAY['In Progress','Queued','Scheduled'])
        ${orgClause}
      ORDER BY call_due_at ASC
      LIMIT $2`,
    params
  );

  const fired = [];
  for (const caseRow of due.rows) {
    // System staff fallback: use gate_override or first inquiry_specialist — if
    // no staffId, skip attempt write but still stamp call_fired_at so we don't loop.
    let actor = staffId;
    if (!actor) {
      const s = await db.query(
        `SELECT id FROM staff
          WHERE org_id = $1::uuid
            AND role IN ('inquiry_specialist','owner')
            AND status = 'active'
          ORDER BY role = 'inquiry_specialist' DESC
          LIMIT 1`,
        [caseRow.org_id]
      );
      actor = s.rows[0]?.id || null;
    }

    const inquiries = await db.query(
      `SELECT id FROM inquiry_log
        WHERE inquiry_removal_case_id = $1::uuid AND is_open = true`,
      [caseRow.id]
    );

    if (actor) {
      for (const inq of inquiries.rows) {
        await logAttempt(db, {
          inquiryId: inq.id,
          staffId: actor,
          orgId: caseRow.org_id,
          kind: "call",
          outcome: "queued",
          note: `auto_call_due bureau=${caseRow.selected_bureaus_raw} channel=${caseRow.first_delivery_channel}`
        });
      }
    }

    const upd = await db.query(
      `UPDATE inquiry_removal_cases
          SET call_fired_at = $2::timestamptz,
              ai_call_status = 'queued',
              master_call_state = 'queued',
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [caseRow.id, now.toISOString()]
    );
    fired.push(upd.rows[0]);
  }
  return { fired, count: fired.length };
}

/** Resolve case by Lob letter provider id and mark mail delivered. */
export async function onMailDelivered(db, { orgId, providerId, deliveredAt }) {
  if (!providerId) return { ok: false, reason: "no_provider_id" };
  const r = await db.query(
    `SELECT * FROM inquiry_removal_cases
      WHERE letter_provider_id = $1
        AND ($2::uuid IS NULL OR org_id = $2::uuid)
      ORDER BY updated_at DESC
      LIMIT 1`,
    [providerId, orgId || null]
  );
  const caseRow = r.rows[0];
  if (!caseRow) return { ok: false, reason: "case_not_found" };
  return scheduleFromDelivery(db, {
    caseId: caseRow.id,
    orgId: caseRow.org_id,
    deliveredAt: deliveredAt || new Date().toISOString(),
    channel: "mail",
    providerId
  });
}
