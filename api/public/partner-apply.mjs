// POST /api/public/partner-apply — the website form.
//
// TWO DIFFERENT DOORS BEHIND ONE FORM, and they are not the same shape.
//
//   affiliate    — self-signup. account_signup_policy says so (044_accounts.sql).
//                  Row, login and referral link are created on submit, and the
//                  first password comes back once. Unchanged.
//
//   white-label  — INVITE ONLY. account_signup_policy says so, public/affiliates
//                  promises "application, review call, and a signed partner
//                  agreement before launch", and this endpoint used to ignore
//                  both: it wrote status 'active', minted a login, wrote a
//                  partner_brand row and PUBLISHED a page at /sites/{id} for
//                  anyone who filled in a name, an email and one sentence.
//                  (docs/specs/W5-offer-page-funnel.md, finding F1.)
//
//                  Now an application writes ONE row — partners at status
//                  'invited', which 042_partners.sql defines as "record exists,
//                  cannot sign in, cannot be paid" — and a card on the R-08 rail
//                  at the matching 'invited' stage. No login, no brand row, no
//                  page. approvePartnerApplication() below does all of that, and
//                  a human calls it after the review call.
//
// AN EXISTING CUSTOMER MAY APPLY. This used to answer 409 already_registered to
// any address that had an accounts row, which refused the exact warm buyer the
// funnel exists to promote, and told any stranger which email addresses have a
// Fundhub login (W5 finding F2). The 409 is gone. Nothing is created twice: a
// repeat white-label application returns the application already on file, and an
// affiliate who already has a login keeps it rather than getting a second one.
//
// THE PAYOUT GATE IS UNTOUCHED. 042_partners.sql refuses any payout while
// agreement_signed_at is NULL or status is not 'active'. Approval sets status;
// it does not stamp the agreement. Signing is still a separate, human event.

import crypto from "node:crypto";
import { db, pool } from "../../src/db.mjs";
import { createAccount } from "../../src/auth/account-session.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { queueAffiliateTemplate } from "../../src/affiliates/drip.mjs";
import { queuePartnerWelcome } from "../../src/partners/welcome.mjs";
import { safeError } from "../../src/http/health.mjs";

const APP_ORIGIN = "https://fundhub.ai";
const APPLY_ORIGIN = "https://apply.fundhub.ai";

const TRACKS = {
  affiliate: "affiliate",
  white_label: "partner",
  "white-label": "partner",
  partner: "partner",
  wl: "partner"
};

function readBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body || "{}"); } catch { return null; }
  }
  if (typeof req.rawBody === "string") {
    try { return JSON.parse(req.rawBody || "{}"); } catch { return null; }
  }
  return null;
}

function cleanStr(v, max = 200) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function tenDigits(phone) {
  let digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
  return digits.length === 10 ? digits : "";
}

export function slugFromName(name) {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "partner";
}

export function generateFirstPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

