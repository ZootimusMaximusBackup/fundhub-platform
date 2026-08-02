// src/contracts/signers.mjs — the people who have to sign, and the order.
//
// THE RULE THIS MODULE EXISTS FOR: under a sequential contract, signer 2's link
// does not work until signer 1 has signed. Not "the button is hidden" — the
// endpoint refuses, because a hidden button is a UI convention and this is a
// routing guarantee. Somebody who is forwarded the second signer's link, or who
// guesses at it, still cannot open the document out of turn.
//
// EVERY CONTRACT HAS SIGNER ROWS, including the single-signer text contracts
// that predate uploads. One code path is worth more than a special case: a
// contract sent before this existed and a five-party PDF differ only in how many
// rows are in this table. sign() with no signer named resolves to the only
// signer, which is what keeps the original flow working unchanged.

import { badRequest, notFound, conflict } from "./errors.mjs";

export const SIGNER_COLUMNS = `
  id, org_id, contract_id, signer_index, role_label, name, email, client_id,
  status, link_expires_at, viewed_at, view_count,
  signed_at, signer_name, signer_ip, signer_user_agent, field_values,
  declined_at, decline_reason, created_at, updated_at`;

const TERMINAL = new Set(["signed", "declined"]);

/** listSigners — in signing order, always. Nothing here sorts by anything else. */
export async function listSigners(db, contractId) {
  if (!contractId) return [];
  const { rows } = await db.query(
    `SELECT ${SIGNER_COLUMNS} FROM contract_signers
      WHERE contract_id = $1::uuid ORDER BY signer_index`, [contractId]);
  return rows;
}

export async function getSigner(db, signerId) {
  if (!signerId) return null;
  const { rows } = await db.query(
    `SELECT ${SIGNER_COLUMNS} FROM contract_signers WHERE id = $1::uuid LIMIT 1`, [signerId]);
  return rows[0] || null;
}

/**
 * normaliseSigners — what the sender typed, cleaned.
 *
 * Order is the position in the array, not a number anybody types. A hand-typed
 * order is a chance to write two 1s and no 2, and then the routing code has to
 * pick one arbitrarily — which is a coin toss deciding who signs a contract
 * first.
 */
export function normaliseSigners(raw) {
  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) throw badRequest("A contract needs at least one person to sign it.", "no_signers");
  if (list.length > 10) {
    throw badRequest("A contract can have at most 10 signers.", "too_many_signers");
  }
  return list.map((s, i) => {
    const name = String((s && s.name) ?? "").trim();
    if (!name) throw badRequest(`Signer ${i + 1} has no name.`, "signer_name_required");
    const email = String((s && s.email) ?? "").trim();
    /* Deliberately a shape check and nothing more. Nothing in this repository
       sends email, so a "real" address buys nothing today; what it buys is a
       typo caught before somebody is told to check an inbox they do not have.
       An empty address is allowed — a signer handed the link in person is a
       real case. */
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw badRequest(`"${email}" does not look like an email address.`, "signer_email_invalid");
    }
    return {
      signer_index: i,
      role_label: String((s && s.role_label) ?? "").trim() || (i === 0 ? "Client" : `Signer ${i + 1}`),
      name,
      email: email || null,
      client_id: (s && s.client_id) || null
    };
  });
}

/**
 * replaceSigners — set the signing party. DRAFT ONLY.
 *
 * Refused once sent, and the database refuses it too: contract_signers rows
 * cannot be deleted, so a "replace" after sending would leave the old people
 * on the record with no way to tell which set was real.
 */
export async function replaceSigners(db, { orgId, contractId, signers, status = "draft" } = {}) {
  if (status !== "draft") {
    throw conflict(
      "This contract has been sent, so who signs it cannot change. " +
      "Void it and start a new one.",
      "already_sent");
  }
  const wanted = normaliseSigners(signers);
  const existing = await listSigners(db, contractId);

  /* Deleting is blocked by trigger, so a draft's signer list is REWRITTEN in
     place: rows that still exist are updated, extra rows are marked declined
     with a reason rather than removed. On a draft that has never been sent this
     is invisible; it is what keeps the append-only rule true without making a
     draft's party list un-editable. */
  const out = [];
  for (const s of wanted) {
    const prior = existing.find((e) => e.signer_index === s.signer_index);
    if (prior) {
      const { rows } = await db.query(
        `UPDATE contract_signers
            SET role_label = $2, name = $3, email = $4, client_id = $5,
                status = 'pending', updated_at = now()
          WHERE id = $1::uuid RETURNING ${SIGNER_COLUMNS}`,
        [prior.id, s.role_label, s.name, s.email, s.client_id]);
      out.push(rows[0]);
    } else {
      const { rows } = await db.query(
        `INSERT INTO contract_signers
           (org_id, contract_id, signer_index, role_label, name, email, client_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${SIGNER_COLUMNS}`,
        [orgId, contractId, s.signer_index, s.role_label, s.name, s.email, s.client_id]);
      out.push(rows[0]);
    }
  }
  for (const e of existing) {
    if (e.signer_index >= wanted.length && e.status !== "declined") {
      await db.query(
        `UPDATE contract_signers
            SET status = 'declined', declined_at = now(),
                decline_reason = 'Removed from the contract before it was sent',
                updated_at = now()
          WHERE id = $1::uuid AND signed_at IS NULL`, [e.id]);
    }
  }
  return out;
}

