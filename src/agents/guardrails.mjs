// Guardrail enforcement — registry JSON is not decorative.
//
// Shape (from the agent editor / migration 142 seeds):
//   {
//     block: string,
//     stop_words: string[],
//     triggers: string[],          // bus/event triggers — not enforced here
//     escalation: { path, after, when },
//     authority: { disc, msgcap, pay, contract, book, pull },
//     flags: { noamount, noscore, attorney, quiet }
//   }
//
// WHAT THIS ENFORCES IN CODE:
//   1. STOP-word triggers on the inbound body → halt the thread
//   2. authority.msgcap → hard cap on agent outbound messages per client per day
//   3. authority.disc → refuse an outbound draft that offers a discount above the cap
//   4. flags.noamount / noscore / attorney → refuse drafts that violate them
//   5. escalation.after → halt after N agent outbound messages when when-clause
//      keywords appear in the inbound (or after N with no resolution path=halt)
//
// Prompt STOP lines are also scanned when stop_words is empty, so a seeded
// agent whose guardrails were never filled still halts on its own STOP list.

const UNIVERSAL_STOP = [
  "stop", "stopall", "unsubscribe", "cancel", "end", "quit", "not interested"
];

const PROMPT_STOP_FALLBACK = [
  "complaint", "lawsuit", "attorney", "lawyer", "legal threat", "legal action",
  "distress", "dispute", "hardship", "refund", "sue"
];

/** Normalize guardrails jsonb (may arrive as object or string). */
export function normalizeGuardrails(raw) {
  let g = raw;
  if (typeof g === "string") {
    try { g = JSON.parse(g); } catch { g = {}; }
  }
  if (!g || typeof g !== "object") g = {};
  const auth = g.authority || {};
  const esc = g.escalation || {};
  const flags = g.flags || g.g || {};
  return {
    block: typeof g.block === "string" ? g.block : (typeof g.text === "string" ? g.text : ""),
    stop_words: Array.isArray(g.stop_words) ? g.stop_words.map(String) : [],
    triggers: Array.isArray(g.triggers) ? g.triggers.map(String) : [],
    escalation: {
      path: esc.path || g.esc || "halt",
      after: esc.after != null ? String(esc.after) : (g.escAfter != null ? String(g.escAfter) : "1"),
      when: esc.when || g.escWhen || ""
    },
    authority: {
      disc: Number(auth.disc != null ? auth.disc : (g.disc != null ? g.disc : 0)) || 0,
      msgcap: Number(auth.msgcap != null ? auth.msgcap : (g.msgcap != null ? g.msgcap : 0)) || 0,
      pay: !!(auth.pay != null ? auth.pay : g.pay),
      contract: !!(auth.contract != null ? auth.contract : g.contract),
      book: !!(auth.book != null ? auth.book : g.book),
      pull: !!(auth.pull != null ? auth.pull : g.pull)
    },
    flags: {
      noamount: flags.noamount !== false,
      noscore: flags.noscore !== false,
      attorney: flags.attorney !== false,
      quiet: flags.quiet !== false
    }
  };
}

/* stopList — union of universal TCPA-ish stops, explicit stop_words, words
   mined from the guardrails block / prompt STOP section. */
