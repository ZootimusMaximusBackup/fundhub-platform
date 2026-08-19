// GET /api/content/welcome-video — the hero video on the client portal.
//
// Before this route existed an uploaded welcome video was write-only:
// api/content/upload.mjs put the bytes in the store and a row in
// content_videos, api/content/tiles.mjs listed the row for the Content screen,
// and NOTHING ever read it back for a client. This is the read.
//
// TWO MODES ON ONE ROUTE, and they are not the same request:
//
//   no ?sig=   → METADATA. Requires a session. Answers "is there a video for
//                this client, and what is the link to play it". Returns a
//                short-lived signed URL, never a storage key.
//   with ?sig= → BYTES. Takes NO SESSION AT ALL, exactly like
//                api/documents/[id].mjs: a <video src> cannot send an
//                Authorization header, so the signature and its expiry ARE the
//                credential. Fails closed with no DOCUMENT_URL_SECRET.
//
// SCOPING. A client is their session and nothing else — ?client_id= is not read
// for a client principal, the same shape and for the same reason as
// api/read/portal-summary.mjs: editing the address bar must not widen what a
// client can see. Staff name the client whose portal they are previewing.
//
// WHICH VIDEO. src/content/welcome-video.mjs owns that question, and its tier
// lookup is deliberately unimplemented because nothing in this repository
// decides a client's tier. Every client currently falls through to the
// 'default' mapping the Content screen already offers, and the response carries
// `tier_reason` so nobody reads "default" as a decision somebody made.
//
// AN HONEST EMPTY IS A 200, NOT A 404. An org that has never opened the Content
// screen has an empty content_tier_map, and "nobody has mapped a video yet" is a
// normal answer to a normal question. The portal renders its existing "Welcome
// video is not available" line from it. A 404 here would be indistinguishable
// from a broken route.
//
// A ROW IS NOT A FILE. content_videos having a row does not mean the bytes are
// still in the object store, and answering ok:true with a signed link on the
// strength of the row alone promised a video that then 404'd at the player.
// The metadata branch now asks the store whether the object is there —
// store.exists(), a cheap head, never a download — and says which of THREE
// things is true, in `reason`:
//
//   reason null                     — mapped, and the bytes are there.
//   reason "video_file_missing"     — mapped, and the bytes are NOT there. No
//                                     link is minted; a link that is known to
//                                     404 is worse than no link.
//   reason "video_file_unverified"  — mapped, link minted, and the store could
//                                     not be asked. We do not know. Saying so
//                                     is the only honest answer available.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, redact } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { safeError } from "../../src/http/health.mjs";
import { storeFromEnv } from "../../src/documents/store.mjs";
import {
  resolveWelcomeVideo,
  tierCodeForClient,
  verifyWelcomeVideoRequest,
  loadVideoStorageKey,
  welcomeVideoFileState,
  DEFAULT_TIER_CODE,
  NO_URL_SECRET,
  FILE_MISSING,
  FILE_UNKNOWN
} from "../../src/content/welcome-video.mjs";

/* One body for every playback failure. A forged signature, an expired link, an
   id that is not a uuid and an id that is simply not on file all answer the
   same 404 with the same shape, so the endpoint cannot be used as an oracle for
   which videos exist. Copied from api/documents/[id].mjs, which does it for the
   same reason. */
const GONE = (res) => res.status(404).json({ ok: false, error: "not_found" });

