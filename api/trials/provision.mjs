// POST /api/trials/provision — day 0, everything the $297 buys.
//
// STAFF ONLY, and gated with requireRole AFTER the session check. requireAuth
// forwards its third argument to authenticate(), which reads only { db, env } —
// so passing { roles: [...] } to requireAuth declares a gate that is silently
// dropped. That has shipped broken here before. requireRole("owner","admin") is
// the real gate and it is the one used below.
//
// WHY STAFF AND NOT PUBLIC. Provisioning creates a partners row, an affiliates
// row and a login. The trial is PAID before it is provisioned, so the caller is
// the payment-cleared path or a person acting on it — never an anonymous form.
// A public provisioning endpoint would let a stranger mint a partner record by
// filling in a name and an email, which is exactly the finding that closed the
// old white-label apply hole.
//
// REFUSES A SALE THE GATE HELD. If the eligibility answers say hold the sale,
// this answers 409 and creates nothing. There is no "provision it anyway and
// sort the ad account out later" path.
//
// THE CLOCK IS NOT STARTED HERE. Seven days begin at the first ad impression.
//
// COMPLIANCE REVIEW REQUIRED — this endpoint stands up a branded funnel that
// FundHub's regulated creative will run behind, for a party who has signed
// nothing. The page it creates is a DRAFT; publishing is a separate, gated act.

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { parseTrialSignup, provisionLiveTrial } from "../../src/trials/provision.mjs";
import { safeError } from "../../src/http/health.mjs";

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

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res, { db: database });
  if (!staff) return;

  const body = readBody(req);
  if (body === null) return res.status(400).json({ ok: false, error: "invalid_json" });

  const parsed = parseTrialSignup(body);
  if (!parsed.ok) return res.status(400).json({ ok: false, error: parsed.error });

  try {
    const out = await provisionLiveTrial(
      { ...parsed, orgId: staff.org_id },
      { db: database }
    );
    if (!out.ok) {
      return res.status(out.status || 400).json({
        ok: false,
        error: out.error,
        decision: out.decision || undefined
      });
    }
    return res.status(200).json(out);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