export function stopList(guardrails, prompt = "") {
  const g = normalizeGuardrails(guardrails);
  const fromPrompt = extractStopPhrases(prompt);
  const fromBlock = extractStopPhrases(g.block);
  const all = [
    ...UNIVERSAL_STOP,
    ...g.stop_words,
    ...(g.stop_words.length ? [] : PROMPT_STOP_FALLBACK),
    ...fromPrompt,
    ...fromBlock
  ];
  // Longer phrases first so "not interested" matches before "not".
  return [...new Set(all.map((s) => String(s).trim().toLowerCase()).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
}

function extractStopPhrases(text) {
  if (!text) return [];
  const found = [];
  const lower = String(text);
  // "STOP on: a, b, and c" / "STOP on a complaint, a legal threat"
  const m = lower.match(/STOP on[:\s]+([^\n.]+)/i);
  if (m) {
    for (const part of m[1].split(/,|;|\/|\band\b/i)) {
      const p = part.replace(/\bon these\b.*$/i, "").replace(/[^a-z0-9 '\-]/gi, " ").trim();
      if (p.length >= 3 && p.length <= 40) found.push(p.toLowerCase());
    }
  }
  return found;
}

/** True when the inbound body trips a STOP word. Whole-word / phrase match. */
export function hitsStopWord(body, guardrails, prompt = "") {
  const text = String(body || "").toLowerCase().trim();
  if (!text) return null;
  for (const phrase of stopList(guardrails, prompt)) {
    if (phraseIncludes(text, phrase)) return phrase;
  }
  return null;
}

function phraseIncludes(haystack, phrase) {
  if (!phrase) return false;
  if (phrase.includes(" ")) return haystack.includes(phrase);
  // Word-boundary for single tokens so "end" does not match "weekend".
  const re = new RegExp(`(?:^|[^a-z0-9])${escapeRe(phrase)}(?:[^a-z0-9]|$)`, "i");
  return re.test(haystack);
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * checkInbound — run before the model call.
 * Returns { ok: true } or { ok: false, halt: true, reason, detail }.
 */
export function checkInbound({ body, guardrails, prompt, agentOutboundCountToday = 0 } = {}) {
  const g = normalizeGuardrails(guardrails);
  const hit = hitsStopWord(body, g, prompt);
  if (hit) {
    return {
      ok: false,
      halt: true,
      reason: "stop_word",
      detail: `STOP trigger matched: "${hit}"`
    };
  }
  if (g.authority.msgcap > 0 && agentOutboundCountToday >= g.authority.msgcap) {
    return {
      ok: false,
      halt: false,
      reason: "msgcap",
      detail: `Daily message cap reached (${g.authority.msgcap})`
    };
  }
  const escAfter = parseInt(g.escalation.after, 10);
  if (Number.isFinite(escAfter) && escAfter > 0 && agentOutboundCountToday >= escAfter) {
    const when = String(g.escalation.when || "").toLowerCase();
    const whenHit = when
      ? when.split(/,|;/).map((x) => x.trim()).filter(Boolean)
          .some((w) => phraseIncludes(String(body || "").toLowerCase(), w))
      : false;
    // path=halt with a when-clause: halt only when when matches after N.
    // path=halt with empty when: halt once count hits after (hard ceiling).
    if (g.escalation.path === "halt" && (whenHit || !when)) {
      return {
        ok: false,
        halt: true,
        reason: "escalation",
        detail: whenHit
          ? `Escalation after ${escAfter} messages (when: matched)`
          : `Escalation after ${escAfter} messages`
      };
    }
  }
  return { ok: true };
}

/**
 * checkOutbound — run on the model draft before queueing a send.
 * Returns { ok: true } or { ok: false, reason, detail }.
 */
export function checkOutbound({ draft, guardrails } = {}) {
  const g = normalizeGuardrails(guardrails);
  const text = String(draft || "");
  const lower = text.toLowerCase();

  if (g.flags.attorney && /\b(attorney|lawyer|sue|lawsuit|legal action)\b/i.test(text)) {
    // Discussing legal topics in a reply is itself a halt signal for most agents.
    return { ok: false, reason: "attorney_flag", detail: "Draft engages legal topics (attorney flag)" };
  }
  if (g.flags.noamount && /\b(pre-?approved for|approved for|guarantee[sd]?|you('ll| will) get)\b/i.test(text)
      && /\$\s*\d|\d+\s*%|\d{3,}/.test(text)) {
    return { ok: false, reason: "noamount", detail: "Draft promises an amount/outcome (noamount flag)" };
  }
  if (g.flags.noscore && /\b(fico|credit score)\b/i.test(text)
      && /\b(will (be|hit|reach)|guarantee|promise)\b/i.test(text)) {
    return { ok: false, reason: "noscore", detail: "Draft promises a score outcome (noscore flag)" };
  }
  if (!g.authority.pay && /\b(i (can |will )?take (a |your )?payment|pay me|send me (your )?card)\b/i.test(lower)) {
    return { ok: false, reason: "pay_authority", detail: "Draft tries to take a payment without authority" };
  }
  if (!g.authority.contract && /\b(sign(ed|ing)? (the |this )?contract|i('ll| will) send (you )?a contract)\b/i.test(lower)) {
    return { ok: false, reason: "contract_authority", detail: "Draft handles contracts without authority" };
  }
  if (!g.authority.pull && /\b(pull(ing)? (your |the )?credit|soft pull|hard pull)\b/i.test(lower)) {
    return { ok: false, reason: "pull_authority", detail: "Draft offers a credit pull without authority" };
  }
  // Discount cap: refuse "$X off" / "X% off" above authority.disc.
  if (g.authority.disc >= 0) {
    const pct = text.match(/(\d+(?:\.\d+)?)\s*%\s*off/i);
    if (pct && Number(pct[1]) > g.authority.disc) {
      return {
        ok: false,
        reason: "discount_cap",
        detail: `Draft offers ${pct[1]}% off; max is ${g.authority.disc}`
      };
    }
    const dollars = text.match(/\$\s*(\d+(?:\.\d+)?)\s*off/i);
    if (dollars && Number(dollars[1]) > g.authority.disc) {
      return {
        ok: false,
        reason: "discount_cap",
        detail: `Draft offers $${dollars[1]} off; max is ${g.authority.disc}`
      };
    }
  }
  return { ok: true };
}

/** Count agent outbound messages for this client+agent since local midnight UTC. */
export async function countAgentMessagesToday(db, { orgId, clientId, agentCode, now = new Date() } = {}) {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0
  ));
  const { rows } = await db.query(
    `SELECT count(*)::int AS n
       FROM messages
      WHERE org_id = $1
        AND client_id = $2
        AND sender_kind = 'agent'
        AND sender_agent_code = $3
        AND direction = 'outbound'
        AND created_at >= $4`,
    [orgId, clientId, agentCode, start.toISOString()]
  );
  return rows[0]?.n || 0;
}

/** Persist a thread halt so later inbound messages short-circuit. */
export async function haltConversation(db, { conversationId, reason } = {}) {
  if (!conversationId) return;
  await db.query(
    `UPDATE conversations
        SET agent_halted_at = now(),
            agent_halt_reason = $2,
            updated_at = now()
      WHERE id = $1`,
    [conversationId, String(reason || "halted").slice(0, 300)]
  );
}

export default {
  normalizeGuardrails, stopList, hitsStopWord,
  checkInbound, checkOutbound, countAgentMessagesToday, haltConversation
};
