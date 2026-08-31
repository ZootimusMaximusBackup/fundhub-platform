// Day 0. Everything the $297 buys, created in one transaction.
//
// FOUR ROWS AND A LOGIN, and the order they are created in is not arbitrary:
//
//   partners        status 'invited', revenue_share_pct 50, agreement_signed_at
//                   NULL. 042_partners.sql's payout trigger refuses every payout
//                   while that column is NULL and the status is not 'active', so
//                   an unsigned trial partner is STRUCTURALLY UNPAYABLE. That is
//                   why it is safe to create this row on day 0 rather than day 8.
//   affiliates      created NOW, not on day 8. See src/trials/attribution.mjs —
//                   attribute() is first-writer-wins and there is no undo.
//   accounts        their login, through createAccount().
//   partner_brand   status 'draft'. The brand intake is four fields and it is
//                   theirs to fill in; 043 validates the two colours as hex.
//   live_trials     the trial itself, clock NOT started.
//
// THE CLOCK IS NOT STARTED HERE. started_at stays NULL until the first ad
// impression is synced. A trial provisioned on Friday whose ads clear review on
// Monday gets seven days from Monday. See src/trials/clock.mjs.
//
// THE PAGE IS CREATED BUT NOT PUBLISHED. Publishing is gated on the named human
// approval at H+2:00 (W4 §9.2) and on the brand row reaching 'approved'.
// publishTrialFunnel() below is the only path that flips it, and it refuses
// unless both are true AND the locked fulfilment disclosure is present.
//
// THIS IS NOT A SECOND BRANDING PATH. The page body comes from defaultBody() in
// src/brand/templates.mjs — the same Brand Studio templates every partner gets —
// with the trial's affiliate tracking id stamped onto every link. No trial-only
// template, no trial-only legal block, no second copy of the disclosure.
//
// MODELLED ON api/public/partner-apply.mjs, WHICH IS NOT MODIFIED. That handler
// owns the white-label application track and does this same sequence for it;
// this module does the trial's version of it and leaves that file alone.

import crypto from "node:crypto";
import { db as defaultDb, pool as defaultPool } from "../db.mjs";
import { createAccount } from "../auth/account-session.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { defaultBody } from "../brand/templates.mjs";
import { assertFulfilmentDisclosure, withFulfilmentDisclosure } from "./disclosure.mjs";
import { tagPageBody } from "./attribution.mjs";
import { decideEligibility, DECISION } from "./eligibility.mjs";
import { createTrial, recordTrialEvent } from "./store.mjs";
import { LIVE_TRIAL_PRICE_CENTS, TRIAL_STATUS } from "./constants.mjs";

const APP_ORIGIN = "https://fundhub.ai";

/** The funnel the trial runs. `apply` is the funding application funnel — the
    trial is funding only in version one, never credit repair. */
export const TRIAL_FUNNEL_KEY = "apply";
export const TRIAL_FUNNEL_SLUG = "apply";

function cleanStr(v, max = 200) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function generateFirstPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