export default async function handler(req, res) {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({
      ok: false,
      error: "method_not_allowed",
      message: "This route reads a video. It does not take another kind of request."
    });
  }

  const q = req.query || {};

  /* ── BYTES ────────────────────────────────────────────────────────────────
     A signature is present, so this is a player asking for the file rather
     than a screen asking what exists. No session is consulted. */
  if (q.sig) {
    // Shape check first: a malformed id must not reach Postgres as a 22P02.
    if (!isUuid(q.id)) return GONE(res);

    const verdict = verifyWelcomeVideoRequest({
      videoId: q.id,
      expiresAt: q.exp,
      sig: q.sig
    });
    if (!verdict.valid) {
      /* A missing signing key is OUR misconfiguration, not the caller's. Say so
         without telling an anonymous caller anything about the video itself.

         `message` is REQUIRED here, not decoration: public/app/data.js reads
         every 503 as source "nodb" and, with no message to show, prints "The
         database is not reachable right now." The database is fine. Naming the
         real cause in plain words — and never the environment variable — stops
         a missing key sending somebody to Postgres for an hour. */
      if (verdict.reason === "no_secret") {
        return res.status(503).json({
          ok: false,
          error: "not_configured",
          message: "This video link cannot be opened right now. The key we use to sign video links is not set up."
        });
      }
      return GONE(res);
    }

    try {
      /* orgId is null on purpose. The signature travels without a session, so
         there is no org to compare it against — see loadVideoStorageKey()'s
         header for what that costs and why it matches api/documents/[id].mjs,
         whose resolveStorageTarget() is likewise id-only. */
      const row = await loadVideoStorageKey(db, { orgId: null, videoId: q.id });
      if (!row || !row.storage_key) return GONE(res);

      res.setHeader("cache-control", "private, no-store");
      res.setHeader("x-content-type-options", "nosniff");
      if (req.method === "HEAD") {
        res.setHeader("content-type", row.mime_type || "application/octet-stream");
        return res.status(200).end("");
      }

      /* Two storage shapes, the same split api/documents/[id].mjs makes:
         - a vercel-blob storage_key IS the object's public URL, so hand the
           browser straight to it with a 302 rather than proxying the bytes, and
           never put that key in a JSON body.
         - netlify-blobs and the in-memory provider hand back an OPAQUE key with
           nothing to redirect to, so the bytes stream through here. */
      const key = String(row.storage_key);
      if (/^https?:\/\//i.test(key)) {
        res.setHeader("location", key);
        return res.status(302).end("");
      }

      /* No checksum is passed: content_videos has no checksum column
         (db/migrations/171_content.sql), so there is nothing to verify the
         bytes against. Not a bug — a capability the documents path has and this
         one does not. */
      const store = storeFromEnv();
      const object = await store.get(key);
      if (!object) return GONE(res);
      res.setHeader("content-type", row.mime_type || object.contentType || "video/mp4");
      return res.status(200).end(object.body);
    } catch (err) {
      if (dbDown(res, err)) return;
      /* Nobody is signed in on this branch — the signature is the whole
         credential — so the cause goes to the function log and the caller gets
         a code. safeError() strips hosts and connection strings but not
         "permission denied for table content_videos", and that sentence was
         being handed to an anonymous caller. */
      console.error(
        `content/welcome-video: playback failed — ${safeError(err)}` +
        (err && err.code ? ` (code ${err.code})` : "")
      );
      return res.status(500).json({
        ok: false,
        error: "playback_failed",
        message: "The video could not be played right now."
      });
    }
  }

  /* ── METADATA ─────────────────────────────────────────────────────────── */
  const principal = await requirePrincipal(req, res, ["staff", "client"], { db });
  if (!principal) return;

  let orgId = null;
  let clientId = null;

  if (principal.kind === "client") {
    /* ?client_id= IS NOT READ ON THIS BRANCH. A client is pinned to their own
       session, so a lie in the query string is ignored rather than refused —
       there is nothing for it to widen. */
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!clientId || !orgId) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Your login is not attached to a client file."
      });
    }
  } else {
    const staff = principal.staff || { role: principal.role };
    if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
    orgId = staff.org_id || null;
    if (!orgId) {
      return res.status(400).json({ ok: false, error: "org_required" });
    }
    /* Staff may preview a named client's portal, the same way portal-summary
       lets them. Unlike portal-summary a client id is OPTIONAL here: the video
       is an org-level asset and the tier lookup is the only part that would use
       a client, so an advisor can ask "what does the default video look like"
       without picking somebody first. */
    const qid = req.query && req.query.client_id;
    if (qid != null && qid !== "" && !isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "invalid_client_id" });
    }
    clientId = qid || null;
  }

  try {
    /* THE TIER GAP, LEFT IN THE OPEN. tierCodeForClient() always answers null
       today because no rule exists in this codebase — see the header of
       src/content/welcome-video.mjs. Everyone falls through to 'default', and
       tier_reason carries why, so "default" never reads as a decision. */
    const tier = await tierCodeForClient(db, { orgId, clientId });
    const resolved = await resolveWelcomeVideo(db, {
      orgId,
      tierCode: tier.tierCode || DEFAULT_TIER_CODE
    });

    /* A ROW IS NOT A FILE — see the header. Ask the store whether the object is
       still there before handing anybody a link to it. storeFromEnv() can throw
       on an unrecognised DOCUMENT_STORE_PROVIDER, and that is a configuration
       fault, not a reason to fail the whole read: no store means we cannot ask,
       which is FILE_UNKNOWN, which the response states outright. */
    let fileState = FILE_UNKNOWN;
    if (resolved.video) {
      let store = null;
      try {
        store = storeFromEnv();
      } catch (storeErr) {
        console.error(`content/welcome-video: no usable document store — ${safeError(storeErr)}`);
      }
      fileState = await welcomeVideoFileState(db, {
        orgId,
        videoId: resolved.video.id,
        store
      });
    }

    /* redact() as a belt-and-braces guarantee, not because anything below
       carries a storage key: src/http/read-api.mjs strips storage_key,
       storage_path and friends from any shape that reaches it, so this endpoint
       cannot leak one even if the resolver's SELECT list changes later. */
    if (resolved.video && fileState === FILE_MISSING) {
      /* Mapped, but the bytes are gone. The video is dropped rather than
         returned with a link, because the link is the part that is false. The
         reason says which of the two empties this is, so "no video is on
         screen" is never mistaken for "nobody mapped one". */
      return res.status(200).json(redact({
        ok: true,
        video: null,
        reason: "video_file_missing",
        tier_code: tier.tierCode,
        tier_reason: tier.reason
      }));
    }

    return res.status(200).json(redact({
      ok: true,
      video: resolved.video,
      reason: resolved.video && fileState === FILE_UNKNOWN
        ? "video_file_unverified"
        : resolved.reason,
      tier_code: tier.tierCode,
      tier_reason: tier.reason
    }));
  } catch (err) {
    if (dbDown(res, err)) return;

    /* No signing key means the video exists and cannot be linked. That is our
       misconfiguration, so it gets the 503 api/documents/[id].mjs gives it and
       not a 500 that reads like the database broke. The `message` is what stops
       public/app/data.js printing "The database is not reachable right now."
       over every 503 it sees — see the same note on the playback branch. */
    if (err && err.code === NO_URL_SECRET) {
      return res.status(503).json({
        ok: false,
        error: "not_configured",
        message: "The welcome video cannot be linked right now. The key we use to sign video links is not set up."
      });
    }

    /* A database that is one migration behind has no content_videos table.
       api/content/tiles.mjs swallows that case because the Content screen has
       other things to show; this endpoint has nothing else to show, so it
       answers honestly rather than pretending no video was ever mapped.

       `detail` IS FOR STAFF ONLY. safeError() scrubs connection strings, hosts
       and IPs — it does not scrub the rest, so "permission denied for table
       content_videos" travels through it intact. api/content/tiles.mjs may hand
       that to its caller because only an owner or admin can reach it. This
       endpoint serves CLIENTS, so the cause goes to the function log and the
       client gets the sentence and nothing else. */
    console.error(
      `content/welcome-video: read failed — ${safeError(err)}` +
      (err && err.code ? ` (code ${err.code})` : "")
    );
    const body = {
      ok: false,
      error: "read_failed",
      message: "Something went wrong loading the welcome video."
    };
    if (principal.kind === "staff") body.detail = safeError(err);
    return res.status(500).json(body);
  }
}
