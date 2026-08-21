// Human send gate for repair DIY + DFY bureau + furnisher letters.
// Staff must press send (mail: true). Never call from payment.received / ds-02.

import { mailBureauLetter } from "../metro2/delivery/send.mjs";
import { findFurnisherAddress } from "../metro2/rounds/store.mjs";
import { onRepairEvent } from "./handlers.mjs";

export class RepairSendError extends Error {
  constructor(message, { status = 400, code = "repair_send" } = {}) {
    super(message);
    this.name = "RepairSendError";
    this.status = status;
    this.code = code;
  }
}

async function resolveLetterRouting(db, letter, { orgId }) {
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

  return { target, furnisherAddressId, furnisherName, to };
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

    const routing = await resolveLetterRouting(db, letter, { orgId });
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
        bureau: routing.target === "furnisher" ? null : bureau,
        furnisherName: routing.target === "furnisher" ? routing.furnisherName : null,
        to: routing.to,
        identity,
        from,
        pdf: letter.pdf || letter.pdfBase64,
        html: letter.html,
        description: letter.description
          || (routing.target === "furnisher"
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
    results.push({
      bureau,
      target: routing.target,
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
