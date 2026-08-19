// src/content/welcome-video.mjs — the client portal's welcome video: which one
// a client should see, and a link that will actually play it.
//
// Until this file existed an uploaded welcome video was WRITE-ONLY. Grepping
// content_videos across api/, src/, public/, db/, netlify/ and scripts/ found
// exactly three writers and readers: api/content/upload.mjs (the INSERT),
// api/content/tiles.mjs (a SELECT list that deliberately OMITS storage_key so
// the Content screen can list the library) and db/migrations/171_content.sql.
// Nothing read the bytes back. This module is the read side.
//
// TWO HALVES, AND THE SECOND ONE HAS A HOLE IN IT ON PURPOSE.
//
//   resolveWelcomeVideo()  tier code -> content_tier_map -> content_videos row
//                          -> a short-lived signed URL. Complete.
//   tierCodeForClient()    client -> tier code. NOT IMPLEMENTED, and that is
//                          the honest state of this repository, not an
//                          oversight. See below.
//
// ── WHY tierCodeForClient() RETURNS null ────────────────────────────────────
// content_tier_map.tier_code has exactly ONE writer: api/content/tiles.mjs,
// fed by the dropdowns on public/app/content-admin.html. The keys that screen
// offers are products.code values plus the literal string 'default'.
//
// Nothing in this repository turns a CLIENT into a products.code:
//   - src/config/product-path.mjs reads clients.outcome_tier, which is the CRS
//     decision ladder (FRAUD_HOLD … PREMIUM_STACK). Those are not product codes
//     and can never key this table.
//   - src/affiliates/economics.mjs joins sales -> products.code, but it takes a
//     saleId. There is no clientId form of that query anywhere.
//   - public/app/client-portal.html hardcodes the tier chip to the literal
//     "Fundhub portal". No JavaScript has ever written it.
//
// So the rule does not exist yet, and CLAUDE.md §2 says the absence is the
// finding — not a gap to fill with a plausible guess. Inventing one here would
// silently pick a product for every client on the platform. Instead this
// returns null WITH A REASON, every client falls through to the 'default'
// mapping the Content screen already offers, and the reason travels in the
// response so the gap shows up on screen rather than being papered over.
//
// NEEDS-OWNER-DECISION, in one sentence: which fact about a client picks their
// welcome video — the product they bought (sales -> products.code), the
// entitlement they hold (entitlement_catalog.code), or their CRS outcome tier
// (clients.outcome_tier)? When that is answered, tierCodeForClient() is the
// ONLY function in this file that changes.
//
// ── STORAGE KEYS NEVER LEAVE THIS MODULE ────────────────────────────────────
// Same rule src/documents/signed-url.mjs opens with: under Vercel Blob a
// storage_key IS a permanent public URL, i.e. a bearer credential.
// resolveWelcomeVideo() never selects that column. loadVideoStorageKey() does,
// exists solely for the streaming half of api/content/welcome-video.mjs, and is
// fenced off at the bottom of this file with a header saying so.
//
// ── ONE SECRET, TWO ID SPACES ───────────────────────────────────────────────
// This reuses src/documents/signed-url.mjs's signing primitives rather than
// growing a second copy of an HMAC. A signature minted here for a
// content_videos.id therefore also validates at /api/documents/<that-id>. That
// is inert: the documents route resolves the id through resolveStorageTarget(),
// which looks it up in `documents`, finds nothing, and 404s. Symmetric the
// other way. Recorded here rather than left for someone to rediscover.

import {
  signature,
  secretFromEnv,
  verifyDocumentUrl,
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS
} from "../documents/signed-url.mjs";

/** The fall-through key the Content screen writes for "Default". Not enforced
    in SQL — content_tier_map has no is_default flag — so it is a UI convention
    named here in one place instead of being a bare string in three. */
export const DEFAULT_TIER_CODE = "default";

/* Where a signed playback link points. This is an EXACT ROUTES key, which is
   why the video id rides in the QUERY STRING and not in a path segment:
   netlify/functions/api.mjs matches whole paths against its hardcoded ROUTES
   map and has only two prefix branches, `webhooks/` and `documents/`. A link
   shaped /api/content/welcome-video/<id> would 404 for everyone, forever. */
export const VIDEO_BASE_PATH = "/api/content/welcome-video";

/* The signing key is missing more often than it is wrong, and the two need
   different answers on the wire: a missing key is OUR misconfiguration (503
   not_configured, exactly as api/documents/[id].mjs answers it) while a real
   database fault is a 500. Errors are tagged with this code so the handler can
   tell them apart without matching on an error message, which is the same
   `err.code` idiom api/products.mjs already uses for 23505. */
export const NO_URL_SECRET = "NO_URL_SECRET";

/**
 * signWelcomeVideoUrl — mint a playback link.
 *
 * Deliberately NOT signDocumentUrl(). That one builds `${basePath}/${id}?…`,
 * a path-segment shape nothing routes here (see VIDEO_BASE_PATH above). Same
 * HMAC, same canonical string, same secret, same expiry rules — only the URL
 * shape differs, so there is no second piece of crypto to keep in step.
 *
 * Returns { url, expiresAt, expiresAtIso }. Never a storage key.
 */
