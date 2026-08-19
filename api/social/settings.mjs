// GET/POST /api/social/settings — the "does a person have to approve a post"
// switch, plus the other partner_module_settings values Social Studio shows.
//
// WHY THIS FILE EXISTS. Social Studio read the setting off the partner row it got
// from /api/read/partners, and that endpoint has never carried one — so the
// approval card said "setting not read" for every partner, for both the owner and
// the partner. api/read/partners.mjs is finance-gated and shared with other
// screens, so the value is surfaced here instead of widening it.
//
// WHAT THE SETTING DOES TODAY, stated plainly because the screen has to say it:
// src/social/scheduler.mjs reads approve_before_launch and passes it to the
// guardrail screen, which turns it into a "needs approval" verdict. Since 240
// that verdict really does stop the post: it lands in status
// 'awaiting_approval', and the sender only ever selects 'queued', so nothing
// sends it. But NOTHING CAN APPROVE ONE — there is no screen and no endpoint
// that sets approved_at — so a post held here stays held. Returning this value
// is what lets the screen say both halves of that.
//
// GET  — the owning partner, or an owner/admin naming a partner_id.
// POST — the owner only. Same rule as api/partner-marketing/enable.mjs, which
//        governs the sibling switch on the same table.
//
// SCOPED TO THE CALLER'S COMPANY. canAccessPartnerMarketing() admits any staff
// whose role is owner or admin, whatever company they belong to, and every
// statement below runs in a staff scope that sets no partner and applies no org
// filter. So the org_id predicate written into each statement is the ONLY thing
// keeping an owner at one company out of another company's approval switch. Same
// hole, same fix, same shape as api/brand/review.mjs.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { withPartnerScope } from "../../src/partners/rls.mjs";
import { canAccessPartnerMarketing, isOwner } from "../../src/brand/meter.mjs";

/* readSettings is exported so the SQL can be executed directly by
   src/http/social-channels.pg.test.mjs, the same reason every fetchRows is.

   `stored` is the honest half of the answer. With no row on file nothing has been
   saved, and the screen must not print "your saved setting" over a default it
   invented. approve_before_launch still comes back as true in that case, because
   true is what src/social/scheduler.mjs falls back to — so the number the screen
   shows is the number the engine uses. */
export async function readSettings(tx, partnerId, orgId = null) {
  const r = await tx.query(
    `SELECT approve_before_launch, weekly_asset_target, max_concurrent_jobs,
            autopilot_enabled, launch_enabled, marketing_suite_enabled, updated_at
       FROM partner_module_settings
      -- THE GUARD IS THIS WHERE CLAUSE. A staff caller runs in a scope that
      -- applies no org filter of its own, so org_id here is what keeps one
      -- company's owner out of another company's row. NULL means there is no org
      -- to check — a partner principal, whose own policy has already filtered the
      -- row — and the predicate then passes, exactly as api/brand/review.mjs does.
      WHERE partner_id = $1
        AND ($2::uuid IS NULL OR org_id = $2::uuid)`,
    [partnerId, orgId]
  );
  const row = r.rows[0];
  if (!row) {
    return {
      stored: false,
      approve_before_launch: true,
      weekly_asset_target: null,
      max_concurrent_jobs: null,
      autopilot_enabled: false,
      launch_enabled: false,
      marketing_suite_enabled: false,
      updated_at: null
    };
  }
  return {
    stored: true,
    approve_before_launch: row.approve_before_launch === true,
    weekly_asset_target: row.weekly_asset_target,
    max_concurrent_jobs: row.max_concurrent_jobs,
    autopilot_enabled: row.autopilot_enabled === true,
    launch_enabled: row.launch_enabled === true,
    marketing_suite_enabled: row.marketing_suite_enabled === true,
    updated_at: row.updated_at
  };
}

/* writeApproval — upsert of the one column this endpoint may change. Every other
   column on the row is left alone; a settings write that quietly reset the token
   cap or the autopilot switch would be a different endpoint wearing this one's
   name. */
