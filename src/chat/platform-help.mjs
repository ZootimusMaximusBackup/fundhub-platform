// Platform how-to corpus for the chat widget (spec C-1).
// Distinct from Company Brain. Answers "how do I use Fundhub", not company SOPs.
// Honest empty states — never invent a product behavior.

const ENTRIES = [
  {
    id: "send-contract",
    title: "Send a contract",
    keywords: ["contract", "send contract", "esign", "agreement", "sign"],
    answer:
      "Open Closer Dashboard or Present for this person. Pick a wording, press Send, then copy the sign link. An email also goes if mail is on. Wordings themselves are written on the Contracts page.",
    href: "/app/closer-dashboard.html"
  },
  {
    id: "soft-pull",
    title: "Run a soft pull",
    keywords: ["soft pull", "credit pull", "crs", "bureau", "tradeline"],
    answer:
      "Open the client in Finance OS (or from Pipeline → client). Use Soft pull. It queues a bureau pull; when results land, tradelines and scores show on Finance OS.",
    href: "/app/finance-os.html"
  },
  {
    id: "pipeline",
    title: "Move a pipeline card",
    keywords: ["pipeline", "stage", "card", "move", "kanban"],
    answer:
      "Open Pipeline. Drag a card to the next stage, or open the card and change stage there. Stage moves that affect pay need you clocked in (unless you are an owner).",
    href: "/app/pipeline.html"
  },
  {
    id: "messaging",
    title: "Message a client",
    keywords: ["message", "sms", "text", "email", "inbox", "reply"],
    answer:
      "Open Messaging for the full inbox, or use the chat widget (bottom-right) and switch to Message. Staff→client texts go through the same compliance gate as every other outbound (quiet hours, opt-out).",
    href: "/app/messaging.html"
  },
  {
    id: "company-brain",
    title: "Search company knowledge",
    keywords: ["sop", "script", "company brain", "knowledge", "drive", "policy"],
    answer:
      "Use Company Brain in the sidebar, or the chat widget in Knowledge mode. Answers cite sources. Affiliates only see the affiliate allowlist — there is no fallback.",
    href: "/app/company-brain.html"
  },
  {
    id: "brand-studio",
    title: "Change brand colors",
    keywords: ["brand", "color", "logo", "theme", "funnel"],
    answer:
      "Brand Studio has two lanes: org/CRM theme for staff screens, and partner funnels for white-label partners. Partners never recolor the internal CRM.",
    href: "/app/brand-studio.html"
  },
  {
    id: "sample-data",
    title: "Load simulated client data",
    keywords: ["sample", "demo", "simulated", "fake data", "test client"],
    answer:
      "On Finance OS, use Load simulated data (owner/admin). It creates a real demo client with bureau-shaped tradelines and a pipeline card, all flagged is_demo. Clear simulated data removes it.",
    href: "/app/finance-os.html"
  },
  {
    id: "clock-in",
    title: "Clock in for a shift",
    keywords: ["clock", "shift", "punch", "attribution"],
    answer:
      "Use the chip in the top-right to clock in. Sending client messages and moving pipeline stages needs an active shift (owners are exempt).",
    href: "/app/closer-dashboard.html"
  },
  {
    id: "search",
    title: "Search the CRM",
    keywords: ["search", "find client", "⌘k", "ctrl k", "global search"],
    answer:
      "Press ⌘K (Mac) or Ctrl K, or click Search next to Sign out. Search covers clients, contracts, documents, conversations, and pipeline cards.",
    href: null
  },
  {
    id: "campaigns",
    title: "Manage ad campaigns",
    keywords: ["campaign", "meta", "facebook", "ads", "spend", "media"],
    answer:
      "Campaigns under Marketing lists Meta/TikTok campaigns for a partner, spend vs ceilings, fatigue, and the action log. Sync pulls live Meta data when META credentials and a connection exist.",
    href: "/app/campaign-manager.html"
  }
];

function score(entry, q) {
  const words = q.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return 0;
  let n = 0;
  const hay = (entry.title + " " + entry.keywords.join(" ") + " " + entry.answer).toLowerCase();
  for (const w of words) {
    if (hay.includes(w)) n += 1;
    if (entry.keywords.some((k) => k.includes(w) || w.includes(k))) n += 2;
  }
  return n;
}

/**
 * askPlatformHelp(question) → { ok, thin, answer, sources }
 * Never fabricates. thin=true when nothing matched well enough.
 */
export function askPlatformHelp(question) {
  const q = String(question || "").trim();
  if (!q) {
    return {
      ok: true,
      thin: true,
      answer: "Ask how to do something in Fundhub — for example, “how do I send a contract?”",
      sources: []
    };
  }
  const ranked = ENTRIES
    .map((e) => ({ e, s: score(e, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (!ranked.length || ranked[0].s < 2) {
    return {
      ok: true,
      thin: true,
      answer:
        "I do not have a documented answer for that in the product help. Try Company Knowledge mode for SOPs and scripts, or ask a teammate.",
      sources: []
    };
  }

  const top = ranked.slice(0, 3).map((x) => x.e);
  const best = top[0];
  return {
    ok: true,
    thin: false,
    answer: best.answer,
    sources: top.map((e) => ({
      id: e.id,
      title: e.title,
      href: e.href
    }))
  };
}

export function listPlatformHelp() {
  return ENTRIES.map(({ id, title, href }) => ({ id, title, href }));
}

/* The whole corpus, answers included — what the Claude-backed assistant is
   grounded on. Copies out so a caller cannot mutate the source of truth. */
export function platformHelpCorpus() {
  return ENTRIES.map((e) => ({ ...e, keywords: [...e.keywords] }));
}

export { ENTRIES as _ENTRIES_FOR_TESTS };
