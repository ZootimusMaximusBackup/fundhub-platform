// GHL LeadConnector contact resolution — find-or-create the GHL contact a
// fundhub client maps to, so the ghl_relay SMS provider
// (./providers/ghl-relay.mjs) has a `clients.ghl_contact_id` to address
// (db/schema/001_init.sql:47 is where that column already lives).
//
// THIS FILE MAKES OUTBOUND HTTP CALLS, on purpose and within the rule that
// confines that to src/messaging/providers/*. ghl-contacts.mjs sits next to
// providers/, not inside src/lib or src/handlers, for the same reason
// providers/http.mjs exists: contact resolution against GHL is a live network
// call to the same LeadConnector API the SMS provider already speaks to, not a
// domain read.
//
// CONFIGURATION, read at call time — NEVER cached at import time:
//   GHL_API_KEY          preferred name (the one asked for)
//   GHL_RELAY_API_KEY    the existing name providers/ghl-relay.mjs already
//                         reads for sending; accepted as a fallback so one key
//                         covers both send and contact lookup until the newer
//                         name is set everywhere
//   GHL_BASE_URL / GHL_RELAY_BASE_URL   optional; default to LeadConnector
//   GHL_VERSION / GHL_RELAY_VERSION     optional; default to "2021-07-28"
//   GHL_LOCATION_ID       optional; some LeadConnector accounts require a
//                         locationId on contact create
//
// Nothing here invents a credential. With neither key set, config() reports
// not-configured and every exported function returns
// { ok:false, reason:"not_configured" } rather than throwing — a client that
// never gets a GHL contact id simply cannot receive SMS through ghl_relay yet.

export const DEFAULT_BASE_URL = "https://services.leadconnectorhq.com";
export const DEFAULT_VERSION = "2021-07-28";

