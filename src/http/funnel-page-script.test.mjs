// public/partner/funnel.js — the browser half of the funnel till, driven for real.
//
// WHY THIS EXISTS AND NOT A PLAYWRIGHT WALK. CLAUDE.md §6 wants a Playwright
// check on a UI change. It could not run here: `npx playwright install chromium`
// fails to download in this environment (the browser binary is not fetchable),
// and no DOM library — jsdom, linkedom, happy-dom — is a dependency of this
// repo. Reported as a gap rather than skipped: what a real browser would still
// prove that this does not is layout, focus order and the actual navigation.
//
// WHAT THIS DOES PROVE, which is the part that decides whether the page takes
// money correctly: the contract between the JSON in
// api/public/funnel-checkout.mjs and the markup in public/partner/*/index.html.
// The script is executed for real, in a vm, against a DOM small enough to read.
// If a data attribute is renamed on either side, this fails.
//
// PURE UNIT TEST, NO DATABASE, NO NETWORK. Lives under src/http/ because
// npm test's glob is src/** and scripts/** ONLY.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { funnelCatalogue } from "../../api/public/funnel-checkout.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const SCRIPT = fs.readFileSync(path.join(REPO, "public/partner/funnel.js"), "utf8");

/* ── the smallest DOM that can hold this script ─────────────────────────────
   Elements are plain objects with only the members funnel.js touches. Anything
   it reaches for that is not modelled throws, which is the point: an untested
   DOM call becomes a failure here rather than a blank page in production. */

function el(tag, attrs = {}, kids = []) {
  return {
    tag,
    attrs: { ...attrs },
    children: kids,
    textContent: "",
    disabled: false,
    listeners: {},
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    fire(type, event) { (this.listeners[type] || []).forEach((fn) => fn(event)); },
    querySelector(sel) { return matchAll(this.children, sel)[0] || null; }
  };
}

/** A deliberately tiny selector engine: exactly the shapes funnel.js uses. */
function matches(node, sel) {
  if (sel === "button[type=submit]") return node.tag === "button" && node.attrs.type === "submit";
  if (sel === "[data-checkout-error]") return "data-checkout-error" in node.attrs;
  if (sel === "[data-price]") return "data-price" in node.attrs;
  if (sel === "[data-price-label]") return "data-price-label" in node.attrs;
  if (sel === "[data-notice]") return "data-notice" in node.attrs;
  if (sel === "form[data-checkout]") return node.tag === "form" && "data-checkout" in node.attrs;
  if (sel === 'a[href^="/partner/"]') return node.tag === "a" && String(node.attrs.href || "").startsWith("/partner/");
  throw new Error(`the DOM stub does not model the selector ${sel} — model it or stop using it`);
}

function matchAll(nodes, sel) {
  const out = [];
  const walk = (list) => list.forEach((n) => { if (matches(n, sel)) out.push(n); walk(n.children || []); });
  walk(nodes);
  return out;
}

function buildWorld({ tree, search = "", catalogue, postReply, storage = {} }) {
  const posts = [];
  const gets = [];
  const location = { search, origin: "https://fundhub.ai", href: "https://fundhub.ai/partner/board/" };

  const document = {
    querySelectorAll: (sel) => matchAll(tree, sel),
    getElementById: (id) => matchAll(tree, "[data-price]").concat(tree).find((n) => n.attrs && n.attrs.id === id) || null
  };

  const sandbox = {
    console,
    URL, URLSearchParams, JSON, Error, String, Number, Boolean, Date,
    window: {
      location,
      sessionStorage: {
        getItem: (k) => (k in storage ? storage[k] : null),
        setItem: (k, v) => { storage[k] = String(v); }
      }
    },
    document,
    FormData: function FormDataStub(form) {
      return { get: (name) => (form.fields && name in form.fields ? form.fields[name] : null) };
    },
    fetch: (url, opts) => {
      if (!opts || !opts.method) { gets.push(url); return Promise.resolve({ json: () => Promise.resolve(catalogue) }); }
      posts.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ json: () => Promise.resolve(postReply) });
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);
  return { posts, gets, location, storage, sandbox };
}

/** The board page, reduced to the parts funnel.js reads. */
function boardTree() {
  const kicker = el("span", { "data-price-label": "board" });
  const err = el("p", { "data-checkout-error": "" });
  const notice = el("p", { "data-notice": "board_renewal" });
  const button = el("button", { type: "submit" });
  button.textContent = "Get the Board";
  button.disabled = true;
  const form = el("form", { "data-checkout": "board" }, [err, notice, button]);
  form.fields = { email: "dana@example.com", first_name: "Dana", last_name: "Kowal" };
  const link = el("a", { href: "/partner/trial/" });
  const yr = el("span", { id: "yr" });
  return { tree: [kicker, form, link, yr], kicker, err, notice, button, form, link, yr };
}

const settle = () => new Promise((r) => setImmediate(r));

/* ─────────────────────────────────────────────────────────────────────────── */

test("prices are painted from the real catalogue, not from the markup", async () => {
  const dom = boardTree();
  buildWorld({ tree: dom.tree, catalogue: funnelCatalogue({ FANBASIS_CHECKOUT_API_KEY: "k" }) });
  await settle();

  assert.equal(dom.kicker.textContent, "$47/month",
    "the price slot must be filled from GET /api/public/funnel-checkout");
  assert.match(dom.notice.textContent, /first month/i,
    "the board's renewal notice comes from the API, so the page cannot say something the till does not");
  assert.equal(dom.button.disabled, false, "a priced, available item unlocks its buy button");
  assert.equal(Number(dom.yr.textContent) >= 2026, true, "the footer year still gets written");
});