export async function writeApproval(tx, { orgId, partnerId, approve }) {
  if (!orgId || !partnerId) throw new Error("writeApproval: orgId and partnerId are required");
  const r = await tx.query(
    `INSERT INTO partner_module_settings (org_id, partner_id, approve_before_launch)
     VALUES ($1,$2,$3)
     ON CONFLICT (partner_id) DO UPDATE
       SET approve_before_launch = EXCLUDED.approve_before_launch,
           updated_at = now()
       -- THE GUARD ON THE UPDATE PATH IS THIS WHERE CLAUSE. A row that already
       -- belongs to another company is left alone rather than flipped, and
       -- RETURNING then yields nothing — which is raised below, never reported as
       -- a successful write.
       WHERE partner_module_settings.org_id = EXCLUDED.org_id
     RETURNING approve_before_launch`,
    [orgId, partnerId, approve === true]
  );
  if (!r.rows[0]) {
    const e = new Error("those settings belong to another company");
    e.code = "NOT_FOUND";
    throw e;
  }
  return r.rows[0].approve_before_launch === true;
}

/* Where the caller's company comes from. Copied from api/brand/review.mjs, the
   sibling in this batch that scopes its statements the same way — the same
   principal shapes reach both files, so they must read the org the same way. */
function orgIdOf(principal) {
  if (principal.kind === "staff") return principal.staff?.org_id || principal.orgId || null;
  return principal.orgId || null;
}

function partnerIdOf(req) {
  return (req.query && req.query.partner_id) || (req.body && req.body.partner_id);
}

function scopeFor(principal) {
  return principal.kind === "partner"
    ? { kind: "partner", partnerId: principal.partnerId }
    : { kind: "staff" };
}

export default async function handler(req, res) {
  const principal = await requirePrincipal(req, res, ["staff", "partner"], { db });
  if (!principal) return;

  const partnerId = partnerIdOf(req);
  if (!isUuid(partnerId)) {
    return res.status(400).json({ ok: false, error: "partner_id_required" });
  }
  if (!canAccessPartnerMarketing(principal, partnerId)) {
    return res.status(403).json({ ok: false, error: "forbidden",
      message: "only the owning partner or an admin may read this" });
  }

  /* THE TENANCY GUARD, and there is no other one for a staff caller. The check
     above admits any owner or admin whatever company they work for, so without
     the org_id predicate threaded into every statement below, naming another
     company's partner_id was enough to read AND flip that company's approval
     switch.

     Only a STAFF caller needs it. A partner principal is already pinned to its
     own partner_id by canAccessPartnerMarketing, so its own row is the only row
     it can reach; requiring its account org to match as well would refuse a
     partner whose two org values disagree in the data, and that is a data problem
     to find, not a refusal to invent here. Same reasoning, same shape, as
     api/brand/review.mjs. */
  const orgId = principal.kind === "staff" ? orgIdOf(principal) : null;
  if (principal.kind === "staff" && !orgId) {
    return res.status(403).json({ ok: false, error: "no_org_scope",
      message: "Your sign-in is not attached to a company, so nothing was read or changed." });
  }

  try {
    if (req.method === "GET") {
      const settings = await withPartnerScope(scopeFor(principal), (tx) =>
        readSettings(tx, partnerId, orgId));
      return res.status(200).json({ ok: true, partner_id: partnerId, settings });
    }

    if (req.method === "POST") {
      // The owner only, matching enable.mjs. This switch is the record of who has
      // to look at a post before it goes out; an admin flipping it off would be a
      // compliance change nobody asked for.
      if (!isOwner(principal)) {
        return res.status(403).json({ ok: false, error: "forbidden",
          message: "only the owner can change who has to approve a post" });
      }
      const approve = req.body && req.body.approve_before_launch;
      if (typeof approve !== "boolean") {
        return res.status(400).json({ ok: false, error: "approve_before_launch_required",
          message: "say true or false for approve_before_launch" });
      }
      const settings = await withPartnerScope({ kind: "staff" }, async (tx) => {
        // Same guard again: a partner in another company reads as no partner at
        // all, which is the honest answer — this caller has none by that id.
        const partner = (await tx.query(
          `SELECT org_id FROM partners
            WHERE id = $1 AND ($2::uuid IS NULL OR org_id = $2::uuid)`,
          [partnerId, orgId]
        )).rows[0];
        if (!partner) {
          const e = new Error("partner not found");
          e.code = "NOT_FOUND";
          throw e;
        }
        await writeApproval(tx, { orgId: partner.org_id, partnerId, approve });
        return readSettings(tx, partnerId, orgId);
      });
      return res.status(200).json({ ok: true, partner_id: partnerId, settings });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (err) {
    if (err.code === "NOT_FOUND") {
      /* Not found, or found in another company — deliberately the same answer, so
         naming an id cannot be used to learn whether it exists. */
      return res.status(404).json({ ok: false, error: "not_found",
        message: "That partner was not found, so nothing was read or changed." });
    }
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
