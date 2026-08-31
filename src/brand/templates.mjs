// Funnel page templates for Brand Studio.
//
// Five keys the partner-pages table already allows. Locked legal blocks are
// part of every template and must not be sent to a model or accepted on PATCH.

export const FUNNELS = {
  apply: { title: "Application funnel", slug: "apply" },
  diag: { title: "Diagnostic funnel", slug: "diagnostic" },
  edu: { title: "Education funnel", slug: "education" },
  aff: { title: "Affiliate recruit", slug: "affiliate" },
  book: { title: "Booking funnel", slug: "book" }
};

export function isLockedSection(section) {
  return Boolean(section && section.locked === true);
}

export function legalBlocks(entityName) {
  const name = String(entityName || "This company").trim() || "This company";
  return [
    {
      id: "legal-lender",
      type: "legal",
      locked: true,
      headline: "Not a direct lender",
      text: `${name} is not a direct lender. Financing decisions are made by funding partners.`
    },
    {
      id: "legal-outcomes",
      type: "legal",
      locked: true,
      headline: "No promised outcome",
      text: `${name} does not guarantee approval, a funding amount, a credit-score change, or a timeline.`
    },
    {
      id: "legal-sms",
      type: "legal",
      locked: true,
      headline: "Messages",
      text: "Message and data rates may apply. Reply STOP to opt out and HELP for help."
    },
    /* WHO ACTUALLY PERFORMS THE WORK. The consumer sees this brand; FundHub
       runs the funding and credit services behind it. Telling them so is
       required from day one of a Live Trial (docs/specs/W4-live-trial.md §5.4)
       and is the honest answer on every white-label surface, so it lives in
       legalBlocks rather than in a trial-only template.

       IT IS LOCKED, AND THAT IS THE WHOLE POINT. isLockedSection() above stops
       the AI copywriter reaching it and stops a PATCH from the partner's own
       page editor overwriting it. A disclosure a model can rewrite, or a
       partner can delete, is not a disclosure. generateSectionCopy() in
       src/brand/copy-generate.mjs must never produce this text — the wording is
       fixed, not generated. */
    {
      id: FULFILMENT_DISCLOSURE_ID,
      type: "legal",
      locked: true,
      headline: "Who performs these services",
      text: `Funding and credit services offered here are provided and performed by FundHub. ${name} is an independent marketing partner and is not the provider of these services.`
    }
  ];
}

/** The id of the locked fulfilment disclosure. Exported so a publish path can
    assert the block survived, by id, without matching on prose. */
export const FULFILMENT_DISCLOSURE_ID = "legal-fulfilment";

/** hasFulfilmentDisclosure(body) → boolean.

    True only when the block is present AND still locked. A section that kept
    the id but lost `locked` is an editable disclosure, which is the failure
    this check exists to catch. */
export function hasFulfilmentDisclosure(body) {
  const sections = body && Array.isArray(body.sections) ? body.sections : [];
  return sections.some(
    (s) => s && String(s.id || "") === FULFILMENT_DISCLOSURE_ID && isLockedSection(s) && String(s.text || "").trim() !== ""
  );
}

function unlocked(funnelKey, name) {
  if (funnelKey === "diag") {
    return [
      { id: "hero", type: "hero", locked: false, headline: `See where you stand, ${name}`, sub: "A short review. No promised result." },
      { id: "cta", type: "cta", locked: false, label: "Start the review", href: "#apply" }
    ];
  }
  if (funnelKey === "edu") {
    return [
      { id: "hero", type: "hero", locked: false, headline: `Learn the path with ${name}`, sub: "Two programs. You choose." },
      { id: "program-a", type: "program", locked: false, headline: "Program one", text: "What you will cover in the first track." },
      { id: "program-b", type: "program", locked: false, headline: "Program two", text: "What you will cover in the second track." },
      { id: "cta", type: "cta", locked: false, label: "Ask about enrollment", href: "#apply" }
    ];
  }
  if (funnelKey === "aff") {
    return [
      { id: "hero", type: "hero", locked: false, headline: `Partner with ${name}`, sub: "Two ways to work together." },
      { id: "track-a", type: "track", locked: false, headline: "Refer", text: "Send people who want a review." },
      { id: "track-b", type: "track", locked: false, headline: "Build", text: "Run this under your own brand." },
      { id: "cta", type: "cta", locked: false, label: "Apply to partner", href: "#apply" }
    ];
  }
  if (funnelKey === "book") {
    return [
      { id: "hero", type: "hero", locked: false, headline: `Talk with ${name}`, sub: "Pick a time. Bring your questions." },
      { id: "cta", type: "cta", locked: false, label: "Book a time", href: "#book" }
    ];
  }
  // apply
  return [
    { id: "hero", type: "hero", locked: false, headline: `Funding review with ${name}`, sub: "Tell us about the file. We match options. Lenders decide." },
    { id: "process", type: "process", locked: false, headline: "How it works", text: "Share the basics. Review options with an advisor. Move only if you choose to." },
    { id: "engine", type: "engine", locked: false, headline: "What we look at", text: "File, cash flow, and what lenders will actually consider." },
    { id: "options", type: "options", locked: false, headline: "What you may see", text: "Options vary. Nothing here is an offer until a lender says so." },
    { id: "cta", type: "cta", locked: false, label: "Start an application", href: "#apply" }
  ];
}

export function defaultBody(funnelKey, brand = {}) {
  const key = FUNNELS[funnelKey] ? funnelKey : "apply";
  const name = String(brand.entity_name || brand.wordmark || "your brand").trim() || "your brand";
  return {
    template: key,
    sections: [...unlocked(key, name), ...legalBlocks(brand.entity_name || name)]
  };
}

export function mergeBodyJson(existing, incoming) {
  const current = existing && typeof existing === "object" ? existing : { sections: [] };
  const next = incoming && typeof incoming === "object" ? incoming : {};
  const currentSections = Array.isArray(current.sections) ? current.sections : [];
  const incomingSections = Array.isArray(next.sections) ? next.sections : null;
  if (!incomingSections) {
    return { ...current, ...next, sections: currentSections };
  }
  const lockedById = new Map(
    currentSections.filter(isLockedSection).map((s) => [String(s.id || ""), s])
  );
  const lockedByType = currentSections.filter((s) => isLockedSection(s) && !s.id);
  const merged = incomingSections.map((s) => {
    const id = String(s?.id || "");
    if (id && lockedById.has(id)) return lockedById.get(id);
    if (isLockedSection(s)) {
      const match = currentSections.find((c) => c.id === s.id) || currentSections.find((c) => c.type === s.type && isLockedSection(c));
      return match || s;
    }
    return s;
  });
  for (const locked of lockedById.values()) {
    if (!merged.some((s) => s && s.id === locked.id)) merged.push(locked);
  }
  for (const locked of lockedByType) {
    if (!merged.some((s) => s === locked || (s.type === locked.type && isLockedSection(s)))) {
      merged.push(locked);
    }
  }
  return { ...current, ...next, sections: merged };
}

export default {
  FUNNELS,
  isLockedSection,
  legalBlocks,
  defaultBody,
  mergeBodyJson,
  FULFILMENT_DISCLOSURE_ID,
  hasFulfilmentDisclosure
};
