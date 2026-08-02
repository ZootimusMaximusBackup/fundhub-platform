// Staff↔staff internal messaging for the chat widget.
//
// Reuses messages + conversations. Does NOT go through the compliance gate
// (spec §4.3 — internal pings are not client outbound). Visually distinct via
// conversations.kind = 'internal'.

function pairKey(a, b) {
  const x = String(a);
  const y = String(b);
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

/**
 * getOrCreateInternalThread(db, { orgId, staffId, peerStaffId })
 */
export async function getOrCreateInternalThread(db, { orgId, staffId, peerStaffId }) {
  if (!orgId || !staffId || !peerStaffId) {
    throw new TypeError("getOrCreateInternalThread: orgId, staffId, peerStaffId required");
  }
  if (staffId === peerStaffId) {
    const e = new Error("cannot message yourself");
    e.code = "SELF";
    throw e;
  }

  const key = pairKey(staffId, peerStaffId);
  const existing = await db.query(
    `SELECT * FROM conversations
      WHERE org_id = $1 AND kind = 'internal' AND internal_pair_key = $2`,
    [orgId, key]
  );
  if (existing.rows[0]) return existing.rows[0];

  const peer = await db.query(
    `SELECT id FROM staff WHERE id = $1 AND org_id = $2 AND status = 'active'`,
    [peerStaffId, orgId]
  );
  if (!peer.rows[0]) {
    const e = new Error("peer staff not found in this org");
    e.code = "NOT_FOUND";
    throw e;
  }

  const ins = await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, kind, internal_pair_key, last_pulse_at)
     VALUES ($1, NULL, 'internal', 'internal', $2, now())
     RETURNING *`,
    [orgId, key]
  );
  const convo = ins.rows[0];
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, staff_id)
     VALUES ($1, $2), ($1, $3)
     ON CONFLICT DO NOTHING`,
    [convo.id, staffId, peerStaffId]
  );
  return convo;
}

/**
 * sendInternalMessage(db, { orgId, staffId, conversationId, body })
 * Inserts an outbound messages row with sender_kind='staff'. No dispatch.
 */
export async function sendInternalMessage(db, {
  orgId, staffId, conversationId, body, idempotencyKey = null
} = {}) {
  const text = String(body || "").trim();
  if (!text) {
    const e = new Error("body required");
    e.code = "BODY";
    throw e;
  }
  if (text.length > 8000) {
    const e = new Error("body too long");
    e.code = "BODY";
    throw e;
  }

  const part = await db.query(
    `SELECT 1 FROM conversation_participants
      WHERE conversation_id = $1 AND staff_id = $2`,
    [conversationId, staffId]
  );
  if (!part.rows[0]) {
    const e = new Error("not a participant");
    e.code = "FORBIDDEN";
    throw e;
  }

  const convo = await db.query(
    `SELECT id, org_id, kind FROM conversations WHERE id = $1 AND org_id = $2`,
    [conversationId, orgId]
  );
  if (!convo.rows[0] || convo.rows[0].kind !== "internal") {
    const e = new Error("internal conversation not found");
    e.code = "NOT_FOUND";
    throw e;
  }

  const providerRef = idempotencyKey ? `internal:${idempotencyKey}` : null;
  if (providerRef) {
    const prior = await db.query(
      `SELECT * FROM messages WHERE org_id = $1 AND provider_ref = $2`,
      [orgId, providerRef]
    );
    if (prior.rows[0]) {
      return { message: prior.rows[0], deduped: true };
    }
  }

  const ins = await db.query(
    `INSERT INTO messages (
       org_id, client_id, conversation_id, direction, channel,
       rendered_body, status, compliance_check_passed,
       sender_staff_id, sender_kind, provider_ref
     ) VALUES (
       $1, NULL, $2, 'outbound', 'internal',
       $3, 'delivered', true,
       $4, 'staff', $5
     ) RETURNING *`,
    [orgId, conversationId, text, staffId, providerRef]
  );

  await db.query(
    `UPDATE conversations SET last_pulse_at = now(), updated_at = now() WHERE id = $1`,
    [conversationId]
  );

  return { message: ins.rows[0], deduped: false };
}

/**
 * listInternalThreads(db, { orgId, staffId, limit })
 */
export async function listInternalThreads(db, { orgId, staffId, limit = 30 } = {}) {
  const res = await db.query(
    `SELECT c.id, c.kind, c.channel, c.last_pulse_at, c.created_at,
            (SELECT jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'email', s.email, 'role', s.role
             ) ORDER BY s.name)
               FROM conversation_participants cp
               JOIN staff s ON s.id = cp.staff_id
              WHERE cp.conversation_id = c.id) AS participants,
            (SELECT m.rendered_body FROM messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC LIMIT 1) AS last_body
       FROM conversations c
       JOIN conversation_participants me
         ON me.conversation_id = c.id AND me.staff_id = $2
      WHERE c.org_id = $1 AND c.kind = 'internal'
      ORDER BY COALESCE(c.last_pulse_at, c.created_at) DESC
      LIMIT $3`,
    [orgId, staffId, Math.min(100, Math.max(1, Number(limit) || 30))]
  );
  return res.rows;
}

/**
 * listThreadMessages(db, { orgId, conversationId, limit })
 */
export async function listThreadMessages(db, { orgId, conversationId, limit = 100 } = {}) {
  const res = await db.query(
    `SELECT m.id, m.direction, m.channel, m.rendered_body, m.status,
            m.sender_staff_id, m.sender_kind, m.created_at,
            s.name AS sender_name
       FROM messages m
       LEFT JOIN staff s ON s.id = m.sender_staff_id
      WHERE m.org_id = $1 AND m.conversation_id = $2
      ORDER BY m.created_at ASC
      LIMIT $3`,
    [orgId, conversationId, Math.min(500, Math.max(1, Number(limit) || 100))]
  );
  return res.rows;
}

export { pairKey as _pairKeyForTests };
