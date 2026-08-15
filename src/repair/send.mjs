// Human send gate for repair DIY + DFY bureau letters.
// Staff must press send (mail: true). Never call from payment.received / ds-02.

import { mailBureauLetter } from "../metro2/delivery/send.mjs";
import { onRepairEvent } from "./handlers.mjs";

export class RepairSendError extends Error {
  constructor(message, { status = 400, code = "repair_send" } = {}) {
    super(message);
    this.name = "RepairSendError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Mail repair-stack letters (dispute + personal_info) via the shared PostGrid helper.
 *
 * @param {object} db
 * @param {{
 *   orgId: string,
 *   clientId: string,
 *   staffId: string,
 *   mail?: boolean,
 *   letters?: Array<{ bureau: string, pdf?: string, html?: string, letterId?: string, description?: string }>,
 *   identity?: object,
 *   from?: object,
 *   mailSender?: Function,
 *   env?: object,
 *   fetchImpl?: typeof fetch
 * }} opts
 */
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
    let sent;
    if (typeof mailSender === "function") {
      sent = await mailSender({
        ...letter,
        bureau,
        identity,
        from,
        orgId,
        clientId
      });
    } else {
      sent = await mailBureauLetter({
        bureau,
        identity,
        from,
        pdf: letter.pdf || letter.pdfBase64,
        html: letter.html,
        description: letter.description || `Repair letter ${bureau}`,
        metadata: {
          orgId,
          clientId,
          staffId,
          letterId: letter.letterId || letter.letter_id || null,
          stack: "repair"
        },
        env,
        fetchImpl
      });
    }

    if (sent?.ok === false || (sent && sent.ok !== true && sent.providerId == null && sent.outcome?.startsWith?.("mail_failed"))) {
      const err = sent?.error || sent?.outcome || "mail_failed";
      results.push({ bureau, ok: false, error: err });
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
    results.push({
      bureau,
      ok: true,
      providerId,
      outcome: sent?.outcome || "sent",
      letterId
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
