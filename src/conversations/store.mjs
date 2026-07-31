// Conversations — the thread layer over `messages`.
//
// `conversations` has existed since 001_init.sql and had no writer. Every
// inbound SMS and every completed call wrote a `messages` row with
// conversation_id NULL, so `idx_messages_convo` indexed a column nobody filled
// and fk_messages_convo pointed at a table with no rows. This module is the
// writer, and src/handlers/comms.mjs is its only caller today.
//
// ONE ROW PER (client_id, channel). The upsert's conflict target is
// uq_conversations_client_channel from migration 057. A thread is a durable
// place, not a per-message record: the hundredth inbound SMS updates the same
// sms row rather than adding a hundredth.
//
// *** SENTIMENT IS NEVER WRITTEN HERE. ***
// The column is declared `-- Hot | Warm | Cold` and nothing in this codebase
// computes that. There is no classifier, no scored pass, and no inbound payload
// field carrying it. src/config/lead-temperature.mjs answers a DIFFERENT
// question — it reads which events fired, not what was said — so borrowing its
// hot/warm output would put a booking-derived label on a thread the client never
// replied to. The column stays NULL and is not named in any statement below.
// A guessed sentiment is read aloud on a sales call. A blank one gets checked.
//
// SUMMARY IS ONLY WRITTEN IF A CALLER GENUINELY HAS ONE. Same rule, softer
// stakes: none of the current event payloads carries a summary field, so the
// handler passes nothing and the column stays NULL. When something does produce
// one, COALESCE below means a later summary-less write cannot erase it.
//
// NOTHING IN HERE COMPUTES OR STORES A DERIVED COUNT. No message_count, no
// unread flag. Both are functions of `messages` and would go stale the moment a
// row lands; the reader can count when it needs to.

/** Trim-only normalization. Deliberately NO case folding: `channel` must be
 *  byte-identical to the `messages.channel` value it was derived from, because
 *  the unique index treats 'SMS' and 'sms' as two threads and the message row is
 *  stored verbatim. Normalizing case here would split a client's thread in two
 *  the first time a caller shouted. */
function requireText(value, field) {
  const s = typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
  if (!s) throw new TypeError(`${field} is required`);
  return s;
}

function requireId(value, field) {
  if (!value) throw new TypeError(`${field} is required`);
  return value;
}

/**
 * upsertConversation(db, { orgId, clientId, channel, summary, lastPulseAt })
 *
 * Insert the thread, or refresh the existing one. Returns the stored row.
 *
 * lastPulseAt is GREATEST-ed rather than assigned. Two reasons, both real:
 * webhooks arrive out of order (a retried Twilio delivery from 09:00 can land
 * after the 09:05 one), and replay() re-drives the whole event log in
 * created_at order against rows that already hold a newer pulse. Assigning
 * would walk the thread's clock backwards in both cases. Postgres GREATEST
 * ignores NULL arguments, so an unknown pulse never overwrites a known one and
 * the column only stays NULL while both sides are unknown — which is the
 * schema-wide rule that NULL means unknown and must survive.
 */
export async function upsertConversation(db, { orgId, clientId, channel, summary = null, lastPulseAt = null } = {}) {
  requireId(orgId, "upsertConversation: orgId");
  requireId(clientId, "upsertConversation: clientId");
  const ch = requireText(channel, "upsertConversation: channel");

  const res = await db.query(
    `INSERT INTO conversations (org_id, client_id, channel, summary, last_pulse_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (client_id, channel) DO UPDATE SET
       -- Absence is not a correction: a pulse with no summary must not erase
       -- a summary someone wrote.
       summary       = COALESCE(EXCLUDED.summary, conversations.summary),
       last_pulse_at = GREATEST(EXCLUDED.last_pulse_at, conversations.last_pulse_at),
       -- 001_init.sql already carries an updated_at trigger on this table; set
       -- explicitly so the row is correct even if that trigger is ever dropped.
       updated_at    = now()
     RETURNING *`,
    [orgId, clientId, ch, summary ?? null, lastPulseAt ?? null]
  );
  return res.rows[0];
}

/**
 * listConversations(db, { clientId }) — every thread for one client, most
 * recently active first. NULLS LAST because a thread that has never pulsed is
 * not a thread that pulsed at the beginning of time; `channel ASC` breaks the
 * tie so the order is stable across calls instead of whatever the heap returns.
 */
export async function listConversations(db, { clientId } = {}) {
  requireId(clientId, "listConversations: clientId");
  const res = await db.query(
    `SELECT * FROM conversations
      WHERE client_id = $1
      ORDER BY last_pulse_at DESC NULLS LAST, channel ASC`,
    [clientId]
  );
  return res.rows;
}

/**
 * linkMessage(db, { messageId, conversationId }) — fill in the dangling
 * messages.conversation_id.
 *
 * The UPDATE joins `conversations` and requires org AND client to match rather
 * than trusting the two ids it was handed. A mis-linked message is not a cosmetic
 * bug: the thread view is what an advisor reads back on a call, and one client's
 * SMS appearing in another's history is a disclosure. Note that
 * conversations.client_id is NOT NULL, so a message with no client resolved
 * (an inbound SMS from an unknown number) can never satisfy the join and is
 * left unlinked — correctly, because it belongs to no client's thread yet.
 *
 * Returns { linked: boolean }. false is a normal outcome, not an error.
 */
export async function linkMessage(db, { messageId, conversationId } = {}) {
  requireId(messageId, "linkMessage: messageId");
  requireId(conversationId, "linkMessage: conversationId");

  const res = await db.query(
    `UPDATE messages m
        SET conversation_id = c.id,
            updated_at = now()
       FROM conversations c
      WHERE m.id = $1
        AND c.id = $2
        AND c.org_id = m.org_id
        AND c.client_id = m.client_id
      RETURNING m.id`,
    [messageId, conversationId]
  );
  return { linked: res.rows.length > 0 };
}
