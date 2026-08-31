// The fixture-backed vendor adapter. The only one that runs today.
//
// docs/specs/W2-creative-intelligence.md §6.3.
//
// This is NOT a stub. It is a real adapter over a recorded payload: it filters
// by platform and advertiser exactly as a live one would, it reports a vendor
// run id, it reports cost in integer cents, and it returns the same normalised
// observation shape. Everything downstream — dedup, classification, all ten
// signals, the Winner Score, the saturation map, the board endpoint and the
// screen — is fully exercisable against it with no vendor key and no network.
//
// WHEN A REAL KEY EXISTS. The live adapter owns the HTTP call and therefore
// belongs under src/messaging/providers/ (CLAUDE.md §12 — outbound transmission
// is permitted there and nowhere else). It maps its payload through
// toObservation() and registers in ../index.mjs. Nothing in Layer 2 changes.
// See the header of ../index.mjs for why the conflict is reported rather than
// worked around.
//
// THE FIXTURE IS DELIBERATELY UNFLATTERING. It contains an ad with a banned
// claim, an ad with no landing page, an ad with a missing headline, a
// re-launched creative and one that went dark. A fixture where everything is
// clean tests nothing — the interesting paths in Layer 2 are all the ones where
// something is absent or something is wrong.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { toObservation } from "./observation.mjs";

export const VENDOR_KEY = "fixture";

const FIXTURE_URL = new URL("./fixtures/funding-vertical.json", import.meta.url);

let _cache = null;

/* loadFixture() → the recorded rows. Cached because ingest reads it once per
   platform per run and re-reading the file four times is pointless work. */
export function loadFixture(path = null) {
  if (path) return JSON.parse(readFileSync(path, "utf8"));
  if (!_cache) _cache = JSON.parse(readFileSync(fileURLToPath(FIXTURE_URL), "utf8"));
  return _cache;
}

export function clearFixtureCache() { _cache = null; }

/* pull(request, ctx) → { observations, vendor, vendorRunId, costCents }

   request: { platform, advertisers?, observedOn? }
     platform    — required; one of meta/google/youtube/tiktok
     advertisers — optional allow-list of external advertiser ids. Omitted means
                   every advertiser in the fixture, which is what a first pull
                   against an empty watch-list does.
     observedOn  — the calendar day being recorded. Defaults to today.

   ctx: { fixture?, now? } — injection points, so a test can hand in its own
   recorded payload without writing a file. There is deliberately NO fetch in
   this signature: an adapter here never transmits. */
export async function pull(request = {}, ctx = {}) {
  const platform = String(request.platform || "").trim().toLowerCase();
  if (!platform) throw new Error("fixture adapter: platform is required");

  const rows = ctx.fixture ? ctx.fixture : loadFixture(ctx.fixturePath || null);
  if (!Array.isArray(rows)) {
    throw new Error("fixture adapter: fixture must be an array of vendor rows");
  }

  const wanted = Array.isArray(request.advertisers) && request.advertisers.length
    ? new Set(request.advertisers.map((a) => String(a)))
    : null;

  const observedOn = request.observedOn || null;

  const observations = rows
    .filter((r) => String(r.platform).toLowerCase() === platform)
    .filter((r) => !wanted || wanted.has(String(r.advertiser_id)))
    // A recorded row may name the day it was observed; a caller may override it
    // to replay a week. The caller wins, because replaying a backfill is the one
    // case where the recorded date is the wrong answer.
    .map((r) => toObservation({ ...r, observedOn: observedOn || r.observed_on }));

  return {
    observations,
    vendor: VENDOR_KEY,
    vendorRunId: `fixture-${platform}-${observedOn || "recorded"}`,
    // Zero, and zero is the true figure here — a file read costs nothing. This
    // is the one adapter where 0 is a measurement rather than a missing value.
    costCents: 0
  };
}
