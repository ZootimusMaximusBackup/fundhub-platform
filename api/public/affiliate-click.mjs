// POST /api/public/affiliate-click — record one visit to a referral link.
//
// UNAUTHENTICATED, on purpose and by necessity. This fires from the /start
// redirect page, which runs in a stranger's browser before anybody has signed
// in to anything. Same class as api/public/survey-submit.mjs and
// api/public/partner-apply.mjs, and it follows partner-apply's shape: method
// gate, hand-rolled body reader, hard length caps on every field, one write,
// no reads returned.
//
//
// *** WRITE-ONLY. IT MUST NOT BE POSSIBLE TO LEARN ANYTHING FROM THIS. ***
//
// The response is byte-for-byte identical whether the code matched a real
// affiliate or matched nobody: { ok: true, recorded: true }. There is no
// "unknown code" error, no 404, no different status, no timing branch that
// depends on the answer — the lookup runs either way. If the two answers
// differed, anyone could walk the code space and enumerate the partner roster,
// which is a list of businesses and their relationship to this company.
//
// A code that resolves to nobody is still RECORDED, with affiliate_id NULL and
// the code kept in tracking_id_used. See 235_affiliate_link_clicks.sql: a dead
// link is a fact worth having, and NULL means unknown, not zero.
//
//
// *** NO RAW IP, NO RAW USER AGENT, EVER. ***
//
// This is a regulated consumer-finance product and an IP address is personal
// data. Only hashes are written, and the IP hash is written ONLY when
// CLICK_HASH_SALT is configured — an unsalted hash of an IPv4 address is not an
// anonymisation, it is a four-billion-value lookup table. With no salt set the
// column stays NULL, which says "not recorded" rather than pretending.
//
//
// *** NOTHING CALLS THIS YET. ***
//
// public/start.html is owned by another thread; it still writes the code to
// localStorage and immediately location.replace()s to apply.fundhub.ai without
// touching a server. Until that one line lands, this table stays empty and the
// affiliate screen keeps its honest "link clicks are not recorded yet" state.
// The exact one-line change is on the board.

import crypto from "node:crypto";
import { db } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { safeError } from "../../src/http/health.mjs";

// Long enough for the longest vanity code anyone has issued ("DKOWAL-000123"),
// short enough that this column cannot be used as free storage.
const MAX_CODE = 64;
const MAX_SOURCE = 40;

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

function cleanStr(v, max) {
  if (v == null) return "";
  return String(v).trim().slice(0, max);
}

/* parseAffiliateClickBody — pure, so the validation is testable without HTTP.

   `ref`, `code` and `a1` are all accepted because all three appear on links in
   the wild: /start?ref=, the ClickFunnels ?a1= parameter, and hand-written
   ?code=. They mean the same thing. */
export function parseAffiliateClickBody(body, query = {}) {
  const src = body && typeof body === "object" ? body : {};
  const code =
    cleanStr(src.ref || src.code || src.a1, MAX_CODE) ||
    cleanStr(query.ref || query.code || query.a1, MAX_CODE);
  if (!code) return { ok: false, error: "ref_required" };
  return { ok: true, code, source: cleanStr(src.source, MAX_SOURCE) || null };
}

/* hashUserAgent — a coarse client fingerprint, never the string itself.
   Truncated to 32 hex characters: enough to tell two clients apart when
   counting a flood, not enough to be a durable identifier. */
export function hashUserAgent(ua) {
  const s = String(ua || "").trim();
  if (!s) return null;
  return crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 32);
}

/* hashIp — SALTED, or nothing at all.

   Returns null when no salt is configured. That is deliberate and it is not a
   degraded mode to be quietly fixed with a constant: an unsalted sha256 of an
   IPv4 address is reversible by brute force in minutes, so storing one would be
   storing the address. NULL means "not recorded", which is true. */
export function hashIp(ip, env = process.env) {
  const salt = String(env.CLICK_HASH_SALT || "").trim();
  const s = String(ip || "").trim();
  if (!salt || !s) return null;
  return crypto.createHash("sha256").update(salt + "\n" + s, "utf8").digest("hex");
}

function clientIp(req) {
  const h = req.headers || {};
  return (
    h["x-nf-client-connection-ip"] ||
    String(h["x-forwarded-for"] || "").split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress) ||
    null
  );
}

/* recordAffiliateClick — resolve the code and write the row.

   The lookup ALWAYS runs and its answer NEVER changes the response. It matches
   the way 033_affiliates.sql keys the code: unique per org on upper(tracking_id),
   because nobody types a referral code in the case it was issued in. */
export async function recordAffiliateClick(parsed, deps = {}) {
  const database = deps.db || db;
  const resolveOrg = deps.resolveDefaultOrg || resolveDefaultOrg;
  const orgId = await resolveOrg(database);

  const hit = (await database.query(
    `SELECT id FROM affiliates
      WHERE org_id = $1 AND upper(tracking_id) = upper($2)
      LIMIT 1`,
    [orgId, parsed.code]
  )).rows[0];

  await database.query(
    `INSERT INTO affiliate_link_clicks
       (org_id, affiliate_id, tracking_id_used, source, user_agent_hash, ip_hash)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [orgId, hit ? hit.id : null, parsed.code, parsed.source,
     parsed.userAgentHash, parsed.ipHash]
  );

  // NOTE what is not returned: whether `hit` existed. See the header.
  return { ok: true, recorded: true };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const parsed = parseAffiliateClickBody(readBody(req), req.query || {});
  if (!parsed.ok) {
    return res.status(400).json({ ok: false, error: parsed.error });
  }

  try {
    const result = await recordAffiliateClick({
      ...parsed,
      userAgentHash: hashUserAgent((req.headers || {})["user-agent"]),
      ipHash: hashIp(clientIp(req))
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
