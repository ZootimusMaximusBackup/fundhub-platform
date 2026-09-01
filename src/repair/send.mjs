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
      results.push({ bureau, target: routing.target, ok: false, error: err });
      continue;
    }

    const providerId = sent?.providerId || sent?.id || null;
    const letterId = letter.letterId || letter.letter_id || null;
    if (letterId && providerId && db?.query) {
      await db.query(
        `UPDATE dispute_letters
            SET status = 'sent', postgrid_letter_id = $2
          WHERE id = $1::uuid AND org_id = $3::uuid AND client_id = $4::uuid`,
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
