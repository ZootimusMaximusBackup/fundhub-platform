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
// WS-B: R1–R6 rounds, letter target (bureau|furnisher), furnisher validation
// letters, prior bureau responses fed into R2+ evidence. Auth gate (WS-A) stays.

import { createHash } from "node:crypto";

import { violationsByBureauFromMergedCrs } from "../metro2/diy/from-crs.mjs";
import { isCollectorFinding } from "../metro2/diy/collectors.mjs";
import { generateLetter } from "../metro2/letters/generate.mjs";
import { buildFurnisherValidationLetter } from "../metro2/letters/furnisher-validation.mjs";
import {
  createCase,
  insertItems,
  saveLetter,
  findFurnisherAddress
} from "../metro2/rounds/store.mjs";
import { roundAllowed } from "../metro2/rounds/state.mjs";
import { loadClientReturnAddress } from "../inquiry-ops/call-scheduler.mjs";
import { hasRepairAgreement } from "./dispute-auth.mjs";
import { onRepairEvent } from "./handlers.mjs";

const BUREAU_CODES = Object.freeze(["TU", "EX", "EQ"]);

/** dispute_cases.round CHECK — R1–R6 bureau rounds + FURNISHER. */
export const ROUNDS = Object.freeze(["R1", "R2", "R3", "R4", "R5", "R6", "FURNISHER"]);

/** How many prior letters to the same bureau the variance gate compares against. */
const PRIOR_WINDOW = 5;

/**
 * Group collection / debt-buyer claims by creditor name_norm for furnisher letters.
 * Pure — unit-tested without a DB.
 */
export function groupFurnisherClaims(claimsByBureau = {}) {
  const byNorm = new Map();
  for (const [bureau, list] of Object.entries(claimsByBureau || {})) {
    for (const v of list || []) {
      if (!isCollectorFinding(v)) continue;
      const name = String(v.creditor || v.subject || "").trim();
      if (!name) continue;
      const nameNorm = name.toLowerCase();
      const row = byNorm.get(nameNorm) || {
        name,
        nameNorm,
        bureau: String(bureau).toUpperCase(),
        claims: [],
        account_last4: v.account_last4 || v.accountLast4 || null
      };
      row.claims.push({ ...v, _bureau: String(bureau).toUpperCase() });
      if (!row.account_last4) row.account_last4 = v.account_last4 || v.accountLast4 || null;
      byNorm.set(nameNorm, row);
    }
  }
  return [...byNorm.values()];
}

/**
 * dispute_letters.fingerprint is text[], and generateLetter's `fingerprint` is
 * the RAW SHINGLE SET — we store a stable digest only (see prior comment history).
 */
export function fingerprintDigest(fingerprint) {
  const list = Array.isArray(fingerprint) ? fingerprint : [...(fingerprint || [])];
  if (!list.length) return [];
  const hex = createHash("sha256").update(list.slice().sort().join("\n")).digest("hex");
  return [`sha256:${hex}`];
}

/**
 * A violation only becomes a dispute_items row if it carries BOTH a rule id and
 * a severity.
 */
export function ruleBackedClaims(violations) {
  return (violations || []).filter((v) => v && v.ruleId && v.severity);
}

function refusalReason(err) {
  const msg = String(err?.message || err || "").trim();
  if (/no_rule_id_claims/.test(msg)) return "no_rule_id_claims";
  return `letter_error:${msg.slice(0, 160)}`;
}

async function newestCreditFile(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT result FROM crs_results
      WHERE client_id = $1::uuid AND org_id = $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [clientId, orgId]
  );
  return r.rows[0]?.result || null;
}

/** Map a businesses.entity_data object to the letter return-address shape. */
export function addressFromBusinessEntity(entity) {
  const e = entity && typeof entity === "object" ? entity : {};
  const line1 = String(e.address_line1 || e.addressLine1 || e.street || e.line1 || "").trim();
  if (!line1) return null;
  return {
    address_line1: line1,
    address_line2: e.address_line2 || e.addressLine2 || e.line2 || null,
    address_city: e.city || e.address_city || null,
    address_state: e.state || e.address_state || null,
    address_zip: e.postal_code || e.zip || e.address_zip || null
  };
}

