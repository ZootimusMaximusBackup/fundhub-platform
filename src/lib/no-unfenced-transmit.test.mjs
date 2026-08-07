// STRUCTURAL PROOF: nothing can reach the network except through the fence.
//
// The other fence tests ask "does the guard work?". This one asks the question
// that actually matters — "can anything get past it?" — and it is the reason
// this whole change is shaped the way it is.
//
// The fence this replaced was a condition each caller was trusted to remember.
// That is unverifiable by construction: a provider written next month either
// remembers or it does not, nothing fails when it does not, and the failure is
// discovered by a real client receiving a real message. No amount of testing
// the guard itself would have caught it, because the guard was never wrong —
// it was bypassed.
//
// So this test does not exercise behaviour. It reads the source tree and
// asserts that every module capable of an outbound call either routes through
// src/lib/outbound-fetch.mjs or is named on a list below with a written reason.
// A new file that calls fetch directly fails the build.
//
// Same pattern, and for the same reason, as src/http/routes.test.mjs: an
// escape hatch that requires editing a reviewed list is a decision. An escape
// hatch that requires nothing is a hole.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCANNED_DIRS = ["src", "api", "netlify"];
const CHOKEPOINT = "src/lib/outbound-fetch.mjs";

/* Tokens that mean "this module can put a request on the wire". Deliberately
   matched on the CALL, not the word: `await fetchContext(` and `fetchDoc(` are
   database reads with unlucky names and must not trip this. */
const NETWORK_TOKENS = [
  /\bglobalThis\.fetch\b/,
  /\bawait\s+fetch\s*\(/,
  /\bfetchImpl\s*\(/,
  /\bfetchFn\s*\(/,
  /\bdoFetch\s*\(/,
  /\bctx\.fetch\b/
];

/* ── ALLOWED_RAW_FETCH ──────────────────────────────────────────────────────
   Modules that reach the network without going through the chokepoint, each
   with the reason it is acceptable. Adding an entry is a deliberate, reviewed
   act; the test below also fails on a STALE entry, so this list cannot rot
   into a place where things are quietly parked.

   None of these can reach a client or change a client's record at a vendor.
   That is the bar. If a new entry can do either, it does not belong here — it
   belongs behind a fence. */
const ALLOWED_RAW_FETCH = {
  // ── Not actually the global fetch ────────────────────────────────────────
  "src/http/read-api.mjs":
    "`fetch` here is a local parameter holding a database reader, not the global.",

  // ── Reads and internal infrastructure. No client, no vendor record ───────
  "src/adapters/hubstaff.mjs":
    "Reads staff time-tracking data for payroll. No write, no client involvement.",
  "src/payments/commas-api.mjs":
    "GET /payments/:id reconciliation. Reads a payment we were already told about.",
  "src/company-brain/auth.mjs":
    "Exchanges a Google refresh token for an access token. Internal infrastructure.",
  "src/company-brain/drive-client.mjs":
    "Reads company documents out of Google Drive. Read-only, staff-facing.",
  "src/documents/store.mjs":
    "Fetches a stored document by URL for internal rendering.",
  "src/agents/model.mjs":
    "Asks a language model a question. No client contact, no vendor record.",
  "api/journeys/ask.mjs":
    "Staff-facing question to a language model. No client contact.",
  "api/inquiry.mjs":
    "Proxy to the vendored inquiry runtime; already 503s when unconfigured.",
  "src/adapters/oxylabs.mjs":
    "Location lookup against a scraping proxy. No client data leaves.",

  // ── Conduits. Default a fetch and hand it to a module listed above ───────
  "src/agents/runtime.mjs":
    "Defaults fetchImpl and passes it to src/agents/model.mjs. Never calls it.",
  "src/company-brain/sync.mjs":
    "Defaults fetchImpl and passes it to the Drive client. Never calls it.",
  "src/company-brain/walk.mjs":
    "Defaults fetchImpl and passes it to the Drive client. Never calls it.",

  // ── Company-owned accounts. Reach the company's own pages, not a client ──
  "src/social/oauth.mjs":
    "OAuth token exchange for company-owned social accounts. Authenticates the " +
    "company to its own pages; reaches no client.",
  "src/social/adapters.mjs":
    "Publishes to company-owned social accounts, gated by its own older " +
    "SOCIAL_PUBLISH_DRY_RUN flag. Company marketing, not client contact. Worth " +
    "folding into the one fence later.",
  "src/hiring/linkedin.mjs":
    "Job posting to a company-owned LinkedIn account. No client contact.",

  /* ── SPENDS MONEY, REACHES NO CLIENT — flagged, deliberately not fenced ───
     These can change live ad campaigns, and therefore spend, but they cannot
     contact a client or alter a client's record. The fence built here covers
     client contact, which is what was asked for and where the compliance risk
     sits. Listing them IS the finding: nothing holds these back today, and if
     that matters it is a separate piece of work rather than a silent extension
     of this one. */
  "src/adplatforms/_api.mjs":
    "UNFENCED SPEND: shared ad-platform HTTP client. Can alter live ad campaigns.",
  "src/adplatforms/tiktok.mjs":
    "UNFENCED SPEND: TikTok ads, via the shared client above.",
  "src/creative/providers/_http.mjs":
    "UNFENCED SPEND: paid creative-generation providers."
};

/* Modules permitted to declare fence: INTERNAL. Pinned to an exact set, so a
   new module cannot quietly label itself internal to skip the flags. */
const INTERNAL_CALLERS = new Set([
  "src/company-brain/answer.mjs",
  "src/company-brain/classify.mjs",
  "src/company-brain/embed.mjs"
]);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith(".mjs") && !name.endsWith(".test.mjs")) out.push(full);
  }
  return out;
}

const FILES = SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)))
  .map((f) => ({ path: relative(ROOT, f), source: readFileSync(f, "utf8") }));

