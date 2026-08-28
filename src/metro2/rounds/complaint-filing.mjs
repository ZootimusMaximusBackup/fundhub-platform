// ═══════════════════════════════════════════════════════════════════════════════
// THE RECORD OF A MAILED COMPLAINT
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// Owner 2026-08-28: "WE MAIL THEM." Fundhub mails the Round 4 CFPB complaint and
// the Round 5 state attorney general complaint on the client's behalf. So unlike
// the DIY package — where the client files by hand and nothing here ever hears
// about it — the filing IS knowable, and Round 6 is allowed to say it happened.
//
// THE RULE THIS FILE EXISTS TO ENFORCE:
//
//   A CLAIM MUST BE BACKED BY A ROW, NOT BY AN EXPECTATION.
//
// Round 6 may name a complaint only when this module returns a recorded mailing
// for it. No row, no sentence. Not "we generated it", not "we meant to send it",
// not "the pack contained it" — mailed, and recorded as mailed.
//
// NOTHING NEW WAS BUILT TO SEND OR TO STORE. Both already existed:
//
//   store         dispute_letters (db/migrations/160_metro2_dispute_engine.sql)
//                 already has `round` (text, no CHECK — R4/R5 already fit) and
//                 already flips to status 'sent' when the provider accepts it.
//                 ../rounds/store.mjs `saveLetter` already takes `target`.
//   send          ../delivery/send.mjs mailBureauLetter → the PostGrid provider,
//                 driven by the human send gate in ../../repair/send.mjs.
//   widened       db/migrations/270_dispute_letter_complaint_targets.sql lets
//                 `target` be 'cfpb' or 'state_ag'. A complaint is neither a
//                 bureau nor a furnisher, and recording one as 'bureau' would be
//                 a false row — worse than no row, because Round 6 reads them.
//
// This module adds the two pieces that genuinely did not exist: WHERE a
// complaint is mailed to, and HOW the record is read back.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE STATE ATTORNEY GENERAL CANNOT BE MAILED TODAY. THIS IS A FINDING.
//
// The CFPB has a published mailing address and it is already in this repository
// (`CFPB_FILING.mail`). The fifty state attorneys general do not. `AG_BY_STATE`
// in ../letters/ag-statutes.mjs carries an office NAME and a WEB PORTAL for five
// states — TX, CA, FL, NY, IL — and a generated placeholder for the rest. It has
// never carried a street address for any of them.
//
// Fifty addresses were NOT invented here. A wrong address means a complaint the
// client signed under penalty of perjury is mailed into a void while everyone
// believes it was filed. So `complaintDestination` refuses a state AG send with
// `ag_postal_address_unknown`, no filing row is written, and Round 6 stays
// silent about a state AG filing — exactly as it does today.
//
// Fill in `agPostalAddress` in ../letters/ag-statutes.mjs, per state, from each
// office's own published mailing address, and every other part of this path
// works unchanged.
// ═══════════════════════════════════════════════════════════════════════════════

import { CFPB_MAIL_ADDRESS, agPostalAddress, agForState } from "../letters/ag-statutes.mjs";
import { LETTER_TYPES } from "../letters/catalog.mjs";
import { saveLetter } from "./store.mjs";

/** Where a complaint goes. Neither is a bureau or a furnisher. */
export const COMPLAINT_TARGET = Object.freeze({
  CFPB: "cfpb",
  STATE_AG: "state_ag"
});

/** Round → complaint target. Mirrors ROUND_LADDER in ../letters/catalog.mjs. */
export const COMPLAINT_ROUND_TARGET = Object.freeze({
  R4: COMPLAINT_TARGET.CFPB,
  R5: COMPLAINT_TARGET.STATE_AG
});

/** Complaint target → the letter type it carries. */
export const COMPLAINT_TARGET_TYPE = Object.freeze({
  [COMPLAINT_TARGET.CFPB]: LETTER_TYPES.CFPB_COMPLAINT,
  [COMPLAINT_TARGET.STATE_AG]: LETTER_TYPES.STATE_AG_COMPLAINT
});