async function loadCompanyReturnAddress(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT entity_data FROM businesses
      WHERE client_id = $1::uuid AND org_id = $2::uuid
      ORDER BY created_at ASC`,
    [clientId, orgId]
  );
  for (const row of r.rows) {
    const mapped = addressFromBusinessEntity(row.entity_data);
    if (mapped) return mapped;
  }
  return null;
}

async function loadExistingRoundLetters(db, { orgId, clientId, round }) {
  const prior = await db.query(
    `SELECT dl.id, dl.bureau, dl.case_id, dl.body_text, dl.rule_ids
       FROM dispute_letters dl
       JOIN dispute_cases dc ON dc.id = dl.case_id
      WHERE dl.org_id = $1::uuid AND dl.client_id = $2::uuid
        AND dc.round = $3
        AND dl.status IN ('generated', 'ready', 'queued', 'sent')
      ORDER BY dl.bureau`,
    [orgId, clientId, round]
  );
  return prior.rows.map((row) => ({
    bureau: row.bureau,
    caseId: row.case_id,
    letterId: row.id,
    ruleIds: row.rule_ids || [],
    body_text: row.body_text || ""
  }));
}

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
  if (!addr?.address_line1) {
    try {
      addr = await loadCompanyReturnAddress(db, { orgId, clientId }) || addr;
    } catch {
      /* keep pii addr or null */
    }
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
        AND COALESCE(target, 'bureau') = 'bureau'
      ORDER BY created_at DESC LIMIT ${PRIOR_WINDOW}`,
    [orgId, clientId, bureau]
  );
  return r.rows.map((row) => row.body_text).filter(Boolean);
}

async function loadPriorResponses(db, { orgId, clientId, bureau, claims }) {
  const r = await db.query(
    `SELECT dr.raw_text, dr.parse_json, dr.created_at, dr.confirmed,
            di.account_last4, di.creditor, di.round, di.outcome
       FROM dispute_responses dr
       JOIN dispute_cases dc ON dc.id = dr.case_id
       LEFT JOIN dispute_items di ON di.case_id = dr.case_id
      WHERE dr.org_id = $1::uuid AND dr.client_id = $2::uuid
        AND dr.confirmed = true
        AND dc.bureau = $3
      ORDER BY dr.created_at ASC`,
    [orgId, clientId, bureau]
  );
  const claimLast4 = new Set(
    (claims || [])
      .map((c) => String(c.account_last4 || c.accountLast4 || "").replace(/\D/g, "").slice(-4))
      .filter(Boolean)
  );
  const out = [];
  for (const row of r.rows) {
    const last4 = String(row.account_last4 || "").replace(/\D/g, "").slice(-4);
    if (claimLast4.size && last4 && !claimLast4.has(last4)) continue;
    let outcome = row.outcome;
    const parse = row.parse_json || {};
    if (!outcome && Array.isArray(parse.outcomes)) {
      const match = parse.outcomes.find((o) => {
        const o4 = String(o.account_last4 || o.accountLast4 || "").replace(/\D/g, "").slice(-4);
        return o4 && o4 === last4;
      });
      outcome = match?.outcome || parse.outcomes[0]?.outcome;
    }
    out.push({
      date: row.created_at,
      outcome: outcome || "verified",
      accountLast4: last4 || null,
      rawExcerpt: row.raw_text || null,
      round: row.round
    });
  }
  return out;
}