/* Comment lines are dropped before scanning, or prose describing the fence
   trips the fence. Only whole-line comments are removed, and deliberately not
   trailing ones: stripping from the first `//` on a line would also cut
   "https://..." out of a real call and turn a genuine offender invisible. A
   false positive costs a line on a list; a false negative costs the point of
   the test. */
function stripCommentLines(source) {
  return source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

const reachesNetwork = (source) => NETWORK_TOKENS.some((re) => re.test(stripCommentLines(source)));
const usesChokepoint = (source) => source.includes("lib/outbound-fetch.mjs");

test("fence: the scan actually found the source tree", () => {
  // A regex that matches nothing would make every assertion below vacuously
  // pass. This is the canary for that.
  assert.ok(FILES.length > 300, `only scanned ${FILES.length} files — the walk is broken`);
  assert.ok(
    FILES.some((f) => f.path === CHOKEPOINT),
    "the chokepoint itself was not found — the paths in this test are wrong"
  );
  assert.ok(
    FILES.filter((f) => reachesNetwork(f.source)).length > 5,
    "no network-capable modules detected — the token list has stopped matching"
  );
});

test("fence: nothing reaches the network except through src/lib/outbound-fetch.mjs", () => {
  const offenders = FILES
    .filter((f) => f.path !== CHOKEPOINT)
    .filter((f) => reachesNetwork(f.source))
    .filter((f) => !usesChokepoint(f.source))
    .filter((f) => !Object.prototype.hasOwnProperty.call(ALLOWED_RAW_FETCH, f.path))
    .map((f) => f.path);

  assert.deepEqual(offenders, [],
    `These modules can make an outbound call without going through the fence:\n` +
    offenders.map((p) => `  - ${p}`).join("\n") +
    `\n\nRoute them through transmit()/postJsonTo() in ${CHOKEPOINT} with a declared ` +
    `fence, or — only if they cannot reach a client or change a vendor record — add ` +
    `them to ALLOWED_RAW_FETCH in this file with the reason.`);
});

test("fence: no ALLOWED_RAW_FETCH entry is stale", () => {
  // A list nobody prunes stops being a set of decisions and becomes a place to
  // hide things. Same guard as ALLOWED_UNROUTED in src/http/routes.test.mjs.
  const byPath = new Map(FILES.map((f) => [f.path, f]));
  for (const [path, reason] of Object.entries(ALLOWED_RAW_FETCH)) {
    const file = byPath.get(path);
    assert.ok(file, `ALLOWED_RAW_FETCH names "${path}", which no longer exists. Remove it.`);
    assert.ok(reason && reason.length > 20, `"${path}" needs a real written reason.`);
    assert.ok(
      reachesNetwork(file.source),
      `"${path}" is on ALLOWED_RAW_FETCH but no longer makes an outbound call. Remove it.`
    );
  }
});

test("fence: only the pinned modules may declare themselves INTERNAL", () => {
  // INTERNAL is the one category the flags do not hold. It has to be small and
  // it has to be a list somebody signed off on, or it becomes the way around
  // the fence.
  const declared = FILES
    .filter((f) => f.path !== CHOKEPOINT)
    .filter((f) => /\bfence:\s*INTERNAL\b/.test(f.source))
    .map((f) => f.path)
    .sort();

  assert.deepEqual(declared, [...INTERNAL_CALLERS].sort(),
    "The set of modules claiming fence: INTERNAL changed. INTERNAL skips the " +
    "dry-run flags, so a new one is a decision, not a detail. If it can reach a " +
    "client or change a vendor record it must use MESSAGING or ADAPTERS instead.");
});

test("fence: every messaging provider that transmits routes through the chokepoint", () => {
  // The specific regression that started this: a provider that sends without a
  // fence. Asserted directly rather than inferred from the sweep above.
  const providers = FILES.filter((f) =>
    f.path.startsWith("src/messaging/providers/") && !f.path.endsWith("index.mjs"));

  for (const p of providers) {
    if (!/TRANSMITS\s*=\s*true/.test(p.source) && !/sendLetter/.test(p.source)) continue;
    assert.ok(
      p.source.includes("postJson") || usesChokepoint(p.source),
      `${p.path} declares it transmits but does not go through the fenced HTTP helper.`
    );
  }
});