export function signWelcomeVideoUrl({
  videoId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  secret = undefined,
  basePath = VIDEO_BASE_PATH,
  now = Date.now
} = {}) {
  if (!videoId) throw new Error("signWelcomeVideoUrl requires videoId");

  const ttl = Number(ttlSeconds);
  if (!Number.isFinite(ttl) || ttl <= 0) throw new Error("ttlSeconds must be a positive number");
  if (ttl > MAX_TTL_SECONDS) {
    throw new Error(`ttlSeconds ${ttl} exceeds the ${MAX_TTL_SECONDS}s maximum`);
  }

  let key;
  try {
    key = secret ?? secretFromEnv();
  } catch (err) {
    // Re-thrown, not swallowed: no secret means no playable link, and pretending
    // there is no video would be a lie about the library. The tag lets the
    // handler answer 503 rather than a 500 that reads like a database fault.
    err.code = NO_URL_SECRET;
    throw err;
  }

  const expiresAt = Math.floor(now() / 1000) + Math.floor(ttl);
  const sig = signature({ documentId: videoId, versionId: null, expiresAt, secret: key });

  const params = new URLSearchParams();
  params.set("id", videoId);
  params.set("exp", String(expiresAt));
  params.set("sig", sig);

  return {
    url: `${basePath}?${params}`,
    expiresAt,
    expiresAtIso: new Date(expiresAt * 1000).toISOString()
  };
}

/**
 * verifyWelcomeVideoRequest — what the streaming branch calls before it touches
 * the database. Straight through to verifyDocumentUrl so the constant-time
 * compare, and the deliberate signature-before-expiry ordering, stay the
 * documents module's single implementation rather than a second copy. Never
 * throws: a malformed link is an invalid link, not a 500.
 */
export function verifyWelcomeVideoRequest({
  videoId,
  expiresAt,
  sig,
  secret = undefined,
  now = Date.now
} = {}) {
  return verifyDocumentUrl({
    documentId: videoId,
    versionId: null,
    expiresAt,
    sig,
    secret,
    now
  });
}

/**
 * tierCodeForClient — WHICH WELCOME VIDEO THIS CLIENT SHOULD SEE.
 *
 * NOT IMPLEMENTED, ON PURPOSE. The file header explains why at length: no rule
 * exists in this codebase, and writing a plausible one here would quietly pick
 * a product for every client on the platform.
 *
 * Returns { tierCode, reason } rather than a bare null so the caller can fall
 * through to DEFAULT_TIER_CODE and still report WHY it did. `db` is in the
 * signature because the real implementation will need it — leaving it out now
 * would mean every call site changes on the day this gets filled in.
 *
 * ONE REASON, FOR EVERY CALLER. An earlier version answered "no_client" when no
 * client was named, which is what a STAFF PREVIEW looks like — so the reason
 * that matters ("there is no tier rule anywhere in this codebase") vanished
 * exactly when a human was looking at the field. Worse, "no_client" reads as
 * "name a client and we would pick a tier", and we would not: with no rule,
 * naming a client changes nothing. So the reason never varies until the rule
 * exists, and `orgId`/`clientId` stay in the signature for the day it does.
 */
export async function tierCodeForClient(db, { orgId, clientId } = {}) {
  return { tierCode: null, reason: "no_tier_rule_in_code" };
}

/**
 * resolveWelcomeVideo — tier code in, playable video out.
 *
 * Asks for the named tier AND the default in one statement, then prefers the
 * named one. Two rows at most, and no second round trip for the fall-through.
 *
 * Returns { video: null, reason } when nothing is mapped. That is a NORMAL
 * answer and not an error: 171_content.sql seeds nothing, so an org that has
 * never opened the Content screen has an empty map and the portal has to be
 * able to say so plainly.
 *
 * byte_size is nullable and NULL means "unknown", so it survives as null here
 * and is never defaulted to 0 (CLAUDE.md §12).
 */