export async function placeWhiteLabelRailCard(qx, { orgId, partnerId, stageKey = "active" } = {}) {
  if (!qx || !orgId || !partnerId) return { placed: false, reason: "missing_args" };
  const stage = await qx.query(
    `SELECT ps.id AS stage_id, ps.pipeline_id
       FROM pipeline_stages ps
       JOIN pipelines p ON p.id = ps.pipeline_id
      WHERE p.key = 'affiliates_white_label'
        AND ps.key = $1
        AND p.org_id = $2
        AND ps.org_id = $2
      LIMIT 1`,
    [stageKey, orgId]
  );
  const row = stage.rows[0];
  if (!row) return { placed: false, reason: "stage_not_found" };

  const existing = await qx.query(
    `SELECT id FROM cards WHERE partner_id = $1 AND pipeline_id = $2 LIMIT 1`,
    [partnerId, row.pipeline_id]
  );
  if (existing.rows[0]) {
    await qx.query(`UPDATE cards SET stage_id = $2 WHERE id = $1`, [
      existing.rows[0].id,
      row.stage_id
    ]);
    return { placed: true, created: false, cardId: existing.rows[0].id };
  }

  const ins = await qx.query(
    `INSERT INTO cards (org_id, partner_id, pipeline_id, stage_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [orgId, partnerId, row.pipeline_id, row.stage_id]
  );
  return { placed: true, created: true, cardId: ins.rows[0]?.id || null };
}

export function parsePartnerApplyBody(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };

  const name = cleanStr(body.name || body.full_name, 120);
  const email = cleanStr(body.email, 160).toLowerCase();
  const phone = cleanStr(body.phone || body.mobile, 40);
  const company = cleanStr(body.company || body.business, 160);
  const audience = cleanStr(body.audience || body.how_refer, 400);
  const trackRaw = cleanStr(body.track, 40).toLowerCase().replace(/\s+/g, "_");
  const kind = TRACKS[trackRaw] || null;
  const sms = !!body.sms_consent;

  if (!name || !isEmail(email)) {
    return { ok: false, error: "name_email_required" };
  }
  if (!kind) return { ok: false, error: "track_required" };
  if (!audience) return { ok: false, error: "audience_required" };

  return {
    ok: true,
    name,
    email,
    phone: tenDigits(phone),
    company,
    audience,
    kind,
    sms_consent: sms
  };
}

async function uniqueSlug(client, orgId, base) {
  let slug = base;
  for (let n = 2; n < 50; n++) {
    const hit = (await client.query(
      `SELECT 1 FROM partners WHERE org_id = $1 AND slug = $2 LIMIT 1`,
      [orgId, slug]
    )).rows[0];
    if (!hit) return slug;
    slug = `${base}-${n}`.slice(0, 60);
  }
  return `${base}-${Date.now().toString(36)}`.slice(0, 60);
}

async function inviterId(client, orgId) {
  const chris = (await client.query(
    `SELECT id FROM staff
      WHERE org_id = $1 AND lower(email) = 'chris@fundhub.ai'
      LIMIT 1`,
    [orgId]
  )).rows[0];
  if (chris) return chris.id;
  const owner = (await client.query(
    `SELECT id FROM staff
      WHERE org_id = $1 AND role = 'owner' AND status = 'active'
      ORDER BY created_at ASC LIMIT 1`,
    [orgId]
  )).rows[0];
  return owner?.id || null;
}

function defaultApplyBody(displayName) {
  return {
    template: "apply",
    sections: [
      { type: "hero", headline: displayName, sub: "Apply for funding through this partner." },
      { type: "cta", label: "Start", href: `${APPLY_ORIGIN}/?a1=` }
    ]
  };
}

/* The one lookup that used to power the 409. It is still needed — not to refuse
   anybody, but because accounts_email_uniq allows exactly one login per address
   per org, so a second one must never be attempted. */
async function accountFor(client, orgId, email) {
  return (await client.query(
    `SELECT id, kind, affiliate_id, partner_id
       FROM accounts WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  )).rows[0] || null;
}

