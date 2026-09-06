// The client's identity of record — the name, address and date of birth that a
// document actually proved.
//
// WHY THIS EXISTS. The dispute letters used to name the client from
// clients.first_name + clients.last_name, which a closer types during a sales
// call and which carries no middle name, and to address them from
// pii_identity.addresses[0], the first element of a jsonb array nothing
// validates. Neither was ever checked against a document. That is how a letter
// once asserted a client's business address was their home address.
//
// The DOC-CHECK agent reads the government ID and the proof of address, and it
// is the only thing in the system that ever sees them. What it copies out of
// those images lands here, with the document version it came from, and this is
// what the letters quote.
//
// THE RULE THIS MODULE ENFORCES: nothing is written that the agent did not
// return. A field it did not report stays NULL, and NULL means "no document has
// proved this yet" — never zero, never blank, never a value borrowed from a
// different field. A letter must not assert something no document supports.

const FIELDS = Object.freeze(["legal_name", "address", "date_of_birth"]);

export const EMPTY_IDENTITY = Object.freeze({
  legalName: null,
  address: null,
  dateOfBirth: null,
  source: null,
  verifiedAt: null,
  fieldSources: Object.freeze({})
});

function cleanString(value) {
  if (value == null) return null;
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  // Models answer "null", "N/A" or "not shown" when a field is absent. Those are
  // absences written as words, not values.
  if (/^(null|none|n\/a|na|unknown|not shown|not visible|not legible|not applicable|[-–—]{1,3})$/i.test(s)) {
    return null;
  }
  return s;
}

/** A date of birth is only useful if it is unambiguous. Accepts YYYY-MM-DD and
 *  MM/DD/YYYY (what a US ID prints). Anything else — a two-digit year, a month
 *  name, a partial date — is NULL, because guessing which half is the month is
 *  how a letter ends up asserting the wrong person's birthday. */
export function normalizeDateOfBirth(raw) {
  const s = cleanString(raw);
  if (!s) return null;
  let y;
  let m;
  let d;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso) {
    [, y, m, d] = iso;
  } else if (us) {
    [, m, d, y] = us;
  } else {
    return null;
  }
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2100) return null;
  const iso8601 = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // Reject a day that does not exist in that month (2026-02-31).
  const probe = new Date(`${iso8601}T00:00:00Z`);
  if (Number.isNaN(probe.getTime()) || probe.getUTCDate() !== day || probe.getUTCMonth() + 1 !== month) {
    return null;
  }
  return iso8601;
}

/** The address as the document printed it. Keeps the parts it was given and
 *  nothing else: a missing city stays missing rather than being filled from the
 *  client record. A model that answers with one string keeps that string in
 *  `formatted` with the parts left null — an unparsed address is still an
 *  honest one, an invented parse is not. */
