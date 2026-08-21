// Repair client emails — email only (owner §2.4). Queued via sendTemplated.
// Wired from onRepairEvent so HTTP-path and bus-path both send.

import { sendTemplated } from "../workflows/messaging.mjs";

export const EMAIL_REPAIR_WELCOME = "EMAIL-REPAIR-WELCOME";
export const EMAIL_REPAIR_LETTERS_SENT = "EMAIL-REPAIR-LETTERS-SENT";
export const EMAIL_REPAIR_RESPONSE_RESULTS = "EMAIL-REPAIR-RESPONSE-RESULTS";
export const EMAIL_REPAIR_ROUND_ADVANCED = "EMAIL-REPAIR-ROUND-ADVANCED";
export const EMAIL_REPAIR_RETAKE_PHOTO = "EMAIL-REPAIR-RETAKE-PHOTO";
export const EMAIL_REPAIR_TRIAL_COMPLETE_UPSELL = "EMAIL-REPAIR-TRIAL-COMPLETE-UPSELL";

export const REPAIR_EMAIL_KEYS = Object.freeze([
  EMAIL_REPAIR_WELCOME,
  EMAIL_REPAIR_LETTERS_SENT,
  EMAIL_REPAIR_RESPONSE_RESULTS,
  EMAIL_REPAIR_ROUND_ADVANCED,
  EMAIL_REPAIR_RETAKE_PHOTO,
  EMAIL_REPAIR_TRIAL_COMPLETE_UPSELL
]);

/** Event name → template key. Retake is email-only (no pipeline stage move). */
export const TEMPLATE_BY_EVENT = Object.freeze({
  "repair.enrolled": EMAIL_REPAIR_WELCOME,
  "repair.letters.sent": EMAIL_REPAIR_LETTERS_SENT,
  "repair.response.parsed": EMAIL_REPAIR_RESPONSE_RESULTS,
  "repair.round.escalated": EMAIL_REPAIR_ROUND_ADVANCED,
  "repair.response.retake": EMAIL_REPAIR_RETAKE_PHOTO,
  "repair.program.complete": EMAIL_REPAIR_TRIAL_COMPLETE_UPSELL
});

const BUREAU_LABEL = Object.freeze({
  EX: "Experian",
  EQ: "Equifax",
  TU: "TransUnion",
  EXPERIAN: "Experian",
  EQUIFAX: "Equifax",
  TRANSUNION: "TransUnion"
});

const OUTCOME_WORDS = Object.freeze({
  deleted: "no longer listed on that bureau letter",
  verified: "bureau says they verified it",
  updated: "bureau updated the reporting",
  unaddressed: "not addressed in this letter"
});

export function bureauLabel(code) {
  const k = String(code || "").toUpperCase();
  return BUREAU_LABEL[k] || k || "bureau";
}

/** One line per account: "Chase ending 1234 (Experian)". */
export function formatAccountLine({ creditor, accountLast4, bureau } = {}) {
  const name = String(creditor || "Account").trim() || "Account";
  const last4 = accountLast4 ? ` ending ${String(accountLast4).replace(/\D/g, "").slice(-4)}` : "";
  const b = bureau ? ` (${bureauLabel(bureau)})` : "";
  return `${name}${last4}${b}`;
}

export function formatAccountsList(rows = []) {
  const lines = (rows || []).map((r) => formatAccountLine(r)).filter(Boolean);
  return lines.length ? lines.map((l) => `• ${l}`).join("\n") : "• (accounts for this round)";
}

export function formatBureausList(codes = []) {
  const labels = [...new Set((codes || []).map(bureauLabel).filter(Boolean))];
  return labels.length ? labels.join(", ") : "the credit bureaus";
}

export function formatOutcomesList(rows = []) {
  const lines = [];
  for (const r of rows || []) {
    const account = formatAccountLine(r);
    const words = OUTCOME_WORDS[String(r.outcome || "").toLowerCase()] || "response recorded";
    lines.push(`• ${account}: ${words}`);
  }
  return lines.length ? lines.join("\n") : "• (no per-account lines yet)";
}

export function formatEscalatedList(rows = []) {
  const lines = [];
  for (const r of rows || []) {
    const account = formatAccountLine(r);
    const why = r.why || "prior bureau answer left this open for another step";
    lines.push(`• ${account} — ${why}`);
  }
  return lines.length ? lines.join("\n") : "• (items moving to the next round)";
}

/**
 * Build the repair.* merge bag for sendTemplated context.
 * Callers may pass pre-built strings; missing ones are filled from rows.
 */
export function repairMergeContext(payload = {}) {
  const p = payload || {};
  const accounts = p.accounts || p.accountRows || [];
  const outcomes = p.outcomes || p.outcomeRows || [];
  const escalated = p.escalated || p.escalatedRows || [];
  const bureaus = p.bureaus || accounts.map((a) => a.bureau).filter(Boolean);
  return {
    repair: {
      accounts_list: p.accounts_list || formatAccountsList(accounts),
      bureaus_list: p.bureaus_list || formatBureausList(bureaus),
      round: p.round != null ? String(p.round).replace(/^R/i, "") || String(p.round) : "",
      outcomes_list: p.outcomes_list || formatOutcomesList(outcomes),
      escalated_list: p.escalated_list || formatEscalatedList(escalated),
      retake_message: p.retake_message || p.message_to_client || "Please retake a clear photo of the full letter page.",
      results_recap: p.results_recap || p.recap || "We completed the trial dispute rounds on your file."
    }
  };
}