async function applyAsAffiliate(client, parsed, { orgId, account, create, queueDrip, password }) {
  let affiliateId = null;
  let trackingId = null;

  /* Already an affiliate? Reuse the row. Two affiliate rows for one person
     would split their attribution and their balance in half. */
  if (account && account.kind === "affiliate" && account.affiliate_id) {
    const known = (await client.query(
      `SELECT id, tracking_id FROM affiliates WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [account.affiliate_id, orgId]
    )).rows[0];
    if (known) {
      affiliateId = known.id;
      trackingId = known.tracking_id;
    }
  }

  if (!affiliateId) {
    const row = (await client.query(
      `INSERT INTO affiliates (org_id, name, status)
       VALUES ($1, $2, 'active')
       RETURNING id, tracking_id`,
      [orgId, parsed.name]
    )).rows[0];
    affiliateId = row.id;
    trackingId = row.tracking_id;
  }

  /* No login when the address already has one. It may belong to a client
     account they opened when they bought something — one email, one login. */
  let accountCreated = false;
  if (!account) {
    await create(client, {
      orgId,
      kind: "affiliate",
      email: parsed.email,
      name: parsed.name,
      password,
      affiliateId
    });
    accountCreated = true;
  }

  try {
    await queueDrip(client, {
      orgId,
      email: parsed.email,
      name: parsed.name,
      trackingId,
      eventId: affiliateId
    });
  } catch { /* apply still commits; sweeper backfills plus-tag sims */ }

  return {
    affiliateId,
    trackingId,
    accountCreated,
    referralUrl: `${APP_ORIGIN}/start?ref=${encodeURIComponent(trackingId)}`
  };
}

async function applyAsPartner(client, parsed, { orgId }) {
  const display = parsed.company || parsed.name;

  /* A second submit from the same address is the same application, not a second
     partner. Answering it identically also keeps the form from telling a
     stranger who has already applied. */
  const prior = (await client.query(
    `SELECT id, status
       FROM partners
      WHERE org_id = $1 AND lower(contact_email) = $2
      ORDER BY created_at ASC
      LIMIT 1`,
    [orgId, parsed.email]
  )).rows[0];

  if (prior) {
    return { partnerId: prior.id, status: prior.status };
  }

  const slug = await uniqueSlug(client, orgId, slugFromName(display));
  const note = [
    `contact=${parsed.name}`,
    `phone=${parsed.phone}`,
    `audience=${parsed.audience}`,
    `sms_consent=${parsed.sms_consent}`
  ].join("\n");

  /* 'invited', not 'active'. 042_partners.sql: "record exists, cannot sign in,
     cannot be paid." That is exactly what an applicant is. */
  const row = (await client.query(
    `INSERT INTO partners (org_id, name, brand_name, slug, status, contact_email, notes)
     VALUES ($1, $2, $3, $4, 'invited', $5, $6)
     RETURNING id, slug`,
    [orgId, display, display, slug, parsed.email, note]
  )).rows[0];

  return { partnerId: row.id, status: "invited" };
}

export async function runPartnerApply(parsed, deps = {}) {
  const database = deps.db || db;
  const create = deps.createAccount || createAccount;
  const queueDrip = deps.queueAffiliateTemplate || queueAffiliateTemplate;
  const resolveOrg = deps.resolveDefaultOrg || resolveDefaultOrg;
  const password = deps.password || generateFirstPassword();
  const connect = deps.connect || (() => pool().connect());

  const orgId = await resolveOrg(database);
  const client = await connect();
  try {
    await client.query("BEGIN");

    const account = await accountFor(client, orgId, parsed.email);

    if (parsed.kind === "affiliate") {
      const out = await applyAsAffiliate(client, parsed, {
        orgId, account, create, queueDrip, password
      });
      await client.query("COMMIT");
      return {
        ok: true,
        kind: "affiliate",
        status: "active",
        email: parsed.email,
        // Only ever set when this request minted the login. An address that
        // already had one signs in with the password it already has.
        password: out.accountCreated ? password : null,
        login_url: `${APP_ORIGIN}/login.html`,
        referral_url: out.referralUrl,
        tracking_id: out.trackingId,
        site_url: null,
        site_path: null,
        partner_id: null,
        affiliate_id: out.affiliateId
      };
    }

    const out = await applyAsPartner(client, parsed, { orgId });
    /* Board the card at 'invited' to match the row. An already-approved partner
       who fills the form in again is left where they are. */
    if (out.status === "invited") {
      await placeWhiteLabelRailCard(client, { orgId, partnerId: out.partnerId, stageKey: "invited" });
    }
    await client.query("COMMIT");

    /* Nothing is mailed here. db/seed/022_partner_welcome.sql says "You are
       approved… sign in here", which is not true of an applicant and points at a
       login that does not exist yet. That mail belongs to approval. */
    return {
      ok: true,
      kind: "partner",
      status: "pending_review",
      email: parsed.email,
      password: null,
      login_url: null,
      referral_url: null,
      tracking_id: null,
      site_url: null,
      site_path: null,
      partner_id: out.partnerId,
      affiliate_id: null
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* already closed */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * approvePartnerApplication — the human step the application now waits for.
 *
 * Everything runPartnerApply used to do the instant a stranger hit submit:
 * the login, the partner_brand row, the published page at /sites/{id}, the
 * 'active' status and the rail card. It is deliberately one function so the
 * provisioning lives in one place rather than being rewritten by whoever wires
 * the admin screen.
 *
 * NOT ROUTED YET. There is no /api handler calling this — the admin endpoint is
 * outside this unit. Until it exists, approval is a manual database step.
 *
 * It does NOT stamp agreement_signed_at. 042_partners.sql blocks every payout
 * until that column is set AND status is 'active'; approval only supplies the
 * second half, so signing stays a separate, deliberate act.
 */
export async function approvePartnerApplication(input = {}, deps = {}) {
  const database = deps.db || db;
  const create = deps.createAccount || createAccount;
  const queueWelcome = deps.queuePartnerWelcome || queuePartnerWelcome;
  const resolveOrg = deps.resolveDefaultOrg || resolveDefaultOrg;
  const password = deps.password || generateFirstPassword();
  const connect = deps.connect || (() => pool().connect());

  const partnerId = input.partnerId || null;
  if (!partnerId) return { ok: false, status: 400, error: "partner_id_required" };

  const orgId = input.orgId || (await resolveOrg(database));
  const client = await connect();
  try {
    await client.query("BEGIN");

    const partner = (await client.query(
      `SELECT id, name, brand_name, slug, status, contact_email
         FROM partners WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [partnerId, orgId]
    )).rows[0];
    if (!partner) {
      await client.query("ROLLBACK");
      return { ok: false, status: 404, error: "partner_not_found" };
    }
    if (partner.status === "paused") {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "partner_paused" };
    }

    const email = String(partner.contact_email || "").trim().toLowerCase();
    if (!email) {
      await client.query("ROLLBACK");
      return { ok: false, status: 409, error: "partner_has_no_contact_email" };
    }

    const invitedBy = input.approvedBy || (await inviterId(client, orgId));
    if (!invitedBy) {
      await client.query("ROLLBACK");
      return { ok: false, status: 503, error: "invite_unavailable" };
    }

    /* One login per address per org (accounts_email_uniq), and the subject
       check in 044_accounts.sql forbids one row being a client AND a partner.
       So a warm buyer who already has a client login cannot be handed a partner
       login here. Approve them anyway and say so, rather than failing. */
    const existingAccount = await accountFor(client, orgId, email);
    let accountCreated = false;
    let loginBlocked = null;
    if (!existingAccount) {
      await create(client, {
        orgId,
        kind: "partner",
        email,
        name: partner.name,
        password,
        partnerId,
        invitedBy
      });
      accountCreated = true;
    } else if (existingAccount.partner_id !== partnerId) {
      loginBlocked = "email_already_has_an_account";
    }

    const display = partner.brand_name || partner.name;
    await client.query(
      `INSERT INTO partner_brand (org_id, partner_id, entity_name, support_email, selected_funnels)
       VALUES ($1, $2, $3, $4, '["apply"]'::jsonb)
       ON CONFLICT (partner_id) DO NOTHING`,
      [orgId, partnerId, display, email]
    ).catch(() => null);

    const body = defaultApplyBody(display);
    body.sections[1].href = `${APPLY_ORIGIN}/?a1=${encodeURIComponent(partner.slug)}`;
    await client.query(
      `INSERT INTO partner_pages
         (org_id, partner_id, funnel_key, title, slug, status, body_json, published_at)
       VALUES ($1, $2, 'apply', $3, 'apply', 'published', $4::jsonb, now())
       ON CONFLICT (partner_id, slug) DO UPDATE SET
         status = 'published',
         published_at = COALESCE(partner_pages.published_at, now()),
         updated_at = now()`,
      [orgId, partnerId, `${display} apply`, JSON.stringify(body)]
    );

    await client.query(
      `UPDATE partners SET status = 'active', updated_at = now()
        WHERE id = $1 AND org_id = $2`,
      [partnerId, orgId]
    );
    await placeWhiteLabelRailCard(client, { orgId, partnerId, stageKey: "active" });

    await client.query("COMMIT");

    const sitePath = `/sites/${partnerId}/apply`;
    await queueWelcome(database, {
      orgId,
      partnerId,
      email,
      phone: input.phone || null,
      name: partner.name,
      brand: display,
      kind: "partner",
      loginUrl: `${APP_ORIGIN}/login.html`,
      siteUrl: `${APP_ORIGIN}${sitePath}`,
      smsConsent: !!input.smsConsent
    });

    return {
      ok: true,
      partner_id: partnerId,
      email,
      status: "active",
      password: accountCreated ? password : null,
      login_blocked: loginBlocked,
      login_url: `${APP_ORIGIN}/login.html`,
      site_url: `${APP_ORIGIN}${sitePath}`,
      site_path: sitePath,
      // Unchanged by approval. 042_partners.sql still refuses every payout.
      agreement_signed: false
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* already closed */ }
    throw err;
  } finally {
    client.release();
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const parsed = parsePartnerApplyBody(readBody(req));
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  try {
    const result = await runPartnerApply(parsed);
    if (!result.ok) {
      return res.status(result.status || 400).json({
        ok: false,
        error: result.error,
        login_url: result.login_url || undefined
      });
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
