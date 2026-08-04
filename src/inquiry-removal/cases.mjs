// Domain writes for inquiry_removal_cases + linked inquiry_log rows.
//
// Called from:
//   - src/adapters/inquiry-removal.mjs (signed inbound webhook from IRA)
//   - api/inquiry-cases.mjs (staff Mark Cleared / Close Case)
//
// Does not transmit anywhere. Emits inquiry.removed via the caller when a case
// clears — keep emit() out of this module so unit tests do not need the bus.

export class InquiryCaseError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "InquiryCaseError";
    this.status = status;
  }
}

const ACTIVE_STATUSES = new Set([
  "Open", "Scheduled", "Calling", "Awaiting Remover", "Call Failed"
]);

const CALL_STATES = new Set([
  "queued", "dialing", "ivr", "holding",
  "live_agent_reached", "transferred_to_rep",
  "completed", "failed", "idle"
]);

const INQUIRY_CALL_STATES = new Set([
  "queued", "dialing", "ivr", "holding",
  "live_agent_reached", "transferred_to_rep"
]);

export function isActiveCaseStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

async function resolveOrgClient(db, { orgId, clientId }) {
  if (!clientId) throw new InquiryCaseError("client_id is required", { status: 400 });
  const res = await db.query(
    `SELECT id, org_id FROM clients WHERE id = $1`,
    [clientId]
  );
  const row = res.rows[0];
  if (!row) throw new InquiryCaseError("client not found", { status: 404 });
  if (orgId && String(row.org_id) !== String(orgId)) {
    throw new InquiryCaseError("client not in org", { status: 404 });
  }
  return { clientId: row.id, orgId: row.org_id };
}

async function refreshOpenCount(db, caseId) {
  const res = await db.query(
    `UPDATE inquiry_removal_cases c
        SET open_inquiry_count = (
              SELECT COUNT(*)::int FROM inquiry_log i
               WHERE i.case_id = c.id AND i.is_open = true
            ),
            updated_at = now()
      WHERE c.id = $1
      RETURNING *`,
    [caseId]
  );
  return res.rows[0] || null;
}

/**
 * Upsert a case from the IRA webhook (case.created / case.updated).
 */
