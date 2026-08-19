// Repair analysis → stored dispute case, items and letters. NO TRANSMISSION.
//
// ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────
// src/metro2/rounds/store.mjs holds the only three INSERTs into dispute_cases,
// dispute_items and dispute_letters, and until now NOTHING IN THE REPO CALLED
// THEM. src/repair/cases.mjs decides `can_send` by counting dispute_letters
// rows with status IN ('generated','ready'), so with no writer the Repair desk
// was permanently empty and no dispute letter had ever been produced. This
// module is the missing caller and nothing else: it reads the client's stored
// credit file, runs the existing Metro 2 engine over it, and writes what the
// engine found.
//
// It MAILS NOTHING. Handing a stored letter to a provider is src/repair/send.mjs's
// job and already exists. Per CLAUDE.md §12 outbound `fetch` lives only under
// src/messaging/providers/*; there is none here and none may be added.
//
// ── THINGS THIS MODULE REFUSES TO DO ──────────────────────────────────────
// * No credit file on record → { ok:false, reason:'no_credit_file' }. It never
//   invents a file, and it never falls back to another client's pull.
// * Engine finds nothing → { ok:false, reason:'no_violations' }. A clean report
//   is a real and common outcome. It is NOT dressed up as a success, and it
//   deliberately does NOT move the pipeline card. `repair.analysis.empty` maps
//   to the `stalled` stage, and moveCardToStage CREATES a card when none exists
//   — so emitting it would park a client on the Repair desk labelled "Stuck"
//   for the offence of having an accurate credit report. Nobody asked for that
//   surface, so the refusal is returned to the caller instead.
// * No consumer name on the client row → { ok:false, reason:'missing_identity' }.
//   buildLetterText happily substitutes the placeholder "[Consumer Name]"; a
//   stored letter a human will mail must not carry one. The postal address is
//   included when pii_identity has one and simply omitted when it does not —
//   omitted, never guessed. `identity_complete` in the result says which
//   happened so the gap is visible rather than silent.
// * generateLetter refuses (it THROWS "no_rule_id_claims" on zero rule-backed
//   violations, and RETURNS { ok:false, reason:'variance_gate_exhausted' } when
//   a new letter reads too much like a prior one). Both refusals are recorded
//   against that bureau and the other bureaus continue. Neither is worked around.
// * No date is stamped on the letter. Generation day is not mail day — a human
//   decides that later on the Repair desk — and a false date on a legal dispute
//   letter is a real defect.
//
// ── IDEMPOTENCY (documented behaviour, not an accident) ───────────────────
// Keyed on (org, client, bureau, round) over dispute_cases rows that are not
// closed or cancelled:
//   * case exists AND already has a letter → that bureau is skipped with
//     reason 'already_generated'. Nothing is written and no event fires.
//   * case exists with NO letter (a previous run where the letter was refused)
//     → the existing case is REUSED, its items are not re-inserted, and the
//     letter is attempted again. Retrying a refusal must not be blocked forever
//     by the empty case the refusal left behind.
//   * no case → created.
// So calling this twice for the same client and round cannot double up cases,
// items or letters. A second round is a different `round` value and gets its own
// case, which is the intended shape of dispute_cases.
//
// ── EVENTS ────────────────────────────────────────────────────────────────
// onRepairEvent is called DIRECTLY, not through the event bus. This is copied
// from src/repair/send.mjs and it is load-bearing: registerRepairHandlers() is
// not wired into src/register-all.mjs, so an event put on the bus during an HTTP
// request reaches no listener at all. Fixing that registration is not this
// module's business.
//   repair.analysis.complete → stage 'letters_generated', fired once findings
//     are actually recorded (at least one case written this run).
//   repair.letters.ready     → stage 'ready_to_send', fired ONLY when at least
//     one letter row was really stored. That move is what puts the client on the
//     Repair desk, whose SQL inner-joins `cards` on the optimization pipeline.

import { createHash } from "node:crypto";

import { violationsByBureauFromMergedCrs } from "../metro2/diy/from-crs.mjs";
import { generateLetter } from "../metro2/letters/generate.mjs";
import { createCase, insertItems, saveLetter } from "../metro2/rounds/store.mjs";
import { loadClientReturnAddress } from "../inquiry-ops/call-scheduler.mjs";
import { onRepairEvent } from "./handlers.mjs";

const BUREAU_CODES = Object.freeze(["TU", "EX", "EQ"]);

/** dispute_cases.round CHECK constraint. A round outside this is a 400, not a crash. */
export const ROUNDS = Object.freeze(["R1", "R2", "R3", "FURNISHER"]);

