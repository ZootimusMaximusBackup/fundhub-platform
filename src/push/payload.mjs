// What a push notification is allowed to say. The lock-screen gate.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — credit-repair messaging. This
// module decides the words that can reach a client's phone; the list below is
// the control, not a style guide.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE ONE FACT THIS FILE IS BUILT AROUND
//
// A push notification renders on a LOCKED PHONE. It is visible to whoever is
// holding it — a partner, a colleague leaning over a desk, a stranger who picked
// it up on a train — with no password and no unlock. Every other surface this
// product has (the portal, an email, a text) requires something. A lock-screen
// banner requires nothing.
//
// So the body of a notification is PUBLIC TEXT. Not "sensitive but encrypted" —
// the encryption in crypto.mjs protects it from the push service in transit and
// stops there. It arrives, it is decrypted, and it is displayed.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RULE
//
// Generic by default, and the default is the only thing anything ships with
// today. "A payment is due soon. Open FundHub." is a complete notification: it
// gets the client to the screen, and the screen is behind a login where the
// amount, the card and the date can be said plainly.
//
// BANNED FROM A DEFAULT BODY, and refused rather than stripped:
//   · a dollar amount, in any notation
//   · a creditor, lender or card-issuer name
//   · a credit score, or a number that reads like one
//   · a bureau name — Experian, Equifax, TransUnion, Innovis
//   · the words dispute, credit repair, collection, charge-off, delinquent,
//     derogatory, bankruptcy, lien, judgment
//
// REFUSED, NOT STRIPPED, deliberately. A sanitiser that quietly removes "$4,200"
// leaves "Your  payment is due" and nobody ever learns the caller tried. A
// refusal is loud at the point the code is written, which is the only point
// anybody can fix it.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE DETAIL FLAG
//
// allowDetail: false, everywhere, today. Nothing in this repository sets it to
// true. It exists so that turning detail on later is a one-line change at ONE
// call site with a name a reader understands, rather than a rewrite of this
// gate under time pressure. Flipping it is Chris's call and nobody else's.
//
// Even with the flag on, the length caps and the shape checks still apply — the
// flag lifts the vocabulary ban and nothing else.

export class PushPayloadRefused extends Error {
  constructor(message, { reason } = {}) {
    super(message);
    this.name = "PushPayloadRefused";
    this.reason = reason || "banned_content";
  }
}

/** The generic bodies. A caller that passes no body gets the one for its kind,
    and every one of these is safe to read over somebody's shoulder. */
export const GENERIC_BODIES = Object.freeze({
  payment_due: "A payment is due soon. Open FundHub.",
  statement_close: "Something on your file needs a look. Open FundHub.",
  document_needed: "We need a document from you. Open FundHub.",
  check_in: "Time for your check-in. Open FundHub.",
  update: "There is an update on your file. Open FundHub.",
  test: "Test notification from FundHub."
});

export const PUSH_KINDS = Object.freeze(Object.keys(GENERIC_BODIES));

/** The app's own name is the title, always. A title that varies is a second
    place for a leak, and no notification needs one. */
export const TITLE = "FundHub";

/* Titles and bodies are capped well under what a phone shows so nothing is
   silently cut mid-word on a small screen. */
const MAX_TITLE = 40;
const MAX_BODY = 120;

/* ── The banned vocabulary ────────────────────────────────────────────────
   Each entry is [name, regex]. The name is what the refusal says, so a
   developer sees WHICH rule they hit rather than a generic no. */