/** A mailing only counts once the provider took it. 'generated' is not filed. */
export const FILED_STATUSES = Object.freeze(["sent", "delivered"]);

const TARGET_SET = new Set(Object.values(COMPLAINT_TARGET));

export function isComplaintTarget(target) {
  return TARGET_SET.has(String(target || "").trim().toLowerCase());
}

/** The complaint target a round mails to, or null for a bureau round. */
export function complaintTargetForRound(round) {
  return COMPLAINT_ROUND_TARGET[String(round || "").trim().toUpperCase()] || null;
}

/**
 * Where this complaint is mailed.
 *
 * @returns {{ok: true, to: object, office: string}
 *         | {ok: false, reason: string, office: string|null}}
 */
export function complaintDestination(target, { state } = {}) {
  const t = String(target || "").trim().toLowerCase();
  if (t === COMPLAINT_TARGET.CFPB) {
    return { ok: true, to: { ...CFPB_MAIL_ADDRESS }, office: CFPB_MAIL_ADDRESS.company_name };
  }
  if (t === COMPLAINT_TARGET.STATE_AG) {
    const code = String(state || "").trim().toUpperCase();
    if (!code) return { ok: false, reason: "client_state_unknown", office: null };
    const ag = agForState(code);
    const postal = agPostalAddress(code);
    // Always null today. See the finding in this file's header.
    if (!postal || !postal.address_line1) {
      return { ok: false, reason: "ag_postal_address_unknown", office: ag.office || null };
    }
    return { ok: true, to: { company_name: ag.office, ...postal }, office: ag.office };
  }
  return { ok: false, reason: "not_a_complaint_target", office: null };
}

/**
 * Write the row that says this complaint was mailed.
 *
 * COMPLIANCE REVIEW REQUIRED — dispute logic.
 *
 * Call this ONLY after the mail provider accepted the letter. The row it writes
 * is what Round 6 later reads to decide whether it may say a complaint was
 * filed, so writing it early — at generation, or at "we intend to send" — would
 * put a false sentence in a letter to a credit bureau.
 *
 * It reuses ./store.mjs `saveLetter`; no second insert path and no new table.
 * `dispute_letters.case_id` is NOT NULL, so a caller with no case writes nothing
 * and says so rather than inventing one.
 *
 * @returns {Promise<{ok: true, letter: object} | {ok: false, reason: string}>}
 */
export async function recordComplaintFiling(db, {
  caseId, orgId, clientId, bureau, round, target, bodyText, providerId = null
} = {}) {
  if (!db || typeof db.query !== "function") return { ok: false, reason: "no_db" };
  const t = String(target || "").trim().toLowerCase();
  if (!isComplaintTarget(t)) return { ok: false, reason: "not_a_complaint_target" };
  const r = String(round || "").trim().toUpperCase();
  // The round and the target must agree, or the row is a corrupt record and
  // loadComplaintFilings will discard it anyway. Refuse to write it at all.
  if (complaintTargetForRound(r) !== t) return { ok: false, reason: "round_target_mismatch" };
  if (!caseId) return { ok: false, reason: "no_case" };
  if (!orgId || !clientId) return { ok: false, reason: "no_client" };
  if (!bodyText) return { ok: false, reason: "no_body_text" };
  try {
    const letter = await saveLetter(db, {
      caseId,
      orgId,
      clientId,
      bureau,
      round: r,
      bodyText,
      fingerprint: [],
      ruleIds: [],
      status: "sent",
      target: t
    });
    if (providerId && letter?.id) {
      await db.query(
        `UPDATE dispute_letters SET postgrid_letter_id = $2 WHERE id = $1::uuid`,
        [letter.id, String(providerId)]
      ).catch(() => {});
    }
    return { ok: true, letter };
  } catch (err) {
    return { ok: false, reason: String(err && err.message || err).slice(0, 240) };
  }
}

