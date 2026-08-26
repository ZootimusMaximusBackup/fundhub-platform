// POST /api/public/partner-apply — website form creates a real login.
//
// The affiliates page used to show "Application received" without writing
// anything. This door creates the affiliate or white-label row, a password
// login, and the personal URL. The first password is returned once. Affiliate
// apply also queues catalog AF1. White-label has no drip templates.

import crypto from "node:crypto";
import { db, pool } from "../../src/db.mjs";
import { createAccount } from "../../src/auth/account-session.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { queueAffiliateTemplate } from "../../src/affiliates/drip.mjs";
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

    const existing = (await client.query(
      `SELECT id FROM accounts WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
      [orgId, parsed.email]
    )).rows[0];
    if (existing) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        status: 409,
        error: "already_registered",
        login_url: `${APP_ORIGIN}/login.html`
      };
    }

    const display = parsed.company || parsed.name;
    let trackingId = null;
    let affiliateId = null;
    let partnerId = null;
    let sitePath = null;
    let referralUrl = null;

    if (parsed.kind === "affiliate") {
      const row = (await client.query(
        `INSERT INTO affiliates (org_id, name, status)
         VALUES ($1, $2, 'active')
         RETURNING id, tracking_id`,
        [orgId, parsed.name]
      )).rows[0];
      affiliateId = row.id;
      trackingId = row.tracking_id;
      referralUrl = `${APP_ORIGIN}/start?ref=${encodeURIComponent(trackingId)}`;
      await create(client, {
        orgId,
        kind: "affiliate",
        email: parsed.email,
        name: parsed.name,
        password,
        affiliateId
      });
      try {
        await queueDrip(client, {
          orgId,
          email: parsed.email,
          name: parsed.name,
          trackingId,
          eventId: affiliateId
        });
      } catch { /* apply still commits; sweeper backfills plus-tag sims */ }
    } else {
      const invitedBy = await inviterId(client, orgId);
      if (!invitedBy) {
        await client.query("ROLLBACK");
        return { ok: false, status: 503, error: "invite_unavailable" };
      }
      const slug = await uniqueSlug(client, orgId, slugFromName(display));
      const note = [
        `phone=${parsed.phone}`,
        `audience=${parsed.audience}`,
        `sms_consent=${parsed.sms_consent}`
      ].join("\n");
      const row = (await client.query(
        `INSERT INTO partners (org_id, name, brand_name, slug, status, contact_email, notes)
         VALUES ($1, $2, $3, $4, 'active', $5, $6)
         RETURNING id, slug`,
        [orgId, display, display, slug, parsed.email, note]
      )).rows[0];
      partnerId = row.id;
      await create(client, {
        orgId,
        kind: "partner",
        email: parsed.email,
        name: parsed.name,
        password,
        partnerId,
        invitedBy
      });
      await client.query(
        `INSERT INTO partner_brand (org_id, partner_id, entity_name, support_email, selected_funnels)
         VALUES ($1, $2, $3, $4, '["apply"]'::jsonb)
         ON CONFLICT (partner_id) DO NOTHING`,
        [orgId, partnerId, display, parsed.email]
      ).catch(() => null);
      const body = defaultApplyBody(display);
      body.sections[1].href = `${APPLY_ORIGIN}/?a1=${encodeURIComponent(slug)}`;
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
      sitePath = `/sites/${partnerId}/apply`;
    }

    await client.query("COMMIT");
    return {
      ok: true,
      kind: parsed.kind,
      email: parsed.email,
      password,
      login_url: `${APP_ORIGIN}/login.html`,
      referral_url: referralUrl,
      tracking_id: trackingId,
      site_url: sitePath ? `${APP_ORIGIN}${sitePath}` : null,
      site_path: sitePath,
      partner_id: partnerId,
      affiliate_id: affiliateId
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