export function normalizeVerifiedAddress(raw) {
  if (raw == null) return null;
  if (typeof raw === "string") {
    const formatted = cleanString(raw);
    if (!formatted) return null;
    return { line1: null, line2: null, city: null, state: null, zip: null, formatted };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;

  const line1 = cleanString(raw.line1 ?? raw.street ?? raw.address_line1 ?? raw.line_1);
  const line2 = cleanString(raw.line2 ?? raw.unit ?? raw.address_line2 ?? raw.line_2);
  const city = cleanString(raw.city);
  const stateRaw = cleanString(raw.state ?? raw.province);
  const state = stateRaw && /^[A-Za-z]{2}$/.test(stateRaw) ? stateRaw.toUpperCase() : stateRaw;
  const zip = cleanString(raw.zip ?? raw.postal_code ?? raw.zipcode ?? raw.postcode);
  const given = cleanString(raw.formatted ?? raw.full ?? raw.text);

  if (!line1 && !line2 && !city && !state && !zip && !given) return null;

  const parts = [
    [line1, line2].filter(Boolean).join(" "),
    [city, state].filter(Boolean).join(", "),
    zip
  ].filter(Boolean);
  return {
    line1,
    line2,
    city,
    state,
    zip,
    formatted: given || (parts.length ? parts.join(" ") : null)
  };
}

/** One printable line, for a letter or a screen. Null when nothing is proved. */
export function formatVerifiedAddress(address) {
  if (!address || typeof address !== "object") return null;
  if (address.formatted) return String(address.formatted);
  const parts = [
    [address.line1, address.line2].filter(Boolean).join(" "),
    [address.city, address.state].filter(Boolean).join(", "),
    address.zip
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** Pull the three verified fields out of whatever JSON the agent returned.
 *  Every key it might have used, and nothing else — a value that is not one of
 *  these three fields never becomes one of them. */
export function extractVerifiedIdentity(json) {
  const j = json && typeof json === "object" ? json : {};
  return {
    legalName: cleanString(j.verified_legal_name ?? j.verifiedLegalName ?? j.legal_name),
    address: normalizeVerifiedAddress(j.verified_address ?? j.verifiedAddress ?? j.address ?? null),
    dateOfBirth: normalizeDateOfBirth(
      j.verified_date_of_birth ?? j.verifiedDateOfBirth ?? j.verified_dob ?? j.date_of_birth
    )
  };
}

function provenance({ agent, documentId, versionId, at }) {
  return {
    document_id: documentId || null,
    document_version_id: versionId || null,
    agent: agent || null,
    at
  };
}

/**
 * recordVerifiedIdentity — write what a document proved, and only that.
 *
 * Called on an accept. A field the agent left out is not written and does not
 * erase a value an earlier document proved: a driving licence proves the name
 * and the date of birth, a utility bill proves the current address, and the two
 * uploads land minutes apart. Each field keeps its own provenance so "which
 * document proved this" has an answer per field rather than per row.
 *
 * Returns { written:false, reason:"nothing_verified" } when the agent returned
 * none of the three. Nothing is written in that case — not a blank, not a zero.
 */
export async function recordVerifiedIdentity(db, {
  orgId,
  clientId,
  documentId = null,
  versionId = null,
  agent = null,
  legalName = null,
  address = null,
  dateOfBirth = null,
  now = null
} = {}) {
  if (!db || !orgId || !clientId) {
    return { written: false, reason: "missing_ids" };
  }
  const name = cleanString(legalName);
  const addr = normalizeVerifiedAddress(address);
  const dob = normalizeDateOfBirth(dateOfBirth);
  if (!name && !addr && !dob) {
    return { written: false, reason: "nothing_verified" };
  }

  const at = (now instanceof Date ? now : new Date()).toISOString();
  const sources = {};
  if (name) sources.legal_name = provenance({ agent, documentId, versionId, at });
  if (addr) sources.address = provenance({ agent, documentId, versionId, at });
  if (dob) sources.date_of_birth = provenance({ agent, documentId, versionId, at });

  // COALESCE on each field: this upload adds what it proved and leaves the rest
  // as it was. || on verified_field_sources: the same, for the provenance.
  const { rows } = await db.query(
    `INSERT INTO pii_identity (org_id, client_id, verified_legal_name, verified_address,
                               verified_dob, verified_by, verified_at, verified_field_sources)
          VALUES ($1, $2, $3, $4::jsonb, $5::date, $6, $7::timestamptz, $8::jsonb)
     ON CONFLICT (client_id) DO UPDATE SET
       verified_legal_name    = COALESCE(EXCLUDED.verified_legal_name, pii_identity.verified_legal_name),
       verified_address       = COALESCE(EXCLUDED.verified_address, pii_identity.verified_address),
       verified_dob           = COALESCE(EXCLUDED.verified_dob, pii_identity.verified_dob),
       verified_by            = EXCLUDED.verified_by,
       verified_at            = EXCLUDED.verified_at,
       verified_field_sources = COALESCE(pii_identity.verified_field_sources, '{}'::jsonb)
                                  || EXCLUDED.verified_field_sources,
       updated_at             = now()
     RETURNING verified_legal_name, verified_address, verified_dob,
               verified_by, verified_at, verified_field_sources`,
    [
      orgId,
      clientId,
      name,
      addr ? JSON.stringify(addr) : null,
      dob,
      agent || null,
      at,
      JSON.stringify(sources)
    ]
  );

  const row = rows[0] || null;
  return {
    written: true,
    fields: Object.keys(sources),
    identity: row ? rowToIdentity(row) : null
  };
}

function dateToIso(value) {
  if (value == null) return null;
  if (value instanceof Date) {
    // node-postgres parses a `date` column into local midnight, so read the
    // local parts. Reading the UTC parts shifts the birthday by a day west of
    // Greenwich, which is where every client of this business lives.
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  return s ? s.slice(0, 10) : null;
}

function rowToIdentity(row) {
  const sources = row.verified_field_sources && typeof row.verified_field_sources === "object"
    ? row.verified_field_sources
    : {};
  const at = row.verified_at instanceof Date ? row.verified_at.toISOString() : (row.verified_at || null);
  return {
    legalName: cleanString(row.verified_legal_name),
    address: normalizeVerifiedAddress(row.verified_address),
    dateOfBirth: dateToIso(row.verified_dob),
    source: cleanString(row.verified_by),
    verifiedAt: at,
    fieldSources: sources
  };
}

/**
 * verifiedIdentity — the one call the rest of the system makes.
 *
 * Always resolves to the same shape. Every field is null when no document has
 * proved it, and a null here means the caller must not assert that fact. It is
 * never a reason to fall back to clients.first_name or to addresses[0]: those
 * are the values this module exists to stop letters from quoting.
 */
export async function verifiedIdentity(db, { orgId = null, clientId = null } = {}) {
  if (!db || !clientId) return { ...EMPTY_IDENTITY };
  const params = [clientId];
  let where = "client_id = $1";
  if (orgId) {
    params.push(orgId);
    where += ` AND org_id = $${params.length}`;
  }
  const { rows } = await db.query(
    `SELECT verified_legal_name, verified_address, verified_dob,
            verified_by, verified_at, verified_field_sources
       FROM pii_identity
      WHERE ${where}
      LIMIT 1`,
    params
  );
  const row = rows && rows[0];
  if (!row) return { ...EMPTY_IDENTITY };
  return rowToIdentity(row);
}

export const VERIFIED_FIELDS = FIELDS;

export default verifiedIdentity;