/** How many prior letters to the same bureau the variance gate compares against. */
const PRIOR_WINDOW = 5;

/**
 * dispute_letters.fingerprint is text[], and generateLetter's `fingerprint` is
 * the RAW SHINGLE SET from src/metro2/letters/variance.mjs — every distinct
 * 5-character slice of the letter, so a 2,000-character letter arrives as ~300
 * entries and a long one as thousands. Writing that raw puts a copy of the
 * letter, chopped up, into the row beside the letter itself: megabytes of index
 * churn for no reader.
 *
 * And there IS no reader. Nothing in src/, api/, db/ or netlify/ ever SELECTs
 * dispute_letters.fingerprint; the variance gate re-derives shingles from
 * body_text at compare time. So the column's only real job is "did we store this
 * exact structure before", which one stable digest answers.
 *
 * Sorted before hashing because a Set's iteration order is insertion order, and
 * the same letter must always produce the same digest.
 */
export function fingerprintDigest(fingerprint) {
  const list = Array.isArray(fingerprint) ? fingerprint : [...(fingerprint || [])];
  if (!list.length) return [];
  const hex = createHash("sha256").update(list.slice().sort().join("\n")).digest("hex");
  return [`sha256:${hex}`];
}

/**
 * A violation only becomes a dispute_items row if it carries BOTH a rule id and
 * a severity. rule_id and severity are NOT NULL in the table, and defaulting an
 * absent severity would be inventing how serious a finding is. The same filtered
 * list is what the letter is built from, so the stored items and the printed
 * claims are always the same set.
 */
export function ruleBackedClaims(violations) {
  return (violations || []).filter((v) => v && v.ruleId && v.severity);
}

function refusalReason(err) {
  const msg = String(err?.message || err || "").trim();
  if (/no_rule_id_claims/.test(msg)) return "no_rule_id_claims";
  return `letter_error:${msg.slice(0, 160)}`;
}

/* The newest stored pull for this client. Statement copied from
   src/metro2/diy/deliver.mjs and src/underwrite/letter-pack.mjs rather than
   imported: deliver.mjs builds the DIY pack and letter-pack.mjs builds the
   underwriting pack, and neither should start running because the Repair desk
   asked a question. org_id is checked here because this is a tenant boundary. */
async function newestCreditFile(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT result FROM crs_results
      WHERE client_id = $1::uuid AND org_id = $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [clientId, orgId]
  );
  return r.rows[0]?.result || null;
}

/* Name from the client row, postal address from pii_identity via the same
   loader api/repair/send.mjs already uses for the return address. Nothing here
   substitutes a placeholder for a missing value. */
