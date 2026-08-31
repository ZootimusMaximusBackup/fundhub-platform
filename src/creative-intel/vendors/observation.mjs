// The normalised observation — the one shape every vendor adapter must return.
//
// docs/specs/W2-creative-intelligence.md §6.7.
//
// WHY NORMALISATION HAPPENS IN THE ADAPTER AND NOT IN THE INGEST JOB. Apify's
// Meta scraper, Apify's Google Transparency scraper, TikTok's Creative Center
// and AdLibrary.com return four different payloads for the same idea. If the
// ingest job did the mapping, it would carry a branch per vendor and swapping
// vendors would mean editing the ingest job. Instead each adapter maps its own
// payload into this shape and the ingest job knows exactly one shape.
//
// THE RAW PAYLOAD IS CARRIED THROUGH UNTOUCHED alongside the mapped fields.
// A signal we have not thought of yet is a re-read of `raw`, not a second
// purchase of the same month of data.

import { contentHash, destinationDomain, stripTracking } from "../hash.mjs";
import { OBSERVED_PLATFORMS } from "../taxonomy.mjs";

const MEDIA_KINDS = new Set(["image", "video", "carousel"]);

/* toObservation(input) → the normalised row, or throws.

   Throws rather than returning a partial row for the two fields nothing
   downstream can work without: the platform and the external ad id. Everything
   else is allowed to be missing and stays NULL — a vendor that did not return a
   headline has told us nothing about the headline, and inventing an empty
   string would make "no headline" and "an empty headline" the same fact. */
export function toObservation(input = {}) {
  const platform = String(input.platform || "").trim().toLowerCase();
  if (!OBSERVED_PLATFORMS.includes(platform)) {
    throw new Error(
      `observation: platform "${input.platform}" is not one of ${OBSERVED_PLATFORMS.join(", ")}`
    );
  }
  const externalAdId = str(input.externalAdId ?? input.external_ad_id);
  if (!externalAdId) throw new Error("observation: externalAdId is required");

  const advertiserId = str(input.advertiserId ?? input.advertiser_id);
  if (!advertiserId) throw new Error("observation: advertiserId is required");

  const destinationUrl = stripTracking(input.destinationUrl ?? input.destination_url);
  const bodyText = str(input.bodyText ?? input.body_text);
  const headline = str(input.headline);
  const mediaUrl = str(input.mediaUrl ?? input.media_url);

  const mediaKindRaw = str(input.mediaKind ?? input.media_kind);
  const mediaKind = mediaKindRaw && MEDIA_KINDS.has(mediaKindRaw.toLowerCase())
    ? mediaKindRaw.toLowerCase()
    : null;

  return {
    platform,
    externalAdId,
    advertiserId,
    observedOn: isoDate(input.observedOn ?? input.observed_on),
    // The vendor's own idea of when it first saw the ad. NOT derived from our
    // own observation log — that derivation is signals.mjs's job, and doing it
    // in two places is how the two answers start to disagree.
    firstSeenAt: isoTimestamp(input.firstSeenAt ?? input.first_seen_at),
    lastSeenAt: isoTimestamp(input.lastSeenAt ?? input.last_seen_at),
    bodyText: bodyText || null,
    headline: headline || null,
    cta: str(input.cta) || null,
    destinationUrl,
    destinationDomain: destinationDomain(input.destinationUrl ?? input.destination_url),
    mediaKind,
    mediaUrl: mediaUrl || null,
    placements: uniqueStrings(input.placements),
    // Ordinal, never a number. TikTok publishes buckets and there is no way to
    // turn a bucket into a rate — see §16 item 2.
    tiktokPerfBucket: bucket(input.tiktokPerfBucket ?? input.tiktok_perf_bucket),
    raw: input.raw && typeof input.raw === "object" ? input.raw : {},
    contentHash: contentHash({ bodyText, headline, mediaUrl })
  };
}

function str(v) {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function uniqueStrings(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map((x) => str(x)).filter(Boolean))].sort();
}

function bucket(v) {
  const s = str(v).toLowerCase();
  return s === "high" || s === "medium" || s === "low" ? s : null;
}

/* isoDate — a calendar day, because observed_on is a date column and the whole
   observation log is keyed on it. A timestamp here would make the same pull run
   twice in one day insert two rows and break the idempotency key. */
export function isoDate(v) {
  if (!v) return new Date().toISOString().slice(0, 10);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new Error(`observation: bad observedOn "${v}"`);
  return d.toISOString().slice(0, 10);
}

function isoTimestamp(v) {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