const BANNED = [
  ["a dollar amount", /\$\s*\d|\d\s*(?:dollars?|usd)\b|\busd\s*\d/i],
  // A bare number with grouping or decimals reads as money even without a sign.
  ["a money-shaped number", /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d{2}\b/],
  // Three or four digits on their own is how a credit score looks.
  ["a number that reads like a credit score", /\b[3-8]\d{2}\b/],
  ["a credit bureau name", /\b(?:experian|equifax|transunion|trans union|innovis|fico|vantagescore)\b/i],
  ["a creditor or lender name", new RegExp(
    "\\b(?:amex|american express|chase|capital one|citi|citibank|discover|" +
    "wells fargo|bank of america|synchrony|barclays|barclaycard|us bank|" +
    "navy federal|pnc|td bank|truist|apple card|visa|mastercard|" +
    "sofi|upstart|lendingclub|avant|oportun|affirm|klarna)\\b", "i")],
  ["credit-repair wording", new RegExp(
    "\\b(?:dispute[sd]?|disputing|credit repair|collections?|charge[- ]?off[s]?|" +
    "delinquen\\w*|derogatory|bankruptc\\w*|liens?|judgments?|repossession|" +
    "foreclosure|credit score|credit report)\\b", "i")]
];

/**
 * assertLockScreenSafe(text, { field, allowDetail })
 *
 * Throws PushPayloadRefused naming the rule that fired. Returns the text
 * unchanged when it passes — it never edits.
 */
export function assertLockScreenSafe(text, { field = "body", allowDetail = false } = {}) {
  const s = String(text == null ? "" : text);
  if (allowDetail === true) return s;
  for (const [name, re] of BANNED) {
    if (re.test(s)) {
      throw new PushPayloadRefused(
        `push ${field} refused: it contains ${name}, and a notification is read on a locked screen. ` +
        `Send the client to the portal instead, or set allowDetail:true deliberately.`,
        { reason: "banned_content" }
      );
    }
  }
  return s;
}

/**
 * buildPushPayload(notification, { allowDetail }) → JSON string
 *
 * The exact bytes the service worker will read. Small on purpose: a push
 * payload has a hard ceiling near 4 KB and every byte here is one the encrypted
 * record has to carry.
 *
 *   kind   which notification this is; picks the generic body
 *   body   optional override, gated by the rules above
 *   url    where the tap goes. SAME-ORIGIN PATH ONLY — an absolute URL in a
 *          payload is an open redirect that opens itself, with no click on a
 *          link and no address bar to read.
 *   tag    collapse key. Two "payment due" notifications should replace one
 *          another rather than stack; the browser does that by tag.
 */
export function buildPushPayload(notification = {}, { allowDetail = false } = {}) {
  const kind = String(notification.kind || "update");
  if (!Object.hasOwn(GENERIC_BODIES, kind)) {
    throw new PushPayloadRefused(
      `unknown push kind "${kind}" — add it to GENERIC_BODIES with a generic body first`,
      { reason: "unknown_kind" }
    );
  }

  const title = assertLockScreenSafe(notification.title || TITLE, { field: "title", allowDetail });
  const body = assertLockScreenSafe(
    notification.body || GENERIC_BODIES[kind], { field: "body", allowDetail }
  );

  if (title.length > MAX_TITLE) {
    throw new PushPayloadRefused(`push title is ${title.length} characters; the cap is ${MAX_TITLE}`, { reason: "too_long" });
  }
  if (body.length > MAX_BODY) {
    throw new PushPayloadRefused(`push body is ${body.length} characters; the cap is ${MAX_BODY}`, { reason: "too_long" });
  }

  const url = notification.url == null ? "/app/client-portal.html" : String(notification.url);
  if (!url.startsWith("/") || url.startsWith("//")) {
    // "//evil.example" is a protocol-relative absolute URL and a browser treats
    // it as one, so the leading-slash check alone is not enough.
    throw new PushPayloadRefused(
      `push url must be a same-origin path beginning with a single "/" — got ${url.slice(0, 40)}`,
      { reason: "bad_url" }
    );
  }

  return JSON.stringify({
    kind,
    title,
    body,
    url,
    tag: notification.tag ? String(notification.tag).slice(0, 40) : kind
  });
}

export default { buildPushPayload, assertLockScreenSafe, GENERIC_BODIES, PUSH_KINDS, TITLE };