/**
 * turnOf — whose turn is it, as an index into the ordered list.
 *
 * Returns null when nobody is waiting (everybody has finished). Under a
 * parallel contract everybody's turn is now, so this is only meaningful for
 * sequential ones — which is why canSign() below takes the order and this does
 * not have to.
 */
export function turnOf(signers) {
  const pending = (signers || []).filter((s) => !TERMINAL.has(s.status));
  if (!pending.length) return null;
  return Math.min(...pending.map((s) => s.signer_index));
}

/**
 * canSign — may THIS person sign RIGHT NOW?
 *
 * Returns { ok, reason, waitingOn }. Never throws; the caller decides the
 * status code. `waitingOn` is a NAME, so the page can say "waiting for Dana to
 * sign first" rather than "not your turn", which tells somebody nothing about
 * what to do next.
 */
export function canSign(signer, signers, signingOrder = "sequential") {
  if (!signer) return { ok: false, reason: "unknown_signer" };
  if (signer.status === "signed") return { ok: false, reason: "already_signed" };
  if (signer.status === "declined") return { ok: false, reason: "declined" };
  if (signingOrder !== "sequential") return { ok: true, reason: null };

  const ahead = (signers || [])
    .filter((s) => s.signer_index < signer.signer_index)
    .filter((s) => s.status !== "signed");
  if (ahead.length) {
    const next = ahead.sort((a, b) => a.signer_index - b.signer_index)[0];
    return { ok: false, reason: "not_your_turn", waitingOn: next.name, waitingOnRole: next.role_label };
  }
  return { ok: true, reason: null };
}

/** Everybody has signed. What makes a contract complete rather than in flight. */
export const allSigned = (signers) =>
  Array.isArray(signers) && signers.length > 0 && signers.every((s) => s.status === "signed");

/**
 * resolveSigner — which signer a request is about.
 *
 * With no signer named, a single-signer contract resolves to its only signer.
 * That is what keeps every contract sent before this feature existed — and
 * every simple one-party contract sent after it — working through the same code
 * path, with no legacy branch anywhere.
 *
 * A multi-signer contract with no signer named is refused rather than guessed:
 * picking the first one would let a link intended for the countersigner sign as
 * the client.
 */
export async function resolveSigner(db, { contractId, signerId = null } = {}) {
  const signers = await listSigners(db, contractId);
  if (!signers.length) return { signer: null, signers, reason: "no_signers" };

  if (signerId) {
    const hit = signers.find((s) => String(s.id) === String(signerId));
    return { signer: hit || null, signers, reason: hit ? null : "unknown_signer" };
  }
  if (signers.length === 1) return { signer: signers[0], signers, reason: null };
  return { signer: null, signers, reason: "signer_required" };
}

/** recordView — that person opened it. First time stamps, every time counts. */
export async function markSignerViewed(db, signerId, at = new Date()) {
  const { rows } = await db.query(
    `UPDATE contract_signers
        SET view_count = view_count + 1,
            viewed_at  = COALESCE(viewed_at, $2),
            status     = CASE WHEN status IN ('pending','sent') THEN 'viewed' ELSE status END,
            updated_at = now()
      WHERE id = $1::uuid AND signed_at IS NULL
      RETURNING ${SIGNER_COLUMNS}`, [signerId, at]);
  // No row means they have already signed: their record is frozen by trigger and
  // a view after signing is not worth failing a page render over.
  return rows[0] || (await getSigner(db, signerId));
}

/** decline — a signer says no. Terminal for them, and it stops the contract. */
export async function declineSigner(db, { signerId, reason, at = new Date() } = {}) {
  const why = String(reason ?? "").trim();
  if (!why) throw badRequest("Please say why you are not signing.", "decline_reason_required");
  const { rows } = await db.query(
    `UPDATE contract_signers
        SET status = 'declined', declined_at = $2, decline_reason = $3, updated_at = now()
      WHERE id = $1::uuid AND signed_at IS NULL
      RETURNING ${SIGNER_COLUMNS}`, [signerId, at, why.slice(0, 500)]);
  if (!rows[0]) throw conflict("This has already been signed and cannot be declined.", "already_signed");
  return rows[0];
}

/** What the CRM prints: "waiting on Dana (Client)". */
export function waitingSummary(signers, signingOrder = "sequential") {
  const waiting = (signers || []).filter((s) => !TERMINAL.has(s.status));
  if (!waiting.length) return null;
  if (signingOrder === "sequential") {
    const next = waiting.sort((a, b) => a.signer_index - b.signer_index)[0];
    return { name: next.name, role: next.role_label, remaining: waiting.length };
  }
  return { name: waiting.map((s) => s.name).join(", "), role: null, remaining: waiting.length };
}

/** What a signer may be told about the others. Names and states, never contacts. */
export const publicSignerList = (signers) =>
  (signers || []).map((s) => ({
    role_label: s.role_label,
    name: s.name,
    status: s.status,
    signed_at: s.signed_at
  }));

export { TERMINAL as TERMINAL_SIGNER_STATUSES };