test("a page that cannot state the price does not take money", async () => {
  const dom = boardTree();
  /* No Commas configured — every self-serve item comes back unavailable. */
  buildWorld({ tree: dom.tree, catalogue: funnelCatalogue({}) });
  await settle();

  assert.equal(dom.button.disabled, true, "the buy button must stay disabled");
  assert.match(dom.err.textContent, /not|nothing has been charged/i,
    "and the buyer must be told, in plain words, that nothing was charged");
});

test("the catalogue never answering leaves the slot empty and the button dead", async () => {
  const dom = boardTree();
  dom.kicker.textContent = "—";
  const world = buildWorld({ tree: dom.tree, catalogue: { ok: false } });
  await settle();

  assert.equal(dom.kicker.textContent, "—", "visibly missing beats confidently wrong");
  assert.equal(dom.button.disabled, true);
  assert.equal(world.posts.length, 0);
});

test("submitting posts the buyer, the item and the attribution, then leaves for checkout", async () => {
  const dom = boardTree();
  const world = buildWorld({
    tree: dom.tree,
    search: "?track=board&a1=DKOWAL&a2=UPLINE",
    catalogue: funnelCatalogue({ FANBASIS_CHECKOUT_API_KEY: "k" }),
    postReply: { ok: true, checkoutUrl: "https://pay.example.com/s/abc" }
  });
  await settle();

  let prevented = false;
  dom.form.fire("submit", { preventDefault: () => { prevented = true; } });
  await settle();
  await settle();

  assert.equal(prevented, true, "the form must not do a native GET submit");
  assert.equal(world.posts.length, 1);
  const sent = world.posts[0];
  assert.equal(sent.url, "/api/public/funnel-checkout");
  assert.equal(sent.body.item, "board");
  assert.equal(sent.body.email, "dana@example.com");
  assert.equal(sent.body.first_name, "Dana");
  assert.equal(sent.body.track, "board");
  assert.equal(sent.body.a1, "DKOWAL");
  assert.equal(sent.body.a2, "UPLINE");
  assert.equal(world.location.href, "https://pay.example.com/s/abc", "the buyer is sent to the real checkout");
});

test("attribution survives the hop: remembered for the tab, and carried onto funnel links", async () => {
  const storage = {};
  const first = boardTree();
  const world = buildWorld({
    tree: first.tree,
    search: "?track=board&a1=DKOWAL",
    catalogue: funnelCatalogue({ FANBASIS_CHECKOUT_API_KEY: "k" }),
    storage
  });
  await settle();

  assert.equal(first.link.getAttribute("href"), "/partner/trial/?track=board&a1=DKOWAL",
    "a link to another funnel page carries the attribution forward");
  assert.match(world.storage["fundhub.funnel.attribution"], /DKOWAL/);

  /* Second page, NO query string. The stored value is what must be posted —
     this is the case that used to lose the referral. */
  const second = boardTree();
  const w2 = buildWorld({
    tree: second.tree, search: "", storage,
    catalogue: funnelCatalogue({ FANBASIS_CHECKOUT_API_KEY: "k" }),
    postReply: { ok: true, checkoutUrl: "https://pay.example.com/s/two" }
  });
  await settle();
  second.form.fire("submit", { preventDefault() {} });
  await settle();
  await settle();
  assert.equal(w2.posts[0].body.a1, "DKOWAL", "the referral survived the page hop");
});

test("?ref= and ?code= mean the same thing as ?a1=", async () => {
  for (const param of ["ref", "code"]) {
    const dom = boardTree();
    const world = buildWorld({
      tree: dom.tree, search: `?${param}=REFCODE`, storage: {},
      catalogue: funnelCatalogue({ FANBASIS_CHECKOUT_API_KEY: "k" }),
      postReply: { ok: true, checkoutUrl: "https://x/y" }
    });
    await settle();
    dom.form.fire("submit", { preventDefault() {} });
    await settle();
    await settle();
    assert.equal(world.posts[0].body.a1, "REFCODE", `?${param}= must land as a1`);
  }
});

test("a refused checkout says so plainly and gives the button back — no silent dead end", async () => {
  const dom = boardTree();
  const world = buildWorld({
    tree: dom.tree,
    catalogue: funnelCatalogue({ FANBASIS_CHECKOUT_API_KEY: "k" }),
    postReply: { ok: false, error: "checkout_not_configured" }
  });
  await settle();

  dom.form.fire("submit", { preventDefault() {} });
  await settle();
  await settle();

  assert.match(dom.err.textContent, /nothing has been charged/i,
    "the one sentence a buyer needs after a failed payment attempt");
  assert.equal(dom.button.disabled, false, "they must be able to try again");
  assert.equal(world.location.href, "https://fundhub.ai/partner/board/", "and they must not be navigated away");
});

test("the error copy is plain language, at the reading level CLAUDE.md §10 requires", () => {
  /* No jargon on a page a stranger reads while deciding whether to pay. */
  const banned = /\b(?:HTTP|4\d\d|5\d\d|null|undefined|exception|stack|API key|endpoint|payload|token)\b/;
  const messages = SCRIPT.match(/^\s+[a-z_]+: "(.*?)",?$/gm) || [];
  assert.ok(messages.length >= 5, "the message table should be in this file, not scattered");
  for (const m of messages) {
    assert.ok(!banned.test(m), `buyer-facing copy must not say: ${m.trim()}`);
  }
});
