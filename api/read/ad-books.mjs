// GET /api/read/ad-books?group_by=lane|ad_id|variant|gate|entry|primary_offer|secondary_offer[&from=&to=]
//
// Booked calls and leads, grouped. `lane`, `ad_id` and `variant` come from the
// database (286). `gate`, `entry`, `primary_offer` and `secondary_offer` are
// registry tags: the rows are rolled up per ad_id, each ad_id is resolved
// through docs/ads/registry.json, and the groups are folded on the tag. An
// unknown ad_id lands in the sorting default's groups (gate none, entry
// sorting, primary none) and is reported under `unknown_ad_ids` so nobody
// mistakes it for a filed ad.
//
// A sorting ad's secondary_offers are "all", so under group_by=secondary_offer
// it counts once in every offer except `none`.
//
// `from`/`to` are ISO dates and window the LEAD's capture time (from
// inclusive, to exclusive). Counts are whole numbers; a NULL first/last date
// means no row in that group had one, and stays NULL.
//
// ROLE_SETS.STAFF, org bound from the session.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { adAttributionRollup } from "../../src/ads/store.mjs";
import { resolveAd, OFFERS } from "../../src/ads/registry.mjs";

export const GROUPS = Object.freeze(["lane", "ad_id", "variant", "gate", "entry", "primary_offer", "secondary_offer"]);

function minDate(a, b) { return !a ? b : (!b ? a : (new Date(a) < new Date(b) ? a : b)); }
function maxDate(a, b) { return !a ? b : (!b ? a : (new Date(a) > new Date(b) ? a : b)); }

function parseDate(v) {
  if (v == null || String(v).trim() === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** Fold rollup rows (one per lane/ad_id/variant) into groups keyed by `groupBy`. Exported for tests. */
export function foldGroups(rows, groupBy, { resolve = resolveAd } = {}) {
  const groups = new Map();
  const unknown = new Set();
  const add = (key, r) => {
    const k = key == null ? "(none)" : String(key);
    const g = groups.get(k) || {
      key: k, leads: 0, books: 0,
      first_lead_at: null, last_lead_at: null, first_book_at: null, last_book_at: null,
      ad_ids: new Set()
    };
    g.leads += Number(r.leads || 0);
    g.books += Number(r.books || 0);
    g.first_lead_at = minDate(g.first_lead_at, r.first_lead_at);
    g.last_lead_at = maxDate(g.last_lead_at, r.last_lead_at);
    g.first_book_at = minDate(g.first_book_at, r.first_book_at);
    g.last_book_at = maxDate(g.last_book_at, r.last_book_at);
    if (r.ad_id) g.ad_ids.add(r.ad_id);
    groups.set(k, g);
  };

  for (const r of rows) {
    if (groupBy === "lane") { add(r.lane, r); continue; }
    if (groupBy === "ad_id") { add(r.ad_id, r); continue; }
    if (groupBy === "variant") { add(r.variant, r); continue; }
    const ad = resolve(r.ad_id);
    if (!ad.known) unknown.add(r.ad_id == null ? "(none)" : String(r.ad_id));
    if (groupBy === "gate") add(ad.gate, r);
    else if (groupBy === "entry") add(ad.entry, r);
    else if (groupBy === "primary_offer") add(ad.primary_offer, r);
    else if (groupBy === "secondary_offer") {
      const list = ad.secondary_offers === "all" ? OFFERS.filter((o) => o !== "none") : ad.secondary_offers;
      if (!list.length) add("none", r);
      for (const o of list) add(o, r);
    }
  }

  return {
    groups: [...groups.values()]
      .map((g) => ({ ...g, ad_ids: [...g.ad_ids].sort((a, b) => Number(a) - Number(b)) }))
      .sort((a, b) => b.books - a.books || b.leads - a.leads || a.key.localeCompare(b.key)),
    unknown_ad_ids: [...unknown].sort()
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

  const groupBy = String(req.query?.group_by ?? "lane").trim();
  if (!GROUPS.includes(groupBy)) {
    return res.status(400).json({ ok: false, error: `group_by must be one of ${GROUPS.join("|")}` });
  }
  const from = parseDate(req.query?.from);
  const to = parseDate(req.query?.to);
  if (from === undefined || to === undefined) {
    return res.status(400).json({ ok: false, error: "from/to must be ISO dates" });
  }

  try {
    const rows = await adAttributionRollup(database, { orgId: staff.org_id, from, to });
    const folded = foldGroups(rows, groupBy);
    return res.status(200).json({
      ok: true,
      group_by: groupBy,
      from, to,
      total_leads: rows.reduce((n, r) => n + Number(r.leads || 0), 0),
      total_books: rows.reduce((n, r) => n + Number(r.books || 0), 0),
      ...folded
    });
  } catch (e) {
    if (dbDown(res, e)) return;
    throw e;
  }
}