async function loadRepairProgram(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT program, rounds_cap, status FROM repair_programs
      WHERE org_id = $1::uuid AND client_id = $2::uuid LIMIT 1`,
    [orgId, clientId]
  );
  return r.rows[0] || null;
}

async function existingFurnisherLetter(db, { orgId, clientId, furnisherAddressId }) {
  if (!furnisherAddressId) return null;
  const r = await db.query(
    `SELECT id FROM dispute_letters
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND target = 'furnisher' AND furnisher_address_id = $3::uuid
      LIMIT 1`,
    [orgId, clientId, furnisherAddressId]
  );
  return r.rows[0] || null;
}

/**
 * Analyse a client's stored credit file and store the dispute letters it
 * supports. Writes only; never transmits.
 */
export async function analyzeAndGenerate(db, { orgId, clientId, round = "R1", staffId = null } = {}) {
  if (!db?.query) return { ok: false, reason: "db_required" };
  if (!orgId || !clientId) return { ok: false, reason: "missing_ids" };
  if (!ROUNDS.includes(round)) return { ok: false, reason: "invalid_round", round };

  // Letters already on file: Stage succeeds without a new consent click.
  const existingLetters = await loadExistingRoundLetters(db, { orgId, clientId, round });
  if (existingLetters.length > 0) {
    const identity = await loadIdentity(db, { orgId, clientId });
    return {
      ok: true,
      already_generated: true,
      round,
      caseIds: [...new Set(existingLetters.map((l) => l.caseId).filter(Boolean))],
      letters: existingLetters,
      skipped: existingLetters.map((l) => ({ bureau: l.bureau, reason: "already_generated" })),
      warnings: [],
      identity_complete: Boolean(identity?.complete)
    };
  }

  // WS-A auth gate — do not remove. Enrollment or a signed repair contract
  // counts as the agreement; the extra consent row is not the only one.
  const authorized = await hasRepairAgreement(db, { orgId, clientId });
  if (!authorized) return { ok: false, reason: "no_authorization" };

  const program = await loadRepairProgram(db, { orgId, clientId });
  const roundsCap = program?.rounds_cap != null ? Number(program.rounds_cap) : 6;
  if (round !== "FURNISHER" && !roundAllowed(round, roundsCap)) {
    return {
      ok: false,
      reason: "round_cap_exceeded",
      round,
      rounds_cap: roundsCap,
      program: program?.program || null
    };
  }

  const result = await newestCreditFile(db, { orgId, clientId });
  if (!result) return { ok: false, reason: "no_credit_file" };

  const byBureau = violationsByBureauFromMergedCrs(result);
  const bureaus = BUREAU_CODES.filter((code) => (byBureau[code] || []).length > 0);
  if (bureaus.length === 0) return { ok: false, reason: "no_violations" };

  const identity = await loadIdentity(db, { orgId, clientId });
  if (!identity) return { ok: false, reason: "client_not_found" };
  if (!identity.fullName) return { ok: false, reason: "missing_identity" };

  const stored = [];
  const skipped = [];
  const caseIds = [];
  let casesWritten = 0;
  const warnings = [];

  if (round !== "FURNISHER") {
    const existing = await openCasesByBureau(db, { orgId, clientId, round });

    for (const bureau of bureaus) {
      const claims = ruleBackedClaims(byBureau[bureau]);
      if (claims.length === 0) {
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
      const priorResponses = round === "R1"
        ? []
        : await loadPriorResponses(db, { orgId, clientId, bureau, claims });

      let letter;
      try {
        letter = await generateLetter({
          violations: claims,
          identity,
          bureau,
          round,
          priorLetters,
          priorResponses,
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
        status: "generated",
        target: "bureau"
      });

      stored.push({
        bureau,
        target: "bureau",
        caseId: caseRow.id,
        letterId: savedLetter.id,
        ruleIds: letter.ruleIds || [],
        itemCount: claims.length,
        body_text: letter.text || ""
      });
    }
  }

  // Furnisher validation — with R1 or explicit FURNISHER regen. Both sides at once (§2.9).
  if (round === "R1" || round === "FURNISHER") {
    const claimsByBureau = {};
    for (const bureau of bureaus) {
      claimsByBureau[bureau] = ruleBackedClaims(byBureau[bureau]);
    }
    const groups = groupFurnisherClaims(claimsByBureau);

    for (const group of groups) {
      const addr = await findFurnisherAddress(db, group.name, orgId);
      if (!addr) {
        skipped.push({
          bureau: group.bureau,
          target: "furnisher",
          creditor: group.name,
          reason: "no_furnisher_address"
        });
        warnings.push({ key: "no_furnisher_address", creditor: group.name });
        continue;
      }

      const already = await existingFurnisherLetter(db, {
        orgId,
        clientId,
        furnisherAddressId: addr.id
      });
      if (already) {
        skipped.push({
          bureau: group.bureau,
          target: "furnisher",
          creditor: group.name,
          reason: "already_generated",
          letterId: already.id
        });
        continue;
      }

      const caseRow = await createCase(db, {
        orgId,
        clientId,
        bureau: group.bureau,
        round: "FURNISHER"
      });
      casesWritten++;
      caseIds.push(caseRow.id);
      await insertItems(db, caseRow, group.claims);

      const built = buildFurnisherValidationLetter({
        identity,
        furnisher: {
          name: addr.name,
          addressLines: [
            addr.address_line1,
            addr.address_line2,
            [addr.city, addr.state, addr.zip].filter(Boolean).join(", ")
          ].filter(Boolean)
        },
        account: {
          creditor: group.name,
          last4: group.account_last4,
          accountType: "collection"
        }
      });

      const savedLetter = await saveLetter(db, {
        caseId: caseRow.id,
        orgId,
        clientId,
        bureau: group.bureau,
        round: "FURNISHER",
        bodyText: built.text,
        fingerprint: fingerprintDigest([built.text.slice(0, 64)]),
        ruleIds: group.claims.map((c) => c.ruleId).filter(Boolean),
        status: "generated",
        target: "furnisher",
        furnisherAddressId: addr.id
      });

      stored.push({
        bureau: group.bureau,
        target: "furnisher",
        furnisher: addr.name,
        furnisher_address_id: addr.id,
        caseId: caseRow.id,
        letterId: savedLetter.id,
        ruleIds: group.claims.map((c) => c.ruleId).filter(Boolean),
        itemCount: group.claims.length,
        body_text: built.text || ""
      });
    }
  }

  if (stored.length === 0 && casesWritten === 0
    && skipped.length > 0 && skipped.every((s) => s.reason === "already_generated")) {
    const letters = await loadExistingRoundLetters(db, { orgId, clientId, round });
    return {
      ok: true,
      already_generated: true,
      round,
      caseIds,
      letters,
      skipped,
      warnings,
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
    warnings,
    letters_stored: stored.length,
    identity_complete: identity.complete,
    events
  };
}
