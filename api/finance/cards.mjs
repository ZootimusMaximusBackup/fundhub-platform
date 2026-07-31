// /api/finance/cards — the payment instrument on file for a client, and which
// one the live subscription charges.
//
//   GET  ?client_id=<uuid>[&include_removed=1]      → { ok, cards }
//   POST { action: "attach", client_id, card_id }   → point the live subscription at a card
//   POST { action: "remove", client_id, card_id }   → retire an instrument
//
// *** SCAFFOLD STUB — TRACK 1 OWNS THIS FILE. ***
// Auth, role gate, org scoping, method switch and error mapping are the
// contract and are finished. Track 1 replaces the `not_implemented` bodies.
//
// THIS IS NOT A CARD-CAPTURE ENDPOINT AND MUST NOT BECOME ONE. There is no
// "add a card" action here on purpose. src/subscriptions/index.mjs's
// normalizeCardMeta() THROWS on a PAN and on a CVV, and putClientCard() stores a
// provider TOKEN plus brand/last4/expiry and nothing else. Nothing in this
// repository transmits (there is no outbound fetch in src/adapters/ or
// src/lib/), so there is no processor to tokenise a card number against — an
// endpoint that accepted one would be storing raw card data with nowhere to send
// it, which is the worst possible combination. If a token ever arrives from a
// processor, `putClientCard` is the writer and a new action gets added HERE with
// a compliance review attached, not a PAN field bolted onto this one.
//
// REMOVE NEVER DELETES. removeClientCard() stamps removed_at and 076's foreign
// key is ON DELETE RESTRICT, because a card that paid for something has to stay
// resolvable from the subscription that used it. Re-removing keeps the FIRST
// date — that date is the answer to "when did they take it off file", which is a
// question a chargeback turns on.
//
// ORG AND CLIENT COME FROM THE SESSION AND THE CLIENTS TABLE, never from the
// body. See the long note in api/finance/subscriptions.mjs; the reasoning is
// identical and a card is if anything more sensitive than a tier.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";

/* ROLE_SETS.FINANCE — {owner, admin}. A payment instrument is the narrowest
   thing this API serves. It shares subscriptions.html, whose row in
   public/app/shell.js OWNER_ADMIN_ONLY mirrors this gate. */
const CARD_ROLES = ROLE_SETS.FINANCE;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key. See the note
  // in api/finance/subscriptions.mjs.
  if (!requireRole(res, staff, CARD_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      // TODO(track 1): listClientCards(db, { orgId, clientId, includeRemoved }).
      // Removed cards are readable on purpose — a subscription that charged one
      // must stay explainable — so `include_removed=1` is a real parameter, not
      // a debugging flag.
      return res.status(501).json({ ok: false, error: "not_implemented" });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }
      if (!isUuid(body.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!isUuid(body.card_id)) {
        return res.status(400).json({ ok: false, error: "card_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, body.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }

      switch (body.action) {
        case "attach":
          // TODO(track 1): attachCard(db, { orgId, clientId, cardId }). It THROWS
          // a plain Error when there is no live subscription or the card belongs
          // to someone else — map that to 409/400 rather than letting it 500.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        case "remove":
          // TODO(track 1): removeClientCard(db, { orgId, id: cardId, at }).
          // Returns null when the card is not in this org — that is a 404, not
          // a success with an empty body.
          return res.status(501).json({ ok: false, error: "not_implemented" });
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    throw e;
  }
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}