export async function resolveWelcomeVideo(db, {
  orgId,
  tierCode = null,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  secret = undefined,
  now = Date.now
} = {}) {
  if (!orgId) throw new Error("resolveWelcomeVideo requires orgId");

  const wanted = String(tierCode || "").trim();
  const codes = wanted && wanted !== DEFAULT_TIER_CODE
    ? [wanted, DEFAULT_TIER_CODE]
    : [DEFAULT_TIER_CODE];

  /* storage_key is NOT in this SELECT list, and that is the point of the fence
     at the bottom of this file. The join carries org_id on both sides so a map
     row can never reach across companies to a video it does not own. */
  const { rows } = await db.query(
    `SELECT m.tier_code,
            v.id, v.title, v.duration_label, v.mime_type, v.byte_size, v.created_at
       FROM content_tier_map m
       JOIN content_videos v
         ON v.id = m.video_id AND v.org_id = m.org_id
      WHERE m.org_id = $1::uuid AND m.tier_code = ANY($2::text[])`,
    [orgId, codes]
  );

  /* No "no rows matched" branch, because there cannot be one: the WHERE above
     restricts rows to exactly the two codes these finds test for, so a non-empty
     `rows` always produces a `row`. An earlier version carried a second reason
     for that case and it was unreachable. */
  const row = rows.find((r) => r.tier_code === wanted)
    || rows.find((r) => r.tier_code === DEFAULT_TIER_CODE);
  if (!row) return { video: null, reason: "no_video_mapped" };

  return {
    reason: null,
    video: {
      id: row.id,
      title: row.title,
      // Same shape publicVideo() returns in api/content/tiles.mjs, so the two
      // screens describe one video the same way.
      duration_label: row.duration_label || "",
      mime_type: row.mime_type || null,
      byte_size: row.byte_size == null ? null : Number(row.byte_size),
      tier_code: row.tier_code,
      /* "tier" means a real product tier picked this video; "default" means the
         org-wide fall-through did. Keyed off the MATCHED code and not off what
         was asked for: today every caller asks for 'default' outright, so
         comparing against `wanted` would report the fall-through as a tier
         match and hide the fact that nothing chose it. */
      matched: row.tier_code === DEFAULT_TIER_CODE ? "default" : "tier",
      stream: signWelcomeVideoUrl({ videoId: row.id, ttlSeconds, secret, now })
    }
  };
}

// ---------------------------------------------------------------------------
// FENCED OFF — storage keys past this line
// ---------------------------------------------------------------------------

/**
 * loadVideoStorageKey — the ONE function in this module that selects
 * storage_key.
 *
 * Two callers, both inside this fence: the streaming branch of
 * api/content/welcome-video.mjs, and welcomeVideoFileState() below. The key it
 * returns is used to reach the object store and is then discarded; it must
 * never reach a response body, a log line or a JSON payload.
 *
 * `orgId` IS OPTIONAL, AND THAT IS A DECISION WORTH READING.
 *
 * A playback request carries no session — a <video src> cannot send an
 * Authorization header, which is the entire reason the link is signed. So the
 * streaming branch has no org to scope by and passes null, and this falls back
 * to an id-only lookup. That is exactly what the existing signed-link route
 * does: api/documents/[id].mjs resolves through resolveStorageTarget(db, {
 * documentId, versionId }), which takes no org either. Consistency with the
 * route that already ships beats a second, different answer to the same
 * question.
 *
 * What that costs: the HMAC proves WE minted the link, not which company it was
 * minted for. Binding the org into the link would need a new canonical string
 * in src/documents/signed-url.mjs — a shared module — so it is not a change to
 * make inside this feature. The org-scoped form below is kept and used whenever
 * a caller does have an org, so tightening this later is one argument, not a
 * rewrite.
 */
export async function loadVideoStorageKey(db, { orgId = null, videoId } = {}) {
  if (!videoId) return null;

  const { rows } = orgId
    ? await db.query(
      `SELECT id, storage_key, mime_type, byte_size
         FROM content_videos
        WHERE id = $1::uuid AND org_id = $2::uuid`,
      [videoId, orgId]
    )
    : await db.query(
      `SELECT id, storage_key, mime_type, byte_size
         FROM content_videos
        WHERE id = $1::uuid`,
      [videoId]
    );

  return rows[0] || null;
}

/* The three answers welcomeVideoFileState() can give. A row in content_videos
   is NOT evidence that the bytes are still in the object store, and the
   metadata read used to hand out a playable link on the strength of the row
   alone — so it promised a video that then 404'd at the player. */
export const FILE_PRESENT = "present";
export const FILE_MISSING = "missing";
export const FILE_UNKNOWN = "unknown";

/**
 * welcomeVideoFileState — are the bytes actually there?
 *
 * Uses the store's own exists() (src/documents/store.mjs), which every provider
 * implements as a cheap head: `Map.has` for memory, `head()` for Vercel Blob,
 * `getMetadata()` for Netlify Blobs. It never downloads the file.
 *
 * Returns a STATE, never a storage key — that is what keeps this inside the
 * fence. FILE_UNKNOWN is a real answer and not a failure: if the store cannot
 * be asked, we do not know, and the caller must not claim either way. A
 * database fault is NOT caught here; it belongs to the handler's own catch,
 * which already knows how to answer one.
 */
export async function welcomeVideoFileState(db, { orgId = null, videoId, store } = {}) {
  if (!videoId) return FILE_UNKNOWN;
  if (!store || typeof store.exists !== "function") return FILE_UNKNOWN;

  const row = await loadVideoStorageKey(db, { orgId, videoId });
  // No row, or a row with no key, means there is nothing to play. That is
  // missing, not unknown — we asked and the answer was "nowhere".
  if (!row || !row.storage_key) return FILE_MISSING;

  try {
    return (await store.exists(row.storage_key)) ? FILE_PRESENT : FILE_MISSING;
  } catch {
    /* The store threw rather than answering — a key written by a different
       provider, a missing SDK, a vendor outage. We do not know, and saying
       "missing" would be as much of a guess as saying "present". */
    return FILE_UNKNOWN;
  }
}
