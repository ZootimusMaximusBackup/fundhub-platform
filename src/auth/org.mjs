// Default-org resolution for the auth modules. Same shape and cache discipline
// as resolveDefaultOrg() in src/events/bus.mjs (Rule 7: org_id on every table),
// kept local so src/auth/ does not reach into the event bus for a lookup.

const DEFAULT_ORG = () => process.env.DEFAULT_ORG_SLUG || "fundhub";

let _cache = null;

export async function resolveDefaultOrg(db) {
  if (_cache) return _cache;
  const slug = DEFAULT_ORG();
  const r = await db.query(`SELECT id FROM orgs WHERE slug = $1 LIMIT 1`, [slug]);
  if (!r.rows.length) throw new Error(`default org "${slug}" not found — run migrations`);
  _cache = r.rows[0].id;
  return _cache;
}

export const _resetOrgCache = () => { _cache = null; };
