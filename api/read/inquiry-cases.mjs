// GET /api/read/inquiry-cases — Inquiry Remover case queue.
//
// Active cases with live call state, hold duration, linked inquiry summary.
// ROLE_SETS.STAFF (same gate as /api/read/inquiries). Org from session.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { holdDurationDisplay } from "../../src/inquiry-removal/cases.mjs";

const orgOf = (staff) => (staff && staff.org_id) || null;

const ACTIVE = `('Open','Scheduled','Calling','Awaiting Remover','Call Failed')`;

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: async (db, { limit, offset, query, staff }) => {
    const orgId = orgOf(staff);
    const activeOnly = String(query.active || "1") !== "0";
    const statusFilter = query.status || null;
    const clientId = query.client_id || null;

    const res = await db.query(
      `SELECT c.id, c.org_id, c.client_id, c.external_case_id,
              c.case_status, c.requested_by, c.requested_at,
              c.selected_bureaus_raw, c.open_inquiry_count,
              c.master_call_state, c.hold_started_at,
              c.live_agent_reached_at, c.rep_handoff_at,
              c.attempt_count, c.call_outcome_summary,
              c.cleared_at, c.completed_at, c.closed_at,
              c.created_at, c.updated_at,
              TRIM(COALESCE(cl.first_name,'') || ' ' || COALESCE(cl.last_name,'')) AS client_name,
              cl.email AS client_email,
              COALESCE(cl.custom_fields->>'personal_state', cl.custom_fields->>'Personal State') AS personal_state
         FROM inquiry_removal_cases c
         LEFT JOIN clients cl ON cl.id = c.client_id
        WHERE c.org_id = $5::uuid
          AND ($3::uuid IS NULL OR c.client_id = $3)
          AND ($4::text IS NULL OR c.case_status = $4)
          AND ($6::boolean = false OR c.case_status IN ${ACTIVE})
        ORDER BY
          CASE c.master_call_state
            WHEN 'holding' THEN 0
            WHEN 'live_agent_reached' THEN 1
            WHEN 'transferred_to_rep' THEN 2
            WHEN 'ivr' THEN 3
            WHEN 'dialing' THEN 4
            ELSE 5
          END,
          c.requested_at DESC NULLS LAST,
          c.updated_at DESC
        LIMIT $1 OFFSET $2`,
      [limit + 1, offset, clientId, statusFilter, orgId, activeOnly]
    );

    const rows = res.rows;
    const ids = rows.map((r) => r.id);
    let inquiriesByCase = new Map();
    if (ids.length) {
      const iq = await db.query(
        `SELECT id, case_id, bureau, inquiry, inquiry_name, status,
                call_state, is_open, call_attempts, cleared_at, confirmed_at,
                created_at, updated_at
           FROM inquiry_log
          WHERE case_id = ANY($1::uuid[])
          ORDER BY is_open DESC, updated_at DESC`,
        [ids]
      );
      for (const row of iq.rows) {
        const list = inquiriesByCase.get(row.case_id) || [];
        list.push(row);
        inquiriesByCase.set(row.case_id, list);
      }
    }

    const now = new Date();
    return rows.map((r) => ({
      ...r,
      hold_duration_display:
        r.master_call_state === "holding" ? holdDurationDisplay(r.hold_started_at, now) : null,
      inquiries: inquiriesByCase.get(r.id) || []
    }));
  }
});

export default (req, res) => run(req, res, { db, requireAuth });
