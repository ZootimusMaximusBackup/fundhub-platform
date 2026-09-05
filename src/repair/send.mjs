// Human send gate for repair DIY + DFY bureau + furnisher letters.
// Staff must press send (mail: true). Never call from payment.received / ds-02.

import { mailBureauLetter } from "../metro2/delivery/send.mjs";
import { findFurnisherAddress } from "../metro2/rounds/store.mjs";
import {
  complaintDestination,
  isComplaintTarget,
  recordComplaintFiling
} from "../metro2/rounds/complaint-filing.mjs";
import { onRepairEvent } from "./handlers.mjs";

export class RepairSendError extends Error {
  constructor(message, { status = 400, code = "repair_send" } = {}) {
    super(message);
    this.name = "RepairSendError";
    this.status = status;
    this.code = code;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE DOUBLE-MAILING GUARD
//
// Before this, the loop below set status='sent' with no check of the current
// status, and dispute_letters carried no unique index. So re-POSTing the same
// payload handed the same letters to PostGrid again: two identical letters in a
// real person's post, two at the bureau, and two bills. A disabled button in a
// browser is not a guard — a retry, a second tab or curl walks past it.
//
// db/migrations/332 adds the database half: a `mailed_at` column, a 'sending'
// status, and uq_dispute_letters_one_mailing, a partial unique index over
// (org_id, case_id, bureau, round, target) WHERE mailed_at IS NOT NULL.
//
// This is the code half. A letter is CLAIMED before the provider is called, in
// one statement, so two callers cannot both pass the check: the second one's
// UPDATE matches nothing and it never makes the call.
//
// REFUSE ONLY ON POSITIVE EVIDENCE. A claim that affects no rows is not by
// itself proof of a double send — the letter id might name no row at all, which
// is a bad request and is exactly as (un)guarded as it was before this change.
// So a failed claim is followed by a read, and the send is refused only when
// that read shows a row that really is already claimed or already sent, or when
// the unique index rejected the claim because a DIFFERENT row for the same
// case, bureau, round and destination has already gone out.

const UNIQUE_VIOLATION = "23505";

// The mailer's refusals that happen ABOVE the network call — every one of them
// is a check in our own code in src/messaging/providers/mail-letter.mjs or
// src/metro2/delivery/send.mjs that returns before `postJson` is reached. When
// one of these comes back, nothing was transmitted, so the claim is released
// and the letter stays sendable.
//
// Anything else keeps the claim. If a call was made and did not come back we do
// not know whether the letter went, and retrying is the one action that can
// actually mail it twice. Same call subscription_charges makes for 'in_flight'
// (db/migrations/276): a stuck row is a support ticket, a second mailing is a
// letter in somebody's post that we cannot take back.
const PRE_TRANSMISSION_REFUSALS = [
  "POSTGRID_API_KEY unset",
  "return_address_required",
  "return_address_incomplete",
  "destination_address_missing",
  "bureau_mail_address_missing",
  "bureau_mail_address_incomplete",
  "pdf_or_html_required",
  "private_carrier_forbidden_for_po_box"
];

export function isPreTransmissionRefusal(error) {
  const s = String(error || "");
  return PRE_TRANSMISSION_REFUSALS.some((prefix) => s.startsWith(prefix));
}

/**
 * Take the letter for mailing, before anything is transmitted.
 *
 * @returns {Promise<{claimed: boolean, reason: string|null, priorStatus: string|null}>}
 *   claimed true  — this caller holds the letter and may send it.
 *   claimed false — do not send. `reason` says why.
 */
async function claimLetterForMailing(db, { letterId, orgId, clientId }) {
  if (!letterId || !db?.query) return { claimed: true, reason: null, priorStatus: null };

  let claim;
  try {
    claim = await db.query(
      `WITH prior AS (
         SELECT id, status FROM dispute_letters
          WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
       )
       UPDATE dispute_letters d
          SET status = 'sending', mailed_at = now()
         FROM prior
        WHERE d.id = prior.id
          AND d.mailed_at IS NULL
          AND d.status NOT IN ('sending', 'sent', 'delivered')
       RETURNING prior.status AS prior_status`,
      [letterId, orgId, clientId]
    );
  } catch (err) {
    // uq_dispute_letters_one_mailing: another row for the same case, bureau,
    // round and destination has already been mailed. This one must not be.
    if (err?.code === UNIQUE_VIOLATION) {
      return { claimed: false, reason: "already_mailed_duplicate_letter", priorStatus: null };
    }
    // Any other database failure means we do not know whether this letter is
    // safe to send, so it is not sent. Refusing one letter rather than throwing
    // keeps the rest of the batch — including letters already handed to the
    // provider — reportable to the caller.
    return { claimed: false, reason: "claim_failed", priorStatus: null };
  }

  if (claim?.rows?.length) {
    return { claimed: true, reason: null, priorStatus: claim.rows[0].prior_status ?? null };
  }

  // Nothing was claimed. Read the row and refuse only if it says, positively,
  // that this letter has already been taken.
  let existing = null;
  try {
    const r = await db.query(
      `SELECT status, mailed_at FROM dispute_letters
        WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid LIMIT 1`,
      [letterId, orgId, clientId]
    );
    existing = r?.rows?.[0] || null;
  } catch {
    existing = null;
  }

  if (!existing) return { claimed: true, reason: null, priorStatus: null };
  if (existing.mailed_at) return { claimed: false, reason: "already_mailed", priorStatus: existing.status ?? null };
  if (["sending", "sent", "delivered"].includes(existing.status)) {
    return { claimed: false, reason: "already_mailed", priorStatus: existing.status };
  }
  return { claimed: true, reason: null, priorStatus: existing.status ?? null };
}

/** Give the letter back, for a refusal that provably happened before transmission. */
async function releaseLetterClaim(db, { letterId, orgId, clientId, priorStatus }) {
  if (!letterId || !db?.query) return;
  await db.query(
    `UPDATE dispute_letters
        SET status = COALESCE($4, 'ready'), mailed_at = NULL
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
        AND status = 'sending'`,
    [letterId, orgId, clientId, priorStatus || null]
  ).catch(() => {});
}

async function resolveLetterRouting(db, letter, { orgId, identity = null }) {
  const letterId = letter.letterId || letter.letter_id || null;
  let target = letter.target || null;
  let furnisherAddressId = letter.furnisher_address_id || letter.furnisherAddressId || null;
  let furnisherName = letter.furnisherName || letter.furnisher || null;
  let to = letter.to || null;

  if (letterId && db?.query && (!target || (target === "furnisher" && !furnisherAddressId && !to))) {
    const r = await db.query(
      `SELECT target, furnisher_address_id, bureau FROM dispute_letters
        WHERE id = $1::uuid AND org_id = $2::uuid LIMIT 1`,
      [letterId, orgId]
    );
    const row = r.rows[0];
    if (row) {
      target = target || row.target || "bureau";
      furnisherAddressId = furnisherAddressId || row.furnisher_address_id || null;
    }
  }

  target = target || "bureau";

  // A CFPB or state AG complaint. Same human send gate, same provider — only the
  // destination differs. A state AG has no postal address on file today, so that
  // send is REFUSED rather than guessed; see ../metro2/rounds/complaint-filing.mjs.
  if (isComplaintTarget(target)) {
    if (to) return { target, furnisherAddressId: null, furnisherName: null, to, refusal: null };
    const dest = complaintDestination(target, {
      state: identity?.state || identity?.address_state || letter.state || null
    });
    return {
      target,
      furnisherAddressId: null,
      furnisherName: null,
      to: dest.ok ? dest.to : null,
      refusal: dest.ok ? null : dest.reason
    };
  }

  if (target === "furnisher" && !to && furnisherAddressId && db?.query) {
    const r = await db.query(
      `SELECT * FROM furnisher_mail_addresses WHERE id = $1::uuid LIMIT 1`,
      [furnisherAddressId]
    );
    const row = r.rows[0];
    if (row) {
      furnisherName = furnisherName || row.name;
      to = {
        company_name: row.name,
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        address_city: row.city,
        address_state: row.state,
        address_zip: row.zip,
        address_country: row.country || "US"
      };
    }
  }

  if (target === "furnisher" && !to && furnisherName && db) {
    const row = await findFurnisherAddress(db, furnisherName, orgId);
    if (row) {
      to = {
        company_name: row.name,
        address_line1: row.address_line1,
        address_line2: row.address_line2,
        address_city: row.city,
        address_state: row.state,
        address_zip: row.zip,
        address_country: row.country || "US"
      };
    }
  }

  return { target, furnisherAddressId, furnisherName, to, refusal: null };
}

export async function sendRepairLetters(db, {
  orgId,
  clientId,
  staffId,
  mail = false,
  letters = [],
  identity = null,
  from = null,
  mailSender = null,
  env,
  fetchImpl
} = {}) {
  if (!orgId || !clientId || !staffId) {
    throw new RepairSendError("orgId, clientId, and staffId are required", { status: 400 });
  }
  if (!mail) {
    throw new RepairSendError("mail required — human must press send", { code: "no_channel" });
  }
  if (!Array.isArray(letters) || letters.length === 0) {
    throw new RepairSendError("at least one letter is required", { code: "letters_required" });
  }

  const results = [];
  for (const letter of letters) {
    const bureau = String(letter.bureau || "").toUpperCase();
    if (!bureau) {
      throw new RepairSendError("each letter needs a bureau", { code: "bureau_required" });
    }

    const routing = await resolveLetterRouting(db, letter, { orgId, identity });
    // No address, no send, no filing row. A complaint that cannot be addressed
    // must never be reported as mailed — Round 6 reads those rows.
    if (routing.refusal) {
      results.push({ bureau, target: routing.target, ok: false, error: routing.refusal });
      continue;
    }
    const enriched = {
      ...letter,
      bureau,
      target: routing.target,
      furnisherName: routing.furnisherName,
      to: routing.to
    };

    // CLAIM BEFORE SENDING. Everything above this line is addressing; nothing
    // has been transmitted yet, so this is the last honest moment to decide
    // whether this letter is allowed to go.
    const claimLetterId = letter.letterId || letter.letter_id || null;
    const claim = await claimLetterForMailing(db, {
      letterId: claimLetterId,
      orgId,
      clientId
    });
    if (!claim.claimed) {
      results.push({
        bureau,
        target: routing.target,
        ok: false,
        error: claim.reason,
        letterId: claimLetterId
      });
      continue;
    }

    let sent;
    if (typeof mailSender === "function") {
      sent = await mailSender({
        ...enriched,
        identity,
        from,
        orgId,
        clientId
      });
    } else {
      sent = await mailBureauLetter({
        db,
        // A complaint is not addressed to a bureau, so the bureau lookup must not
        // be allowed to supply a fallback destination for it.
        bureau: (routing.target === "furnisher" || isComplaintTarget(routing.target)) ? null : bureau,
        furnisherName: routing.target === "furnisher" ? routing.furnisherName : null,
        to: routing.to,
        identity,
        from,
        pdf: letter.pdf || letter.pdfBase64,
        html: letter.html,
        description: letter.description
          || (isComplaintTarget(routing.target)
            ? `Repair complaint ${routing.target.toUpperCase()} ${bureau}`
            : routing.target === "furnisher"
              ? `Repair furnisher letter ${routing.furnisherName || bureau}`
              : `Repair letter ${bureau}`),
        metadata: {
          orgId,
          clientId,
          staffId,
          letterId: letter.letterId || letter.letter_id || null,
          target: routing.target,
          stack: "repair"
        },
        env,
        fetchImpl
      });
    }

    if (sent?.ok === false || (sent && sent.ok !== true && sent.providerId == null && sent.outcome?.startsWith?.("mail_failed"))) {
      const err = sent?.error || sent?.outcome || "mail_failed";
      // Give the letter back only when the refusal provably happened before any
      // request left this process. Everything else keeps the claim, because a
      // call that was made and did not come back may already have mailed.
      if (isPreTransmissionRefusal(err)) {
        await releaseLetterClaim(db, {
          letterId: claimLetterId,
          orgId,
          clientId,
          priorStatus: claim.priorStatus
        });
      }
      results.push({ bureau, target: routing.target, ok: false, error: err });
      continue;
    }

    const providerId = sent?.providerId || sent?.id || null;
    const letterId = claimLetterId;
    if (letterId && providerId && db?.query) {
      await db.query(
        `UPDATE dispute_letters
            SET status = 'sent', postgrid_letter_id = $2
          WHERE id = $1::uuid AND org_id = $3::uuid AND client_id = $4::uuid
            AND status <> 'delivered'`,
        [letterId, String(providerId), orgId, clientId]
      ).catch(() => {});
    }

    // Start the bureau's 30-day clock. Nothing wrote response_due_at before this
    // — createCase defaulted it to null and no other statement in the repo ever
    // set it — so the awaiting_response SLA and the overdue next-action have
    // never once been able to fire.
    //
    // Here is the only honest moment to stamp it: the mailer has taken the
    // letter. Not at generation, when it might never go out.
    //
    // `response_due_at IS NULL` is load-bearing. Re-sending on a case that is
    // already running must not push the deadline out, and this must never touch
    // the cases already sitting in the table — stamping those would light up
    // every historic file at once the first time the sweeper looked.
    const caseIdForClock = letter.caseId || letter.case_id || null;
    if (caseIdForClock && db?.query) {
      await db.query(
        `UPDATE dispute_cases
            SET response_due_at = now() + interval '30 days',
                status = 'awaiting_response',
                updated_at = now()
          WHERE id = $1::uuid
            AND org_id = $2::uuid
            AND response_due_at IS NULL`,
        [caseIdForClock, orgId]
      ).catch(() => {});
    }
    // A complaint that had no row yet gets one now — AFTER the provider took it,
    // never before. This row is what Round 6 reads to decide whether it may say a
    // complaint was filed, so it must mean "mailed" and nothing weaker.
    let filingRecorded = null;
    if (!letterId && isComplaintTarget(routing.target)) {
      const rec = await recordComplaintFiling(db, {
        caseId: letter.caseId || letter.case_id || null,
        orgId,
        clientId,
        bureau,
        round: letter.round,
        target: routing.target,
        bodyText: letter.bodyText || letter.body_text || null,
        providerId
      });
      filingRecorded = rec.ok ? true : rec.reason;
    }
    results.push({
      bureau,
      target: routing.target,
      ok: true,
      providerId,
      outcome: sent?.outcome || "sent",
      letterId,
      ...(filingRecorded === null ? {} : { filingRecorded })
    });
  }

  const anyOk = results.some((r) => r.ok);
  if (anyOk) {
    await onRepairEvent(db, {
      name: "repair.letters.sent",
      orgId,
      clientId,
      payload: {
        staffId,
        results,
        source: "staff_repair_send"
      }
    });
  }

  return { ok: anyOk, results };
}