/**
 * Read the complaint mailings ALREADY ON RECORD for one client.
 *
 * Read-only. The three conditions are enforced in SQL, so a row that comes back
 * is by construction a complaint that a mail provider accepted:
 *
 *   target IN ('cfpb','state_ag')   it is a complaint, not a bureau letter
 *   status IN ('sent','delivered')  it was actually mailed, not just written
 *   round  IN ('R4','R5')           the rung of the ladder it was mailed from
 *
 * A failure is reported as `skip`, never thrown, and yields ZERO filings — so a
 * database hiccup makes Round 6 say less, never more. That direction is the
 * whole point: silence is safe, a false claim is not.
 *
 * @returns {Promise<{filings: object[], skip: string|null}>}
 */
export async function loadComplaintFilings(db, { clientId, orgId = null } = {}) {
  if (!db || typeof db.query !== "function") return { filings: [], skip: "no_db" };
  if (!clientId) return { filings: [], skip: "no_client" };
  try {
    const params = [clientId];
    let orgClause = "";
    if (orgId) {
      params.push(orgId);
      orgClause = ` AND dl.org_id = $${params.length}::uuid`;
    }
    const r = await db.query(
      `SELECT dl.target, dl.round, dl.status, dl.bureau, dl.postgrid_letter_id, dl.created_at
         FROM dispute_letters dl
        WHERE dl.client_id = $1
          AND dl.target = ANY($${params.length + 1})
          AND dl.status = ANY($${params.length + 2})${orgClause}
        ORDER BY dl.created_at ASC`,
      [...params, Object.values(COMPLAINT_TARGET), [...FILED_STATUSES]]
    );
    const rows = (r?.rows || []).filter(
      (row) => isComplaintTarget(row?.target) && complaintTargetForRound(row?.round) === String(row?.target || "").toLowerCase()
    );
    return { filings: rows, skip: null };
  } catch (err) {
    return { filings: [], skip: String(err && err.message || err).slice(0, 240) };
  }
}

/** True when a complaint of this target is on record as mailed. */
export function hasFiled(filings, target) {
  if (!Array.isArray(filings)) return false;
  const t = String(target || "").trim().toLowerCase();
  if (!isComplaintTarget(t)) return false;
  return filings.some(
    (f) => String(f?.target || "").trim().toLowerCase() === t
      && FILED_STATUSES.includes(String(f?.status || "").trim().toLowerCase())
  );
}

function filingDate(row) {
  const raw = row?.created_at ?? row?.createdAt ?? null;
  if (!raw) return null;
  const s = typeof raw === "string" ? raw : (raw instanceof Date ? raw.toISOString() : String(raw));
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * The sentences Round 6 is allowed to say about complaints already filed.
 *
 * ONE LINE PER RECORDED ROW, AND NOTHING ELSE. No row for a target means no
 * sentence about that target — not a hedge, not "a complaint may have been
 * filed", nothing at all. An empty array means Round 6 renders exactly as it did
 * before this path existed.
 *
 * A row with no usable date says the complaint was filed without naming a day,
 * because the date is what the record holds and nothing here may improve on it.
 */
export function formatComplaintFilings(filings = []) {
  const lines = [];
  const seen = new Set();
  for (const row of Array.isArray(filings) ? filings : []) {
    const target = String(row?.target || "").trim().toLowerCase();
    if (!isComplaintTarget(target)) continue;
    if (!FILED_STATUSES.includes(String(row?.status || "").trim().toLowerCase())) continue;
    if (seen.has(target)) continue;
    seen.add(target);
    const office = target === COMPLAINT_TARGET.CFPB
      ? "the Consumer Financial Protection Bureau"
      : "my state attorney general";
    const on = filingDate(row);
    lines.push(on
      ? `On ${on} a complaint about this file was mailed to ${office}.`
      : `A complaint about this file was mailed to ${office}.`);
  }
  return lines;
}
