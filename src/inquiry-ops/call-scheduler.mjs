// Call clock: delivery timestamp + configured business-day wait per bureau/channel.
// No statutory 30-day window. Fires existing bureau agents when due.

import { addBusinessDays } from "./business-days.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";
import { logAttempt } from "../inquiries/work.mjs";
import {
  normalizeMailServiceLevel,
  DEFAULT_MAIL_SERVICE_LEVEL,
  bureauMailAddress
} from "../messaging/providers/mail-letter.mjs";
import {
  placeCall as blandPlaceCall,
  resolveBureauDial,
  INQUIRY_VOICE_PROVIDER
} from "../messaging/providers/bland-voice.mjs";

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
 * PostGrid USPS mail class for a bureau. Per-send override wins when valid.
 * @returns {Promise<'first_class'|'priority'|'priority_express'>}
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

/** Load seeded P.O. Box address for a bureau; fall back to hardcoded constants. */
export async function loadBureauMailAddress(db, { orgId, bureau } = {}) {
  const code = String(bureau || "").toUpperCase();
  const hardcoded = bureauMailAddress(code);
  if (!orgId) return hardcoded;
  const r = await db.query(
    `SELECT bureau_code, bureau_name, mail_company_name, mail_address_line1,
            mail_address_line2, mail_address_city, mail_address_state,
            mail_address_zip, mail_address_country
       FROM ai_bureau_config
      WHERE org_id = $1::uuid AND bureau_code = $2
      LIMIT 1`,
    [orgId, code]
  );
  const row = r.rows[0];
  if (!row?.mail_address_line1) return hardcoded;
  return {
    bureau_code: row.bureau_code,
    bureau_name: row.bureau_name,
    company_name: row.mail_company_name || hardcoded?.company_name,
    address_line1: row.mail_address_line1,
    address_line2: row.mail_address_line2,
    address_city: row.mail_address_city,
    address_state: row.mail_address_state,
    address_zip: row.mail_address_zip,
    address_country: row.mail_address_country || "US"
  };
}

/**
 * Client return address for mailed disputes — client's own name + address,
 * never Fundhub. Reads clients + pii_identity.addresses[0].
 */
export async function loadClientReturnAddress(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return null;
  const clientR = await db.query(
    `SELECT first_name, last_name
       FROM clients
      WHERE id = $1::uuid AND org_id = $2::uuid
      LIMIT 1`,
    [clientId, orgId]
  );
  const client = clientR.rows[0];
  if (!client) return null;

  const idR = await db.query(
    `SELECT addresses
       FROM pii_identity
      WHERE client_id = $1::uuid AND org_id = $2::uuid
      LIMIT 1`,
    [clientId, orgId]
  );
  const addresses = idR.rows[0]?.addresses;
  const list = Array.isArray(addresses)
    ? addresses
    : (typeof addresses === "string" ? JSON.parse(addresses || "[]") : []);
  const addr = list[0] || null;
  if (!addr) return null;

  const line1 = addr.address_line1 || addr.addressLine1 || addr.line1 || addr.street || null;
  if (!line1) return null;

  return {
    first_name: client.first_name || null,
    last_name: client.last_name || null,
    address_line1: line1,
    address_line2: addr.address_line2 || addr.addressLine2 || addr.line2 || null,
    address_city: addr.address_city || addr.city || null,
    address_state: addr.address_state || addr.state || null,
    address_zip: addr.address_zip || addr.zip || addr.zip5 || addr.postal || null,
    address_country: addr.address_country || addr.country || "US"
  };
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
 * Places a Bland call to the bureau dispute line (inquiry-remover agents).
 * Does not dial the client. Sweeper stays unregistered.
 */
export async function fireDueCalls(db, {
  orgId,
  now = new Date(),
  staffId = null,
  limit = 50,
  placeCallImpl = blandPlaceCall,
  env = process.env,
  fetchImpl
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

    const dial = resolveBureauDial(caseRow.selected_bureaus_raw, env);

    let callStatus = "failed";
    let callNote = dial.ok ? "bland_place_failed" : (dial.error || "unknown_bureau");
    if (dial.ok) {
      const placed = await placeCallImpl({
        phone: dial.phone,
        task: dial.task,
        voicemailMessage: dial.voicemailMessage,
        maxDuration: dial.maxDuration,
        clientId: caseRow.client_id,
        orgId: caseRow.org_id,
        kind: dial.kind,
        metadata: {
          case_id: caseRow.id,
          bureau: dial.code,
          voice_provider: INQUIRY_VOICE_PROVIDER,
          source: "fireDueCalls"
        },
        db,
        fetchImpl,
        env
      });
      if (placed?.status === "sent" && placed.providerMessageId) {
        callStatus = "queued";
        callNote = `bland:${placed.providerMessageId}`;
      } else {
        callNote = placed?.error || placed?.status || "bland_place_failed";
      }
    }

    const upd = await db.query(
      `UPDATE inquiry_removal_cases
          SET call_fired_at = $2::timestamptz,
              ai_call_status = $3,
              master_call_state = $3,
              updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [caseRow.id, now.toISOString(), callStatus]
    );
    fired.push({ ...upd.rows[0], place_note: callNote });
  }
  return { fired, count: fired.length };
}

/** Resolve case by PostGrid letter id and mark mail delivered (never off send). */
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
