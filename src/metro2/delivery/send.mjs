// Dispute letter delivery via existing PostGrid mail-letter provider.

import { sendLetter, bureauMailAddress } from "../../messaging/providers/mail-letter.mjs";
import { findFurnisherAddress } from "../rounds/store.mjs";

function clientReturnAddress(identity) {
  if (!identity?.addressLine1 && !identity?.address_line1) return null;
  return {
    first_name: identity.firstName || identity.first_name || (identity.fullName || "").split(/\s+/)[0],
    last_name: identity.lastName || identity.last_name || (identity.fullName || "").split(/\s+/).slice(1).join(" "),
    address_line1: identity.addressLine1 || identity.address_line1,
    address_line2: identity.addressLine2 || identity.address_line2 || null,
    address_city: identity.city || identity.address_city,
    address_state: identity.state || identity.address_state,
    address_zip: identity.zip || identity.address_zip,
    address_country: identity.country || "US"
  };
}

/**
 * Mail a generated letter PDF to a bureau or furnisher.
 * Return address MUST be the consumer's — never Fundhub.
 */
export async function deliverDisputeLetter({
  db,
  bureau,
  furnisherName,
  identity,
  pdfBase64,
  description,
  metadata,
  env,
  fetchImpl
}) {
  const from = clientReturnAddress(identity);
  if (!from) {
    return { ok: false, error: "return_address_required — consumer address only" };
  }
  let to = null;
  if (bureau) to = bureauMailAddress(bureau);
  else if (furnisherName && db) {
    const row = await findFurnisherAddress(db, furnisherName, metadata?.orgId || null);
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
  if (!to) return { ok: false, error: "destination_address_missing" };

  return sendLetter({
    to,
    bureau,
    from,
    pdf: pdfBase64,
    description: description || "Metro 2 dispute letter",
    metadata,
    env,
    fetchImpl
  });
}
