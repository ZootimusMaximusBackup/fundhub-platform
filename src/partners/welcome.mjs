// src/partners/welcome.mjs — the new partner actually hears from us.
//
// api/public/partner-apply.mjs created the row, the login and the page, then
// returned "you are in" and sent nothing. Gmail and `messages` were both empty
// for every partner who ever applied.
//
// NOTHING HERE TRANSMITS. It renders an editable template, writes `messages`
// rows and asks src/messaging/outbox.mjs to drain. Outbound fetch lives in
// src/messaging/providers/* and nowhere else (CLAUDE.md §12).
//
// The password is never in the copy — it is shown once on the apply screen.

import { renderTemplate } from "../lib/render-template.mjs";
import { drain } from "../messaging/outbox.mjs";

export const PARTNER_WELCOME_EMAIL_KEY = "EMAIL-PARTNER-WELCOME";
export const PARTNER_WELCOME_SMS_KEY = "SMS-PARTNER-WELCOME";

function firstName(name) {
  const first = String(name || "").trim().split(/\s+/)[0];
  return first || "there";
}

function e164(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return "";
}

export function partnerWelcomeContext({
  name, brand, kind, loginUrl, siteUrl
} = {}) {
  return {
    partner: {
      first_name: firstName(name),
      name: String(name || "").trim(),
      brand: String(brand || name || "your brand").trim(),
      kind_label: kind === "affiliate" ? "affiliate" : "white-label",
      login_url: loginUrl || "https://fundhub.ai/login.html",
      site_url: siteUrl || "https://fundhub.ai/login.html"
    }
  };
}

async function templateFor(db, orgId, key) {
  const row = (await db.query(
    `SELECT template_key, subject, body, compliance_passed
       FROM message_templates WHERE org_id = $1::uuid AND template_key = $2 LIMIT 1`,
    [orgId, key]
  )).rows[0];
  if (!row || !row.compliance_passed) return null;
  return row;
}

/**
 * queuePartnerWelcome — welcome email, plus a text when they ticked the box.
 *
 * NEVER THROWS. A partner account is a real record and must not fail to exist
 * because a mailbox was down.
 *
 * IDEMPOTENT via provider_ref `partner:<id>:welcome:<channel>` and migration
 * 004's unique index on (org_id, provider_ref) — a second apply cannot mail
 * the same partner twice.
 */
export async function queuePartnerWelcome(db, {
  orgId, partnerId, affiliateId, email, phone, name, brand, kind,
  loginUrl, siteUrl, smsConsent = false, now = null
} = {}) {
  const subjectId = partnerId || affiliateId;
  if (!orgId || !subjectId || !email) {
    return { ok: false, reason: "missing_ids", queued: 0 };
  }
  try {
    const context = partnerWelcomeContext({ name, brand, kind, loginUrl, siteUrl });
    let queued = 0;

    const emailTpl = await templateFor(db, orgId, PARTNER_WELCOME_EMAIL_KEY);
    if (emailTpl) {
      const ins = await db.query(
        `INSERT INTO messages
           (org_id, client_id, direction, channel, template_key, rendered_body,
            provider, provider_ref, status, compliance_check_passed, to_address, subject)
         VALUES ($1,$2,'outbound','email',$3,$4,NULL,$5,'queued',true,$6,$7)
         ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
         RETURNING id`,
        [orgId, null, emailTpl.template_key, renderTemplate(emailTpl.body, context),
         `partner:${subjectId}:welcome:email`, email,
         emailTpl.subject ? renderTemplate(emailTpl.subject, context) : null]
      );
      if (ins.rows[0]) queued += 1;
    }

    const to = smsConsent ? e164(phone) : "";
    if (to) {
      const smsTpl = await templateFor(db, orgId, PARTNER_WELCOME_SMS_KEY);
      if (smsTpl) {
        const ins = await db.query(
          `INSERT INTO messages
             (org_id, client_id, direction, channel, template_key, rendered_body,
              provider, provider_ref, status, compliance_check_passed, to_address)
           VALUES ($1,$2,'outbound','sms',$3,$4,NULL,$5,'queued',true,$6)
           ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
           RETURNING id`,
          [orgId, null, smsTpl.template_key, renderTemplate(smsTpl.body, context),
           `partner:${subjectId}:welcome:sms`, to]
        );
        if (ins.rows[0]) queued += 1;
      }
    }

    if (queued === 0) return { ok: false, reason: "nothing_to_send", queued: 0 };
    const delivery = await drain(db, { orgId, now });
    return { ok: true, reason: null, queued, delivery };
  } catch (err) {
    console.warn(`[partners] could not welcome partner ${subjectId}: ${err.message}`);
    return { ok: false, reason: "error", error: err.message, queued: 0 };
  }
}
