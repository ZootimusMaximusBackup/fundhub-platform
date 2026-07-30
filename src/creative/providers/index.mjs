// The provider adapter interface, and the registry that selects one.
//
// ONE SHAPE, FIVE IMPLEMENTATIONS. Every provider exports the same thing:
//
//   generate(spec, ctx) -> { assets: [...], cost_cents: n }
//
// and nothing else about them leaks into the calling code. The service in
// ../generate.mjs never branches on which provider it is talking to, because the
// moment it does, adding a sixth means editing the service instead of adding a
// file.
//
// SELECTED BY CONFIG ROW, NEVER HARDCODED. resolve() looks the provider up by the
// kind of asset requested, from creative_providers. A hardcoded map here would be
// the same deploy-to-change-a-vendor problem the spec is avoiding.
//
// API KEYS ARE FUNDHUB-LEVEL AND LIVE IN ENV. They are read inside the provider
// modules, never passed through a partner-facing surface, never stored in a
// partner-scoped table, and never included in a returned asset or an error. A
// provider that cannot find its key throws a message naming the ENV VAR, not the
// value.

import * as staticImages from "./static.mjs";
import * as ugcVideo from "./ugc-video.mjs";
import * as productVideo from "./product-video.mjs";
import * as copy from "./copy.mjs";
import * as resize from "./resize.mjs";

// The modules, by their config key. This map is the only place a provider name is
// written in code; which one runs for a given request comes from the database.
const MODULES = {
  static: staticImages,
  "ugc-video": ugcVideo,
  "product-video": productVideo,
  copy,
  resize
};

export const PROVIDER_KEYS = Object.freeze(Object.keys(MODULES));

/* resolve(db, { orgId, assetKind }) → { key, module, config }

   Throws when no provider is configured. Deliberately not a default: falling back
   to some arbitrary provider would spend the partner's money at a vendor nobody
   chose, and bill them for it under UNIT 9. */
export async function resolve(db, { orgId, assetKind }) {
  const { rows } = await db.query(
    `SELECT provider_key, config
       FROM creative_providers
      WHERE org_id = $1 AND asset_kind = $2 AND active
      ORDER BY priority ASC
      LIMIT 1`,
    [orgId, assetKind]
  );
  const row = rows[0];
  if (!row) {
    throw new Error(
      `no active provider configured for asset kind "${assetKind}" — ` +
      `insert a creative_providers row rather than hardcoding one`
    );
  }
  const mod = MODULES[row.provider_key];
  if (!mod) {
    throw new Error(
      `creative_providers names provider "${row.provider_key}", which has no module. ` +
      `Known: ${PROVIDER_KEYS.join(", ")}`
    );
  }
  return { key: row.provider_key, module: mod, config: row.config || {} };
}

/* assertAdapter — the shape check, run in tests rather than at import time so a
   half-written provider fails loudly in CI instead of at 3am in production. */
export function assertAdapter(mod, name) {
  if (typeof mod.generate !== "function") {
    throw new Error(`provider ${name} must export generate(spec, ctx)`);
  }
  return true;
}

export { MODULES };