async function loadAccountsForSentLetters(db, { orgId, clientId, letterIds = [], bureaus = [] } = {}) {
  if (!db?.query || !orgId || !clientId) return { accounts: [], bureaus: bureaus || [], round: null };
  const ids = (letterIds || []).filter(Boolean);
  let round = null;
  let bureauCodes = [...(bureaus || [])];

  if (ids.length) {
    const letters = await db.query(
      `SELECT id, bureau, round
         FROM dispute_letters
        WHERE org_id = $1::uuid AND client_id = $2::uuid
          AND id = ANY($3::uuid[])`,
      [orgId, clientId, ids]
    );
    for (const row of letters.rows || []) {
      if (row.bureau) bureauCodes.push(row.bureau);
      if (row.round && !round) round = row.round;
    }
  }

  bureauCodes = [...new Set(bureauCodes.map((b) => String(b).toUpperCase()).filter(Boolean))];

  const items = await db.query(
    `SELECT i.creditor, i.account_last4, c.bureau, c.round
       FROM dispute_items i
       JOIN dispute_cases c ON c.id = i.case_id
      WHERE i.org_id = $1::uuid AND i.client_id = $2::uuid
        AND i.status IN ('open','sent','escalated','verified','unaddressed')
        AND ($3::text[] IS NULL OR cardinality($3::text[]) = 0 OR c.bureau = ANY($3::text[]))
      ORDER BY c.bureau, i.creditor NULLS LAST
      LIMIT 40`,
    [orgId, clientId, bureauCodes.length ? bureauCodes : null]
  );

  const accounts = (items.rows || []).map((r) => ({
    creditor: r.creditor,
    accountLast4: r.account_last4,
    bureau: r.bureau
  }));
  if (!round && items.rows?.[0]?.round) round = items.rows[0].round;
  return { accounts, bureaus: bureauCodes, round };
}

function eventIdFor(name, orgId, clientId, payload = {}) {
  if (payload.eventId) return String(payload.eventId);
  if (payload.idempotencyKey) return String(payload.idempotencyKey);
  const stamp = payload.caseId || payload.round || payload.staffId || "x";
  return `repair-email:${name}:${orgId}:${clientId}:${stamp}`;
}

/**
 * Queue the email for a repair.* event. Channel is always email.
 * trial-complete upsell only fires when program is trial (payload or DB).
 */
export async function notifyRepairEmail(db, {
  name,
  orgId,
  clientId,
  payload = {},
  send = sendTemplated
} = {}) {
  const templateKey = TEMPLATE_BY_EVENT[name];
  if (!templateKey) return { sent: false, reason: "no_template_for_event" };
  if (!orgId || !clientId) return { sent: false, reason: "missing_ids" };

  if (name === "repair.program.complete") {
    let program = payload.program;
    if (!program && db?.query) {
      const r = await db.query(
        `SELECT program FROM repair_programs
          WHERE org_id = $1::uuid AND client_id = $2::uuid LIMIT 1`,
        [orgId, clientId]
      );
      program = r.rows[0]?.program;
    }
    if (program && program !== "trial") {
      return { sent: false, reason: "not_trial_program", templateKey };
    }
  }

  let mergePayload = { ...payload };
  if (name === "repair.letters.sent" && !payload.accounts_list && !(payload.accounts || []).length) {
    const letterIds = (payload.results || [])
      .map((r) => r.letterId || r.letter_id)
      .filter(Boolean);
    const bureaus = (payload.results || []).map((r) => r.bureau).filter(Boolean);
    const loaded = await loadAccountsForSentLetters(db, { orgId, clientId, letterIds, bureaus });
    mergePayload = {
      ...mergePayload,
      accounts: loaded.accounts,
      bureaus: loaded.bureaus.length ? loaded.bureaus : bureaus,
      round: mergePayload.round || loaded.round
    };
  }

  if (name === "repair.round.escalated" && mergePayload.round) {
    const n = String(mergePayload.round).replace(/^R/i, "");
    mergePayload = { ...mergePayload, round: n };
  }

  const context = repairMergeContext(mergePayload);
  const eventId = eventIdFor(name, orgId, clientId, payload);

  const result = await send(db, {
    orgId,
    clientId,
    channel: "email",
    templateKey,
    eventId,
    context
  });

  return { ...result, templateKey, eventId };
}

/** WS-C retake path — queues EMAIL-REPAIR-RETAKE-PHOTO without moving the card. */
export async function notifyRepairRetake(db, {
  orgId,
  clientId,
  messageToClient,
  eventId,
  send = sendTemplated
} = {}) {
  return notifyRepairEmail(db, {
    name: "repair.response.retake",
    orgId,
    clientId,
    payload: {
      retake_message: messageToClient,
      message_to_client: messageToClient,
      eventId: eventId || `repair-retake:${orgId}:${clientId}:${Date.now()}`
    },
    send
  });
}