async function loadIdentity(db, { orgId, clientId }) {
  const c = await db.query(
    `SELECT first_name, last_name FROM clients
      WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
    [clientId, orgId]
  );
  const row = c.rows[0];
  if (!row) return null;
  const fullName = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  if (!fullName) return { fullName: null, complete: false };

  let addr = null;
  try {
    addr = await loadClientReturnAddress(db, { orgId, clientId });
  } catch {
    addr = null;
  }
  return {
    fullName,
    addressLine1: addr?.address_line1 || null,
    addressLine2: addr?.address_line2 || null,
    city: addr?.address_city || null,
    state: addr?.address_state || null,
    zip: addr?.address_zip || null,
    complete: Boolean(addr?.address_line1)
  };
}

async function openCasesByBureau(db, { orgId, clientId, round }) {
  const r = await db.query(
    `SELECT dc.id, dc.org_id, dc.client_id, dc.bureau, dc.round,
            (SELECT COUNT(*)::int FROM dispute_letters dl WHERE dl.case_id = dc.id) AS letter_count,
            (SELECT COUNT(*)::int FROM dispute_items di WHERE di.case_id = dc.id) AS item_count
       FROM dispute_cases dc
      WHERE dc.org_id = $1::uuid AND dc.client_id = $2::uuid AND dc.round = $3
        AND dc.status NOT IN ('closed', 'cancelled')`,
    [orgId, clientId, round]
  );
  const map = new Map();
  for (const row of r.rows) map.set(row.bureau, row);
  return map;
}

async function priorLetterBodies(db, { orgId, clientId, bureau }) {
  const r = await db.query(
    `SELECT body_text FROM dispute_letters
      WHERE org_id = $1::uuid AND client_id = $2::uuid AND bureau = $3
      ORDER BY created_at DESC LIMIT ${PRIOR_WINDOW}`,
    [orgId, clientId, bureau]
  );
  return r.rows.map((row) => row.body_text).filter(Boolean);
}

/**
 * Analyse a client's stored credit file and store the dispute letters it
 * supports. Writes only; never transmits.
 *
 * @param {object} db
 * @param {{ orgId: string, clientId: string, round?: string, staffId?: string|null }} opts
 * @returns {Promise<object>} refusal `{ ok:false, reason }` or a per-bureau summary
 */
export async function analyzeAndGenerate(db, { orgId, clientId, round = "R1", staffId = null } = {}) {
  if (!db?.query) return { ok: false, reason: "db_required" };
  if (!orgId || !clientId) return { ok: false, reason: "missing_ids" };
  if (!ROUNDS.includes(round)) return { ok: false, reason: "invalid_round", round };

  const result = await newestCreditFile(db, { orgId, clientId });
  if (!result) return { ok: false, reason: "no_credit_file" };

  const byBureau = violationsByBureauFromMergedCrs(result);
  const bureaus = BUREAU_CODES.filter((code) => (byBureau[code] || []).length > 0);
  if (bureaus.length === 0) return { ok: false, reason: "no_violations" };

  const identity = await loadIdentity(db, { orgId, clientId });
  if (!identity) return { ok: false, reason: "client_not_found" };
  if (!identity.fullName) return { ok: false, reason: "missing_identity" };

  const existing = await openCasesByBureau(db, { orgId, clientId, round });

  const stored = [];
  const skipped = [];
  const caseIds = [];
  let casesWritten = 0;

  for (const bureau of bureaus) {
    const claims = ruleBackedClaims(byBureau[bureau]);
    if (claims.length === 0) {
      // The engine found something but nothing carrying both a rule id and a
      // severity. generateLetter would refuse this anyway; refuse it here too.
      skipped.push({ bureau, reason: "no_rule_id_claims" });
      continue;
    }

    const priorCase = existing.get(bureau);
    if (priorCase && priorCase.letter_count > 0) {
      skipped.push({ bureau, reason: "already_generated", caseId: priorCase.id });
      caseIds.push(priorCase.id);
      continue;
    }

    let caseRow;
    if (priorCase) {
      caseRow = priorCase;
    } else {
      caseRow = await createCase(db, { orgId, clientId, bureau, round });
      casesWritten++;
    }
    caseIds.push(caseRow.id);

    if (!priorCase || priorCase.item_count === 0) {
      await insertItems(db, caseRow, claims);
    }

    const priorLetters = await priorLetterBodies(db, { orgId, clientId, bureau });

    let letter;
    try {
      letter = await generateLetter({
        violations: claims,
        identity,
        bureau,
        round,
        priorLetters,
        seed: `${clientId}:${bureau}:${round}`
      });
    } catch (err) {
      skipped.push({ bureau, reason: refusalReason(err), caseId: caseRow.id });
      continue;
    }

    if (!letter?.ok) {
      skipped.push({ bureau, reason: letter?.reason || "letter_refused", caseId: caseRow.id });
      continue;
    }

    const savedLetter = await saveLetter(db, {
      caseId: caseRow.id,
      orgId,
      clientId,
      bureau,
      round,
      bodyText: letter.text,
      fingerprint: fingerprintDigest(letter.fingerprint),
      ruleIds: letter.ruleIds,
      status: "generated"
    });

    stored.push({
      bureau,
      caseId: caseRow.id,
      letterId: savedLetter.id,
      ruleIds: letter.ruleIds || [],
      itemCount: claims.length
    });
  }

  // Every bureau was already done on an earlier run: report that plainly and
  // touch neither the tables nor the card.
  if (stored.length === 0 && casesWritten === 0
    && skipped.length > 0 && skipped.every((s) => s.reason === "already_generated")) {
    return {
      ok: true,
      already_generated: true,
      round,
      caseIds,
      letters: [],
      skipped,
      identity_complete: identity.complete
    };
  }

  const events = [];
  if (casesWritten > 0 || stored.length > 0) {
    events.push(await onRepairEvent(db, {
      name: "repair.analysis.complete",
      orgId,
      clientId,
      payload: { staffId, round, bureaus, source: "repair_analyze" }
    }));
  }
  if (stored.length > 0) {
    events.push(await onRepairEvent(db, {
      name: "repair.letters.ready",
      orgId,
      clientId,
      payload: {
        staffId,
        round,
        letterIds: stored.map((s) => s.letterId),
        source: "repair_analyze"
      }
    }));
  }

  return {
    ok: true,
    round,
    caseIds,
    letters: stored,
    skipped,
    letters_stored: stored.length,
    identity_complete: identity.complete,
    events
  };
}