/** config(env) → { ok, apiKey, baseUrl, version } | { ok:false, missing } */
export function config(env = process.env) {
  const apiKey = env.GHL_API_KEY || env.GHL_RELAY_API_KEY;
  if (!apiKey) return { ok: false, missing: ["GHL_API_KEY", "GHL_RELAY_API_KEY"] };
  return {
    ok: true,
    apiKey,
    baseUrl: String(env.GHL_BASE_URL || env.GHL_RELAY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    version: String(env.GHL_VERSION || env.GHL_RELAY_VERSION || DEFAULT_VERSION)
  };
}

async function readJson(res) {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

/**
 * findOrCreateGhlContact({ email, phone, firstName, lastName, locationId }, { fetchImpl, env })
 * → { ok:true, contactId, created } | { ok:false, reason }
 *
 * Tries GHL's v2 upsert first — POST /contacts/upsert, which LeadConnector
 * documents as create-or-return-existing keyed on email/phone. Falls back to
 * search-then-create (GET /contacts/?email=... then POST /contacts/) if
 * upsert 404s or 405s on a deployment where that route is unavailable.
 *
 * NEVER THROWS. `fetchImpl` is the test seam, same contract as
 * providers/http.mjs; a caller that supplies none gets globalThis.fetch.
 */
export async function findOrCreateGhlContact(
  { email, phone, firstName, lastName, locationId } = {},
  { fetchImpl, env = process.env } = {}
) {
  const cfg = config(env);
  if (!cfg.ok) return { ok: false, reason: "not_configured" };

  const cleanEmail = email ? String(email).trim().toLowerCase() : null;
  const cleanPhone = phone ? String(phone).trim() : null;
  if (!cleanEmail && !cleanPhone) return { ok: false, reason: "no_identifier" };

  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== "function") return { ok: false, reason: "no_fetch_implementation" };

  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    Version: cfg.version,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  const loc = locationId || env.GHL_LOCATION_ID || undefined;
  const upsertBody = {
    ...(cleanEmail ? { email: cleanEmail } : {}),
    ...(cleanPhone ? { phone: cleanPhone } : {}),
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(loc ? { locationId: loc } : {})
  };

  try {
    const res = await fetchFn(`${cfg.baseUrl}/contacts/upsert`, {
      method: "POST",
      headers,
      body: JSON.stringify(upsertBody)
    });

    if (res.ok) {
      const parsed = await readJson(res);
      const contact = parsed?.contact || parsed || {};
      const id = contact.id || parsed?.id;
      if (!id) return { ok: false, reason: "no_contact_id_in_response" };
      return { ok: true, contactId: String(id), created: contact.new === true || parsed?.new === true };
    }

    // Upsert not available on this account/deployment — fall back.
    if (res.status === 404 || res.status === 405) {
      return await searchThenCreate(
        { email: cleanEmail, phone: cleanPhone, firstName, lastName, locationId: loc },
        { fetchFn, headers, baseUrl: cfg.baseUrl }
      );
    }
    return { ok: false, reason: `upsert_http_${res.status}` };
  } catch (err) {
    return { ok: false, reason: `request_failed: ${String((err && err.message) || err)}` };
  }
}

async function searchThenCreate({ email, phone, firstName, lastName, locationId }, { fetchFn, headers, baseUrl }) {
  try {
    if (email) {
      const qs = new URLSearchParams({ email });
      const searchRes = await fetchFn(`${baseUrl}/contacts/?${qs.toString()}`, { method: "GET", headers });
      if (searchRes.ok) {
        const parsed = await readJson(searchRes);
        const found = Array.isArray(parsed?.contacts) ? parsed.contacts[0] : null;
        if (found?.id) return { ok: true, contactId: String(found.id), created: false };
      }
    }

    const createBody = {
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(firstName ? { firstName } : {}),
      ...(lastName ? { lastName } : {}),
      ...(locationId ? { locationId } : {})
    };
    const createRes = await fetchFn(`${baseUrl}/contacts/`, { method: "POST", headers, body: JSON.stringify(createBody) });
    if (!createRes.ok) return { ok: false, reason: `create_http_${createRes.status}` };
    const parsed = await readJson(createRes);
    const id = parsed?.contact?.id || parsed?.id;
    if (!id) return { ok: false, reason: "no_contact_id_in_response" };
    return { ok: true, contactId: String(id), created: true };
  } catch (err) {
    return { ok: false, reason: `request_failed: ${String((err && err.message) || err)}` };
  }
}

/**
 * ensureGhlContactId(db, clientRow, opts) — find-or-create a GHL contact for
 * one stored `clients` row and, unless `opts.dryRun`, persist the id to
 * clients.ghl_contact_id. Shared by:
 *   - src/handlers/client-lifecycle.mjs (resolveClient, right after a new
 *     client is inserted, when the org's sms routing is ghl_relay)
 *   - scripts/backfill-ghl-contact-ids.mjs (bulk backfill; dryRun by default)
 *
 * @param {object} clientRow  { id, email, phone, first_name, last_name }
 * @param {object} opts       { fetchImpl, env, dryRun = false }
 * @returns {object} { ok:true, contactId, created, updated } | { ok:false, reason }
 *
 * NEVER THROWS. A GHL failure must not be mistaken for a failed client write —
 * callers wrap nothing extra around this on purpose.
 */
export async function ensureGhlContactId(db, clientRow = {}, opts = {}) {
  const { fetchImpl, env = process.env, dryRun = false } = opts;
  try {
    const email = clientRow.email ? String(clientRow.email).trim().toLowerCase() : null;
    const phone = clientRow.phone || null;
    if (!email && !phone) return { ok: false, reason: "no_identifier" };

    const result = await findOrCreateGhlContact(
      { email, phone, firstName: clientRow.first_name || null, lastName: clientRow.last_name || null },
      { fetchImpl, env }
    );
    if (!result.ok) return result;

    if (!dryRun && clientRow.id) {
      await db.query(`UPDATE clients SET ghl_contact_id = $1 WHERE id = $2`, [result.contactId, clientRow.id]);
    }
    return { ok: true, contactId: result.contactId, created: Boolean(result.created), updated: !dryRun };
  } catch (err) {
    // Belt-and-suspenders: findOrCreateGhlContact and the UPDATE above are
    // already guarded, but a caller relying on "this never throws" must be
    // right even if a future edit adds a path that can.
    return { ok: false, reason: `unexpected_error: ${String((err && err.message) || err)}` };
  }
}

export default findOrCreateGhlContact;