export async function upsertCase(db, input = {}) {
  const { clientId, orgId } = await resolveOrgClient(db, {
    orgId: input.orgId || input.org_id,
    clientId: input.clientId || input.client_id
  });

  const externalCaseId = input.externalCaseId || input.external_case_id || null;
  const caseStatus = input.caseStatus || input.case_status || "Open";
  const selectedBureaus = input.selectedBureausRaw || input.selected_bureaus_raw || null;
  const requestedBy = input.requestedBy || input.requested_by || null;
  const requestedAt = input.requestedAt || input.requested_at || null;
  const masterCallState = input.masterCallState || input.master_call_state || null;
  if (masterCallState && !CALL_STATES.has(masterCallState)) {
    throw new InquiryCaseError(`invalid master_call_state: ${masterCallState}`, { status: 400 });
  }

  let existing = null;
  if (input.caseId || input.case_id) {
    const r = await db.query(`SELECT * FROM inquiry_removal_cases WHERE id = $1`, [input.caseId || input.case_id]);
    existing = r.rows[0] || null;
  } else if (externalCaseId) {
    const r = await db.query(
      `SELECT * FROM inquiry_removal_cases WHERE org_id = $1 AND external_case_id = $2`,
      [orgId, externalCaseId]
    );
    existing = r.rows[0] || null;
  }

  if (existing) {
    const res = await db.query(
      `UPDATE inquiry_removal_cases SET
          case_status = COALESCE($2, case_status),
          selected_bureaus_raw = COALESCE($3, selected_bureaus_raw),
          requested_by = COALESCE($4, requested_by),
          requested_at = COALESCE($5::timestamptz, requested_at),
          master_call_state = COALESCE($6, master_call_state),
          call_batch_id = COALESCE($7, call_batch_id),
          voice_provider = COALESCE($8, voice_provider),
          attempt_count = COALESCE($9::int, attempt_count),
          hold_started_at = COALESCE($10::timestamptz, hold_started_at),
          live_agent_reached_at = COALESCE($11::timestamptz, live_agent_reached_at),
          rep_handoff_at = COALESCE($12::timestamptz, rep_handoff_at),
          last_dtmf_path = COALESCE($13, last_dtmf_path),
          call_outcome_summary = COALESCE($14, call_outcome_summary),
          remover_notes = COALESCE($15, remover_notes),
          updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [
        existing.id,
        caseStatus,
        selectedBureaus,
        requestedBy,
        requestedAt,
        masterCallState,
        input.callBatchId || input.call_batch_id || null,
        input.voiceProvider || input.voice_provider || null,
        input.attemptCount ?? input.attempt_count ?? null,
        input.holdStartedAt || input.hold_started_at || null,
        input.liveAgentReachedAt || input.live_agent_reached_at || null,
        input.repHandoffAt || input.rep_handoff_at || null,
        input.lastDtmfPath || input.last_dtmf_path || null,
        input.callOutcomeSummary || input.call_outcome_summary || null,
        input.removerNotes || input.remover_notes || null
      ]
    );
    const row = res.rows[0];
    await syncInquiries(db, row, input.inquiries || []);
    return refreshOpenCount(db, row.id);
  }

  const res = await db.query(
    `INSERT INTO inquiry_removal_cases (
       org_id, client_id, external_case_id, case_status,
       requested_by, requested_at, selected_bureaus_raw,
       master_call_state, call_batch_id, voice_provider, attempt_count,
       hold_started_at, live_agent_reached_at, rep_handoff_at,
       last_dtmf_path, call_outcome_summary, remover_notes
     ) VALUES (
       $1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,COALESCE($11::int,0),
       $12::timestamptz,$13::timestamptz,$14::timestamptz,$15,$16,$17
     ) RETURNING *`,
    [
      orgId, clientId, externalCaseId, caseStatus,
      requestedBy, requestedAt, selectedBureaus,
      masterCallState,
      input.callBatchId || input.call_batch_id || null,
      input.voiceProvider || input.voice_provider || "bland",
      input.attemptCount ?? input.attempt_count ?? 0,
      input.holdStartedAt || input.hold_started_at || null,
      input.liveAgentReachedAt || input.live_agent_reached_at || null,
      input.repHandoffAt || input.rep_handoff_at || null,
      input.lastDtmfPath || input.last_dtmf_path || null,
      input.callOutcomeSummary || input.call_outcome_summary || null,
      input.removerNotes || input.remover_notes || null
    ]
  );
  const row = res.rows[0];
  await syncInquiries(db, row, input.inquiries || []);
  return refreshOpenCount(db, row.id);
}

async function syncInquiries(db, caseRow, inquiries) {
  if (!Array.isArray(inquiries) || inquiries.length === 0) return;
  for (const inq of inquiries) {
    await upsertInquiry(db, {
      orgId: caseRow.org_id,
      clientId: caseRow.client_id,
      caseId: caseRow.id,
      ...inq
    });
  }
}

export async function upsertInquiry(db, input = {}) {
  const orgId = input.orgId || input.org_id;
  const clientId = input.clientId || input.client_id;
  const caseId = input.caseId || input.case_id || null;
  const externalInquiryId = input.externalInquiryId || input.external_inquiry_id || null;
  const bureau = input.bureau || null;
  const inquiryName = input.inquiryName || input.inquiry_name || input.inquiry || null;
  const callState = input.callState || input.call_state || null;
  if (callState && !INQUIRY_CALL_STATES.has(callState)) {
    throw new InquiryCaseError(`invalid call_state: ${callState}`, { status: 400 });
  }
  const status = input.status || "Open";
  const isOpen = input.isOpen ?? input.is_open ?? !/^(cleared|removed|confirmed|deleted)$/i.test(status);

  let existing = null;
  if (externalInquiryId && orgId) {
    const r = await db.query(
      `SELECT * FROM inquiry_log WHERE org_id = $1 AND external_inquiry_id = $2`,
      [orgId, externalInquiryId]
    );
    existing = r.rows[0] || null;
  } else if (input.inquiryId || input.inquiry_id) {
    const r = await db.query(`SELECT * FROM inquiry_log WHERE id = $1`, [input.inquiryId || input.inquiry_id]);
    existing = r.rows[0] || null;
  }

  if (existing) {
    const res = await db.query(
      `UPDATE inquiry_log SET
          case_id = COALESCE($2, case_id),
          bureau = COALESCE($3, bureau),
          inquiry = COALESCE($4, inquiry),
          inquiry_name = COALESCE($5, inquiry_name),
          call_state = COALESCE($6, call_state),
          status = COALESCE($7, status),
          is_open = $8,
          cleared_at = CASE WHEN $8 THEN cleared_at ELSE COALESCE(cleared_at, now()) END,
          updated_at = now()
        WHERE id = $1
        RETURNING *`,
      [existing.id, caseId, bureau, inquiryName, inquiryName, callState, status, !!isOpen]
    );
    if (caseId) await refreshOpenCount(db, caseId);
    return res.rows[0];
  }

  const res = await db.query(
    `INSERT INTO inquiry_log (
       org_id, client_id, case_id, external_inquiry_id,
       bureau, inquiry, inquiry_name, call_state, status, is_open,
       cleared_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $10 THEN NULL ELSE now() END)
     RETURNING *`,
    [orgId, clientId, caseId, externalInquiryId, bureau, inquiryName, inquiryName, callState, status, !!isOpen]
  );
  if (caseId) await refreshOpenCount(db, caseId);
  return res.rows[0];
}

/**
 * Update live call state on a case (and optionally one inquiry).
 */
export async function updateCallState(db, input = {}) {
  const caseId = input.caseId || input.case_id;
  const externalCaseId = input.externalCaseId || input.external_case_id;
  const callState = input.masterCallState || input.master_call_state || input.callState || input.call_state;
  if (!callState || !CALL_STATES.has(callState)) {
    throw new InquiryCaseError("valid call_state / master_call_state required", { status: 400 });
  }

  let row;
  if (caseId) {
    const r = await db.query(`SELECT * FROM inquiry_removal_cases WHERE id = $1`, [caseId]);
    row = r.rows[0];
  } else if (externalCaseId) {
    const r = await db.query(
      `SELECT * FROM inquiry_removal_cases WHERE external_case_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [externalCaseId]
    );
    row = r.rows[0];
  }
  if (!row) throw new InquiryCaseError("case not found", { status: 404 });

  const holdStartedAt = callState === "holding"
    ? (input.holdStartedAt || input.hold_started_at || row.hold_started_at || new Date().toISOString())
    : (input.holdStartedAt || input.hold_started_at || null);

  const liveAt = callState === "live_agent_reached"
    ? (input.liveAgentReachedAt || input.live_agent_reached_at || new Date().toISOString())
    : null;
  const handoffAt = callState === "transferred_to_rep"
    ? (input.repHandoffAt || input.rep_handoff_at || new Date().toISOString())
    : null;

  let caseStatus = input.caseStatus || input.case_status || null;
  if (!caseStatus) {
    if (callState === "transferred_to_rep" || callState === "live_agent_reached") {
      caseStatus = "Awaiting Remover";
    } else if (callState === "failed") {
      caseStatus = "Call Failed";
    } else if (callState === "dialing" || callState === "ivr" || callState === "holding" || callState === "queued") {
      caseStatus = "Calling";
    }
  }

  const res = await db.query(
    `UPDATE inquiry_removal_cases SET
        master_call_state = $2,
        case_status = COALESCE($3, case_status),
        hold_started_at = COALESCE($4::timestamptz, hold_started_at),
        live_agent_reached_at = COALESCE($5::timestamptz, live_agent_reached_at),
        rep_handoff_at = COALESCE($6::timestamptz, rep_handoff_at),
        last_dtmf_path = COALESCE($7, last_dtmf_path),
        call_outcome_summary = COALESCE($8, call_outcome_summary),
        attempt_count = COALESCE($9::int, attempt_count),
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [
      row.id, callState, caseStatus,
      holdStartedAt, liveAt, handoffAt,
      input.lastDtmfPath || input.last_dtmf_path || null,
      input.callOutcomeSummary || input.call_outcome_summary || null,
      input.attemptCount ?? input.attempt_count ?? null
    ]
  );

  const inquiryCallState = INQUIRY_CALL_STATES.has(callState) ? callState : null;
  if (inquiryCallState && (input.inquiryId || input.inquiry_id || input.externalInquiryId || input.external_inquiry_id)) {
    await upsertInquiry(db, {
      orgId: row.org_id,
      clientId: row.client_id,
      caseId: row.id,
      inquiryId: input.inquiryId || input.inquiry_id,
      externalInquiryId: input.externalInquiryId || input.external_inquiry_id,
      callState: inquiryCallState,
      bureau: input.bureau,
      inquiryName: input.inquiryName || input.inquiry_name || input.inquiry,
      status: "Open",
      isOpen: true
    });
  }

  return res.rows[0];
}

/**
 * Mark one inquiry Cleared. Returns { inquiry, caseRow, caseCleared }.
 * caseCleared is true when no open inquiries remain on the case.
 */
export async function clearInquiry(db, input = {}) {
  const inquiryId = input.inquiryId || input.inquiry_id;
  const externalInquiryId = input.externalInquiryId || input.external_inquiry_id;
  const staffId = input.staffId || input.staff_id || null;

  let inquiry;
  if (inquiryId) {
    const r = await db.query(`SELECT * FROM inquiry_log WHERE id = $1`, [inquiryId]);
    inquiry = r.rows[0];
  } else if (externalInquiryId) {
    const r = await db.query(
      `SELECT * FROM inquiry_log WHERE external_inquiry_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [externalInquiryId]
    );
    inquiry = r.rows[0];
  }
  if (!inquiry) throw new InquiryCaseError("inquiry not found", { status: 404 });

  const res = await db.query(
    `UPDATE inquiry_log SET
        status = 'Cleared',
        is_open = false,
        cleared_at = COALESCE(cleared_at, now()),
        confirmed_at = COALESCE(confirmed_at, now()),
        worked_by = COALESCE($2::uuid, worked_by),
        worked_at = CASE WHEN $2::uuid IS NOT NULL THEN now() ELSE worked_at END,
        call_state = NULL,
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [inquiry.id, staffId]
  );
  inquiry = res.rows[0];

  let caseRow = null;
  let caseCleared = false;
  if (inquiry.case_id) {
    caseRow = await refreshOpenCount(db, inquiry.case_id);
    if (caseRow && caseRow.open_inquiry_count === 0 && isActiveCaseStatus(caseRow.case_status)) {
      const cleared = await db.query(
        `UPDATE inquiry_removal_cases SET
            case_status = 'Cleared',
            cleared_at = COALESCE(cleared_at, now()),
            completed_at = COALESCE(completed_at, now()),
            master_call_state = 'completed',
            updated_at = now()
          WHERE id = $1
          RETURNING *`,
        [caseRow.id]
      );
      caseRow = cleared.rows[0];
      caseCleared = true;
    }
  } else {
    // Standalone inquiry_log row (pre-bridge): treat clear as case-level signal.
    caseCleared = true;
  }

  return { inquiry, caseRow, caseCleared };
}

/**
 * Close a case (staff or webhook). Optionally mark remaining open inquiries.
 */
export async function closeCase(db, input = {}) {
  const caseId = input.caseId || input.case_id;
  const externalCaseId = input.externalCaseId || input.external_case_id;
  const reason = input.reason || input.closed_reason || null;
  const asCleared = !!(input.asCleared ?? input.as_cleared ?? input.cleared);

  let row;
  if (caseId) {
    const r = await db.query(`SELECT * FROM inquiry_removal_cases WHERE id = $1`, [caseId]);
    row = r.rows[0];
  } else if (externalCaseId) {
    const r = await db.query(
      `SELECT * FROM inquiry_removal_cases WHERE external_case_id = $1 ORDER BY updated_at DESC LIMIT 1`,
      [externalCaseId]
    );
    row = r.rows[0];
  }
  if (!row) throw new InquiryCaseError("case not found", { status: 404 });

  if (asCleared) {
    await db.query(
      `UPDATE inquiry_log SET
          status = 'Cleared', is_open = false,
          cleared_at = COALESCE(cleared_at, now()),
          confirmed_at = COALESCE(confirmed_at, now()),
          updated_at = now()
        WHERE case_id = $1 AND is_open = true`,
      [row.id]
    );
  }

  const status = asCleared ? "Cleared" : (input.caseStatus || input.case_status || "Closed");
  const res = await db.query(
    `UPDATE inquiry_removal_cases SET
        case_status = $2,
        closed_at = COALESCE(closed_at, now()),
        closed_reason = COALESCE($3, closed_reason),
        cleared_at = CASE WHEN $4 THEN COALESCE(cleared_at, now()) ELSE cleared_at END,
        completed_at = COALESCE(completed_at, now()),
        master_call_state = CASE WHEN $4 THEN 'completed' ELSE master_call_state END,
        open_inquiry_count = CASE WHEN $4 THEN 0 ELSE open_inquiry_count END,
        updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [row.id, status, reason, asCleared]
  );
  return { caseRow: res.rows[0], caseCleared: asCleared || status === "Cleared" };
}

/** Format hold duration for display (e.g. "3m 12s") from hold_started_at. */
export function holdDurationDisplay(holdStartedAt, now = new Date()) {
  if (!holdStartedAt) return null;
  const start = new Date(holdStartedAt).getTime();
  if (Number.isNaN(start)) return null;
  const sec = Math.max(0, Math.floor((now.getTime() - start) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  }
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
