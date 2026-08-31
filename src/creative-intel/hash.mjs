// The content hash, and the URL/domain normalisation the signals depend on.
//
// docs/specs/W2-creative-intelligence.md §6.7.
//
// ONE HASH, COMPUTED IN ONE PLACE. The hash is the dedup key, the classifier
// cache key, and the join key for every signal that asks "is this the same
// creative as last week". Two implementations of it that disagree by one
// trimmed space would silently double the classification bill and break the
// re-launch and death-watch signals at the same time, and nothing would report
// either. So it is here, once.
//
// NORMALISATION IS DELIBERATELY AGGRESSIVE on whitespace and case, and
// deliberately CONSERVATIVE on everything else. Advertisers re-upload the same
// creative with a different trailing newline constantly; they do not re-upload
// it with a different dollar figure and mean the same ad.

import { createHash } from "node:crypto";

/* Tracking parameters stripped before a destination URL is hashed. Landing-page
   change detection (signal 6) is about the PAGE changing, not about the ad
   platform appending a fresh click id — leaving these in would report a change
   on every single observation and the signal would mean nothing. */
export const TRACKING_PARAMS = Object.freeze([
  "fbclid", "gclid", "ttclid", "msclkid", "igshid", "twclid", "wbraid", "gbraid",
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "utm_id",
  "ref", "referrer", "mc_cid", "mc_eid", "_ga", "yclid", "epik", "li_fat_id"
]);

/* normaliseText — lowercase, collapse whitespace, strip zero-width characters.

   Zero-width joiners and non-breaking spaces are what a copy-paste out of a
   design tool leaves behind, and they are invisible in every diff, so a creative
   that is byte-different and visually identical is common. */
export function normaliseText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/* stripTracking(url) → url without the tracking parameters, or null.

   Returns null for input that is not a URL rather than throwing or echoing the
   garbage back: a vendor row with a malformed destination is a fact about the
   vendor, and the caller stores NULL for it, which is honest. */
export function stripTracking(rawUrl) {
  if (!rawUrl) return null;
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    return null;
  }
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
  u.hash = "";
  // Sorted so two URLs differing only in parameter order hash the same. An ad
  // platform does not guarantee ordering and neither does a vendor's parser.
  u.searchParams.sort();
  const qs = u.searchParams.toString();
  const path = u.pathname.replace(/\/+$/, "") || "/";
  return `${u.protocol}//${u.host.toLowerCase()}${path}${qs ? "?" + qs : ""}`;
}

/* destinationDomain(url) → registrable-ish host, or null.

   `www.` is dropped because it is never a different advertiser. Nothing deeper
   is attempted — a public-suffix list is a dependency, and CLAUDE.md §8 says no
   new dependencies without asking. A subdomain therefore counts as its own
   domain here, which over-splits rather than over-merges. Over-splitting shows
   two competitors where there is one; over-merging would hide one entirely. */
export function destinationDomain(rawUrl) {
  if (!rawUrl) return null;
  try {
    return new URL(String(rawUrl)).host.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/* contentHash({ bodyText, headline, mediaUrl }) → 64-char hex

   The three fields the spec names, in a fixed order, separated by a byte that
   cannot appear in normalised text. Without the separator, ("ab", "c") and
   ("a", "bc") would hash the same. */
export function contentHash({ bodyText = "", headline = "", mediaUrl = "" } = {}) {
  const parts = [
    normaliseText(bodyText),
    normaliseText(headline),
    // The media URL is normalised for tracking parameters but NOT lowercased
    // beyond the host: CDN paths are case-sensitive and two different assets can
    // differ only in the case of a path segment.
    stripTracking(mediaUrl) || normaliseText(mediaUrl)
  ];
  return createHash("sha256").update(parts.join("\u001f")).digest("hex");
}
