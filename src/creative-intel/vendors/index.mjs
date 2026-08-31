// LAYER 1 — the vendor adapter interface, and the registry that selects one.
//
// docs/specs/W2-creative-intelligence.md §6.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RULE THAT SHAPES THIS WHOLE DIRECTORY
//
// FUNDHUB DOES NOT SCRAPE. Vendors scrape; FundHub buys rows. The vendor
// carries the terms-of-service risk. This is not a technical preference — the
// business runs on Meta and Google ad accounts, and scraping either from
// FundHub infrastructure is how those accounts die. There is no adapter in this
// directory that opens a socket to facebook.com or google.com, and adding one
// would be the single most expensive line of code anyone could write here.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THE ONLY ADAPTER THAT SHIPS TODAY IS FIXTURE-BACKED
//
// Two reasons, and only the first is about testing.
//
//   1. NO VENDOR KEY EXISTS. Not for Apify, not for AdLibrary.com. Building
//      against a key nobody has means building against an imagined payload.
//      The fixture adapter is a real adapter over a real (recorded) payload
//      shape, so Layer 2 — which is the product — is fully exercisable now.
//
//   2. THE TRANSMISSION RULE. CLAUDE.md §12: outbound transmission is permitted
//      in src/messaging/providers/* and NOWHERE ELSE. A live vendor adapter
//      makes an outbound HTTP call, so it cannot live in this directory as
//      written. That is a real conflict between this spec and a hard repo rule,
//      and it is REPORTED rather than quietly broken.
//
//      The shape below is what resolves it without anyone having to redesign
//      later: an adapter receives its transport by INJECTION and never reaches
//      for fetch itself. When a key exists, the live adapter is a module under
//      src/messaging/providers/ that owns the fetch, and the thing registered
//      here is the thin mapper that turns its payload into observations. The
//      config swap is one row; no Layer 2 code changes.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE INTERFACE — ONE SHAPE, N IMPLEMENTATIONS
//
//   pull(request, ctx) -> { observations: [...], vendor, vendorRunId, costCents }
//
// where a request is { orgId, platform, advertisers: [...], observedOn } and an
// observation is the normalised shape in observation.mjs. Nothing about which
// vendor answered leaks past this boundary — the moment the ingest job branches
// on a vendor name, swapping vendors becomes an edit to the ingest job instead
// of a config change, which is the exact thing this interface exists to prevent.
//
// COST IS REPORTED IN INTEGER CENTS, per CLAUDE.md §12, and NULL is a legal
// answer meaning "this vendor did not tell us". It must not become 0 — a free
// tier and an unknown bill are different facts.

import * as fixture from "./fixture.mjs";

const MODULES = {
  fixture
};

export const VENDOR_KEYS = Object.freeze(Object.keys(MODULES));

/* The vendors named in §6.3, with the rate research the spec carried. Recorded
   as data so the cost model in the spec is checkable against code rather than
   living only in a document.

   PRICING IS UNVERIFIED. §16 item 4 says so plainly: these rates came from
   prior research and were not re-checked against a vendor pricing page. They
   are here to make a cost estimate reproducible, not to be trusted as an
   invoice. `implemented: false` is the honest state of every live one. */
export const VENDOR_CATALOG = Object.freeze([
  Object.freeze({
    key: "apify-meta",
    label: "Apify — Meta Ads Library Scraper",
    platforms: Object.freeze(["meta"]),
    ratePerThousandCents: 150,
    implemented: false,
    note: "US commercial creative. Never spend — nobody publishes competitor spend."
  }),
  Object.freeze({
    key: "apify-google-transparency",
    label: "Apify — Google Transparency",
    platforms: Object.freeze(["google", "youtube"]),
    ratePerThousandCents: 45,
    implemented: false,
    note: "Google has no official commercial Transparency Center API."
  }),
  Object.freeze({
    key: "tiktok-creative-center",
    label: "TikTok Creative Center",
    platforms: Object.freeze(["tiktok"]),
    ratePerThousandCents: 0,
    implemented: false,
    note: "Free. Gives ordinal CTR/CVR buckets only — high/medium/low, never a rate."
  }),
  Object.freeze({
    key: "adlibrary-rest",
    label: "AdLibrary.com REST",
    platforms: Object.freeze(["meta", "tiktok", "youtube", "google"]),
    ratePerThousandCents: null,
    implemented: false,
    note: "Backfill and gap-fill. Free tier first; paid rate not established."
  }),
  Object.freeze({
    key: "fixture",
    label: "Recorded fixtures (no network)",
    platforms: Object.freeze(["meta", "google", "youtube", "tiktok"]),
    ratePerThousandCents: 0,
    implemented: true,
    note: "The only adapter that runs today. No vendor key exists for any of the others."
  })
]);

/* estimateMonthlyCostCents({ recordsByVendorKey })

   §6.4's arithmetic, in integer cents, so the "$60/month" figure in the spec can
   be re-derived instead of quoted. A vendor with a NULL rate contributes NULL —
   the total becomes unknown rather than silently under-stated, which is the
   whole point of NULL surviving. */
export function estimateMonthlyCostCents(recordsByVendorKey = {}) {
  let total = 0;
  let unknown = false;
  for (const [key, records] of Object.entries(recordsByVendorKey)) {
    const vendor = VENDOR_CATALOG.find((v) => v.key === key);
    if (!vendor) throw new Error(`estimateMonthlyCostCents: unknown vendor "${key}"`);
    if (vendor.ratePerThousandCents === null) { unknown = true; continue; }
    // Integer cents throughout. Rounded up: a partial thousand is still billed.
    total += Math.ceil((Number(records) / 1000) * vendor.ratePerThousandCents);
  }
  return unknown ? null : total;
}

/* resolve({ vendorKey }) → { key, module }

   Throws when the key names nothing. Deliberately not a default: falling back to
   some arbitrary vendor would spend money at a supplier nobody chose. Same
   posture as src/creative/providers/index.mjs. */
export function resolve({ vendorKey } = {}) {
  const key = String(vendorKey || "").trim();
  const mod = MODULES[key];
  if (!mod) {
    throw new Error(
      `no vendor adapter registered for "${key}". Known: ${VENDOR_KEYS.join(", ")}. ` +
      `Live adapters are not built — no vendor key exists yet (W2 §6.3).`
    );
  }
  return { key, module: mod };
}

/* assertAdapter — the shape check, run in tests rather than at import time so a
   half-written adapter fails in CI rather than at 3am. Mirrors
   src/creative/providers/index.mjs's assertAdapter for the same reason. */
export function assertAdapter(mod, name) {
  if (typeof mod.pull !== "function") {
    throw new Error(`vendor adapter ${name} must export pull(request, ctx)`);
  }
  return true;
}

export { MODULES };
