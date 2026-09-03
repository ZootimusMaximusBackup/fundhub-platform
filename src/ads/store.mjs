// src/ads/store.mjs — write and read the client_ad_attribution row (286).
//
// The writer stores RAW UTMs only. lane / ad_id / variant are generated columns
// in the database; nothing here computes them. First touch wins: on a second
// capture for the same client, each column keeps its existing value and only
// fills a blank (COALESCE(existing, new)).

const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_path", "referrer_domain"];

function clean(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, 512) : null;
}

/** Upsert the row. Returns the stored row (with derived columns) or null when there was nothing to store. */
export async function upsertClientAdAttribution(db, { orgId, clientId, attribution }) {
  if (!orgId || !clientId || !attribution || typeof attribution !== "object") return null;
  const vals = KEYS.map((k) => clean(attribution[k]));
  if (!vals.some(Boolean)) return null;
  const r = await db.query(
    `INSERT INTO client_ad_attribution
       (client_id, org_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, landing_path, referrer_domain)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (client_id) DO UPDATE SET
       utm_source      = COALESCE(client_ad_attribution.utm_source,      EXCLUDED.utm_source),
       utm_medium      = COALESCE(client_ad_attribution.utm_medium,      EXCLUDED.utm_medium),
       utm_campaign    = COALESCE(client_ad_attribution.utm_campaign,    EXCLUDED.utm_campaign),
       utm_content     = COALESCE(client_ad_attribution.utm_content,     EXCLUDED.utm_content),
       utm_term        = COALESCE(client_ad_attribution.utm_term,        EXCLUDED.utm_term),
       landing_path    = COALESCE(client_ad_attribution.landing_path,    EXCLUDED.landing_path),
       referrer_domain = COALESCE(client_ad_attribution.referrer_domain, EXCLUDED.referrer_domain),
       updated_at      = now()
     RETURNING client_id, org_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
               landing_path, referrer_domain, lane::text AS lane, ad_id, variant, captured_at, updated_at`,
    [clientId, orgId, ...vals]
  );
  return r.rows[0] || null;
}

/** One client's row, org-bound. null when the client has no attribution row. */
export async function readClientAdAttribution(db, { orgId, clientId }) {
  if (!orgId || !clientId) return null;
  const r = await db.query(
    `SELECT client_id, org_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
            landing_path, referrer_domain, lane::text AS lane, ad_id, variant, captured_at, updated_at
       FROM client_ad_attribution
      WHERE org_id = $1 AND client_id = $2`,
    [orgId, clientId]
  );
  return r.rows[0] || null;
}

/* Leads and bookings per (lane, ad_id, variant), org-bound, optionally windowed
   on the lead's capture time. A cancelled booking is not a booked call. Leads
   are DISTINCT clients so a client with two bookings still counts once. */
export async function adAttributionRollup(db, { orgId, from = null, to = null }) {
  if (!orgId) return [];
  const r = await db.query(
    `SELECT a.lane::text AS lane, a.ad_id, a.variant,
            count(DISTINCT a.client_id)::int AS leads,
            min(a.captured_at) AS first_lead_at,
            max(a.captured_at) AS last_lead_at,
            count(b.id)::int AS books,
            min(b.created_at) AS first_book_at,
            max(b.created_at) AS last_book_at
       FROM client_ad_attribution a
       LEFT JOIN bookings b
         ON b.client_id = a.client_id AND b.org_id = a.org_id
        AND b.status IS DISTINCT FROM 'cancelled'
      WHERE a.org_id = $1
        AND ($2::timestamptz IS NULL OR a.captured_at >= $2::timestamptz)
        AND ($3::timestamptz IS NULL OR a.captured_at <  $3::timestamptz)
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3`,
    [orgId, from, to]
  );
  return r.rows;
}
