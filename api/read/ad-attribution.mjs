// GET /api/read/ad-attribution?client_id= — which ad brought this client, and
// what that ad promised them.
//
// Returns the client_ad_attribution row (raw UTMs + the database-derived lane,
// ad_id and variant) and the registry tags that ad_id resolves to. The four
// lines the closer reads — gate, entry, primary, secondary — sit under
// `resolved`. A client with no attribution row answers 200 with
// attribution: null and the sorting default, because "we do not know what
// they were promised" is itself the answer the closer needs.
//
// ROLE_SETS.STAFF, org bound from the session. Same gate and tenancy rule as
// read/closer-call, which is the screen that calls this.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { readClientAdAttribution } from "../../src/ads/store.mjs";
import { resolveAd } from "../../src/ads/registry.mjs";

export function shapeResolved(row, ad) {
  return {
    gate: ad.gate,
    entry: ad.entry,
    primary_offer: ad.primary_offer,
    secondary_offers: ad.secondary_offers,
    title: ad.title,
    variant: row?.variant ?? null,
    // "Direct means sell what they were promised. Sorting means lead with
    // primary if there is one and every road is open." Spelled out once here
    // so every screen says the same sentence.
    guidance: ad.entry === "direct"
      ? "Direct: sell what they were promised."
      : (ad.primary_offer !== "none"
          ? "Sorting: lead with the primary offer. Every road is open."
          : "Sorting: assess first. Every road is open.")
  };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) return res.status(403).json({ ok: false, error: "forbidden" });
  const clientId = String(req.query?.client_id ?? "").trim();
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }

  try {
    const exists = await database.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [clientId, orgId]);
    if (!exists.rows.length) return res.status(404).json({ ok: false, error: "client_not_found" });

    const row = await readClientAdAttribution(database, { orgId, clientId });
    const ad = resolveAd(row?.ad_id ?? null);
    return res.status(200).json({
      ok: true,
      client_id: clientId,
      attribution: row,
      registry: ad,
      resolved: shapeResolved(row, ad)
    });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