export function slugFromName(name) {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "trial";
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

/* createAccount refuses to mint a partner login without an inviter, because
   044_accounts.sql's signup policy makes the white-label track invite-only. A
   trial buyer HAS paid, so the invite is real — it is just being issued by the
   system rather than typed by a person. The owner is the issuer of record. */
async function inviterId(client, orgId) {
  const owner = (await client.query(
    `SELECT id FROM staff
      WHERE org_id = $1 AND role = 'owner' AND status = 'active'
      ORDER BY created_at ASC LIMIT 1`,
    [orgId]
  )).rows[0];
  return owner?.id || null;
}

async function accountFor(client, orgId, email) {
  return (await client.query(
    `SELECT id, kind, affiliate_id, partner_id
       FROM accounts WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, email]
  )).rows[0] || null;
}

/**
 * parseTrialSignup(body) → { ok, ... } | { ok:false, error }
 *
 * The eligibility answers are REQUIRED, not optional. A trial sold without them
 * is a trial sold to somebody who was never asked whether Meta will run their
 * ads, and that is the failure the gate exists to prevent.
 */
export function parseTrialSignup(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_json" };

  const name = cleanStr(body.name || body.full_name, 120);
  const email = cleanStr(body.email, 160).toLowerCase();
  const company = cleanStr(body.company || body.business, 160);
  const entityName = cleanStr(body.entity_name || company || name, 160);
  const supportEmail = cleanStr(body.support_email || email, 160).toLowerCase();

  if (!name || !isEmail(email)) return { ok: false, error: "name_email_required" };
  if (supportEmail && !isEmail(supportEmail)) return { ok: false, error: "support_email_invalid" };

  const answers = body.eligibility && typeof body.eligibility === "object" ? body.eligibility : body;
  const decision = decideEligibility(answers);

  return {
    ok: true,
    name,
    email,
    company,
    entityName: entityName || name,
    supportEmail: supportEmail || email,
    decision
  };
}

/**
 * provisionLiveTrial(input, deps) → the day-0 result.
 *
 * Refuses outright when the gate says hold the sale. There is no "provision it
 * anyway and sort the ad account out later" path, because that path is exactly
 * how FundHub ends up having sold seven days it cannot deliver.
 */
export async function provisionLiveTrial(input = {}, deps = {}) {
  const database = deps.db || defaultDb;
  const create = deps.createAccount || createAccount;
  const resolveOrg = deps.resolveDefaultOrg || resolveDefaultOrg;
  const password = deps.password || generateFirstPassword();
  const connect = deps.connect || (() => defaultPool().connect());
  const now = deps.now || new Date();
  const priceCents = Number.isInteger(deps.priceCents) ? deps.priceCents : LIVE_TRIAL_PRICE_CENTS;

  const parsed = input.ok ? input : parseTrialSignup(input);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  const decision = parsed.decision;
  if (!decision || decision.decision === DECISION.HOLD_SALE) {
    return {
      ok: false,
      status: 409,
      error: "not_eligible",
      decision: decision || null
    };
  }

  const heldStart = decision.decision === DECISION.HELD_START;
  const orgId = input.orgId || (await resolveOrg(database));
  const client = await connect();

  try {
    await client.query("BEGIN");

    const display = parsed.company || parsed.name;

    /* A second checkout webhook for the same buyer is the same trial. The
       unique index on live_trials.partner_id makes that structural; finding the
       partner first makes it quiet rather than an error. */
    let partner = (await client.query(
      `SELECT id, slug, status FROM partners
        WHERE org_id = $1 AND lower(contact_email) = $2
        ORDER BY created_at ASC LIMIT 1`,
      [orgId, parsed.email]
    )).rows[0] || null;

    if (!partner) {
      const slug = await uniqueSlug(client, orgId, slugFromName(display));
      partner = (await client.query(
        `INSERT INTO partners (org_id, name, brand_name, slug, status, revenue_share_pct, contact_email, notes)
         VALUES ($1,$2,$3,$4,'invited',50,$5,$6)
         RETURNING id, slug, status`,
        [orgId, display, display, slug, parsed.email, "live_trial"]
      )).rows[0];
    }

    /* THE AFFILIATE ROW, ON DAY 0. 033_affiliates.sql stamps the tracking id
       through trg_affiliates_tracking_id, so it is never generated in code. */
    const account = await accountFor(client, orgId, parsed.email);
    let affiliate = null;
    if (account && account.affiliate_id) {
      affiliate = (await client.query(
        `SELECT id, tracking_id FROM affiliates WHERE id = $1 AND org_id = $2 LIMIT 1`,
        [account.affiliate_id, orgId]
      )).rows[0] || null;
    }
    if (!affiliate) {
      affiliate = (await client.query(
        `INSERT INTO affiliates (org_id, name, status)
         VALUES ($1,$2,'active')
         RETURNING id, tracking_id`,
        [orgId, parsed.name]
      )).rows[0];
    }

    /* One login per address per org (accounts_email_uniq), and 044's subject
       check forbids one row being two kinds at once. A buyer who already has a
       login keeps it and is told so, rather than the whole provision failing. */
    let accountCreated = false;
    let loginBlocked = null;
    if (!account) {
      const invitedBy = await inviterId(client, orgId);
      if (!invitedBy) {
        await client.query("ROLLBACK");
        return { ok: false, status: 503, error: "invite_unavailable" };
      }
      await create(client, {
        orgId,
        kind: "partner",
        email: parsed.email,
        name: parsed.name,
        password,
        partnerId: partner.id,
        invitedBy
      });
      accountCreated = true;
    } else if (account.partner_id !== partner.id) {
      loginBlocked = "email_already_has_an_account";
    }

    /* Brand row in DRAFT. The four-field intake is theirs to fill in and takes
       about four minutes; 043 rejects anything that is not a hex colour. */
    await client.query(
      `INSERT INTO partner_brand (org_id, partner_id, entity_name, support_email, selected_funnels)
       VALUES ($1,$2,$3,$4,'["apply"]'::jsonb)
       ON CONFLICT (partner_id) DO NOTHING`,
      [orgId, partner.id, parsed.entityName, parsed.supportEmail]
    );

    /* The funnel page, built from the SHARED Brand Studio template, carrying the
       locked fulfilment disclosure and the trial's tracking id on every link.
       Created as a DRAFT — the human gate publishes it, not this function. */
    const body = trialPageBody({
      entityName: parsed.entityName,
      trackingId: affiliate.tracking_id
    });
    await client.query(
      `INSERT INTO partner_pages
         (org_id, partner_id, funnel_key, title, slug, status, body_json)
       VALUES ($1,$2,$3,$4,$5,'draft',$6::jsonb)
       ON CONFLICT (partner_id, slug) DO UPDATE SET
         body_json = EXCLUDED.body_json,
         updated_at = now()`,
      [orgId, partner.id, TRIAL_FUNNEL_KEY, `${parsed.entityName} apply`,
       TRIAL_FUNNEL_SLUG, JSON.stringify(body)]
    );

    const trial = await createTrial(client, {
      orgId,
      partnerId: partner.id,
      affiliateId: affiliate.id,
      contactEmail: parsed.email,
      status: heldStart ? TRIAL_STATUS.HELD_START : TRIAL_STATUS.PROVISIONED,
      priceCents,
      heldStart,
      eligibility: {
        decision: decision.decision,
        answers: decision.blockers && decision.blockers.length ? "incomplete" : "complete",
        asked_at: now instanceof Date ? now.toISOString() : String(now)
      },
      paidAt: input.paidAt || now,
      provisionedAt: now
    });

    await recordTrialEvent(client, {
      orgId,
      liveTrialId: trial.id,
      kind: "provisioned",
      detail: {
        held_start: heldStart,
        price_cents: priceCents,
        affiliate_tracking_id: affiliate.tracking_id,
        funnel: TRIAL_FUNNEL_KEY,
        // Named so the audit trail says out loud that the page is not live yet.
        page_status: "draft_awaiting_human_approval"
      }
    });

    await client.query("COMMIT");

    return {
      ok: true,
      status: 200,
      live_trial_id: trial.id,
      partner_id: partner.id,
      affiliate_id: affiliate.id,
      tracking_id: affiliate.tracking_id,
      held_start: heldStart,
      trial_status: trial.status,
      email: parsed.email,
      // Only ever set when THIS call minted the login.
      password: accountCreated ? password : null,
      login_blocked: loginBlocked,
      login_url: `${APP_ORIGIN}/login.html`,
      dashboard_url: `${APP_ORIGIN}/partner/trial/live/`,
      // The page is not live yet, so no site_url is handed back. Publishing is
      // the human gate's to do.
      site_path: null,
      // Unchanged by provisioning, and it must stay that way: 042's payout gate
      // is the reason a trial partner row is safe to create at all.
      agreement_signed: false,
      clock_started: false
    };
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* already closed */ }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * trialPageBody({ entityName, trackingId }) → the page body a trial publishes.
 *
 * Shared template, shared legal blocks, trial tracking id on every link. The
 * assert is not decoration: if the locked disclosure ever falls out of
 * legalBlocks(), this throws here rather than publishing a page that does not
 * tell consumers who performs the work.
 */
export function trialPageBody({ entityName, trackingId = null } = {}) {
  const name = String(entityName || "").trim() || "your brand";
  const base = defaultBody(TRIAL_FUNNEL_KEY, { entity_name: name });
  const withDisclosure = withFulfilmentDisclosure(base, name);
  const tagged = tagPageBody(withDisclosure, trackingId);
  // Re-check AFTER tagging: tagPageBody rewrites sections, and a rewrite that
  // dropped the disclosure must not reach a database.
  assertFulfilmentDisclosure(tagged, { entityName: name });
  return tagged;
}

/**
 * publishTrialFunnel(db, { orgId, partnerId }) → { published, reason }
 *
 * THE HUMAN GATE, ENFORCED. Three conditions, all of which already exist in the
 * schema, and none of which this function may skip:
 *
 *   1. partner_brand.approval_status = 'approved' (043 enforces that approved
 *      and approved_at are set together, so an approval always has a moment)
 *   2. the page body carries the locked fulfilment disclosure
 *   3. the page exists
 *
 * Returns a reason rather than throwing when a condition is unmet: "not
 * approved yet" is the normal state of a page an hour after provisioning, not
 * an error.
 */
export async function publishTrialFunnel(db, { orgId, partnerId } = {}) {
  if (!orgId) throw new TypeError("publishTrialFunnel: orgId is required");
  if (!partnerId) throw new TypeError("publishTrialFunnel: partnerId is required");

  const brand = (await db.query(
    `SELECT approval_status, entity_name FROM partner_brand
      WHERE org_id = $1 AND partner_id = $2 LIMIT 1`,
    [orgId, partnerId]
  )).rows[0];
  if (!brand) return { published: false, reason: "no_brand_row" };
  if (brand.approval_status !== "approved") {
    return { published: false, reason: "brand_not_approved" };
  }

  const page = (await db.query(
    `SELECT id, body_json, status FROM partner_pages
      WHERE org_id = $1 AND partner_id = $2 AND slug = $3 LIMIT 1`,
    [orgId, partnerId, TRIAL_FUNNEL_SLUG]
  )).rows[0];
  if (!page) return { published: false, reason: "no_page" };

  try {
    assertFulfilmentDisclosure(page.body_json, { entityName: brand.entity_name });
  } catch (err) {
    if (err && err.code === "DISCLOSURE_MISSING") {
      return { published: false, reason: "disclosure_missing" };
    }
    throw err;
  }

  const { rows } = await db.query(
    `UPDATE partner_pages
        SET status = 'published',
            published_at = COALESCE(published_at, now()),
            updated_at = now()
      WHERE id = $1
      RETURNING id, status`,
    [page.id]
  );
  return {
    published: !!rows[0],
    reason: null,
    sitePath: `/sites/${partnerId}/${TRIAL_FUNNEL_SLUG}`
  };
}

/**
 * revokeTrialFunnel(db, { orgId, partnerId }) → { revoked }
 *
 * Day 8, no signature. Clause 6 of LIVE-TRIAL-TERMS is the one with real teeth
 * because a system enforces it: the page comes down. Archived, not deleted —
 * the record of what ran under that brand has to survive.
 */
export async function revokeTrialFunnel(db, { orgId, partnerId } = {}) {
  if (!orgId) throw new TypeError("revokeTrialFunnel: orgId is required");
  if (!partnerId) throw new TypeError("revokeTrialFunnel: partnerId is required");
  const { rows } = await db.query(
    `UPDATE partner_pages
        SET status = 'archived', updated_at = now()
      WHERE org_id = $1 AND partner_id = $2 AND status = 'published'
      RETURNING id`,
    [orgId, partnerId]
  );
  return { revoked: (rows || []).length };
}

export default {
  TRIAL_FUNNEL_KEY,
  TRIAL_FUNNEL_SLUG,
  parseTrialSignup,
  provisionLiveTrial,
  trialPageBody,
  publishTrialFunnel,
  revokeTrialFunnel,
  slugFromName,
  generateFirstPassword
};
