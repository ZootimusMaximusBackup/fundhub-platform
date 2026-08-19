/* T10 unit C — the "Your page" banner on the partner Home screen. (T10-01)
 *
 * WHAT A PARTNER SAW, 2026-08-18/19. Their Home screen said
 * "Your page · https://fundhub.ai/sites/<their id>/apply". They clicked it and
 * got a "not found" page. Their only page was a draft, and a draft is never
 * public. Two separate untruths in one line: the banner had never asked whether
 * any page was live, and the words on screen were not where the link went — the
 * text was the public address, the link went to Brand Studio.
 *
 * THE FIX is in public/app/partner-galaxy.html: the banner now reads the
 * partner's own page list first and reports what it finds. It adds no button and
 * no new screen — Publish still lives in Brand Studio.
 *
 * WHY THIS FILE EXISTS. The first pass shipped that fix with six tests, all of
 * them ending in .pg.test.mjs — and the blocking CI job runs with no database on
 * purpose, so every one of them skipped. Nothing that could fail the branch
 * looked at the banner at all. This file has no database in it, so the merge gate
 * actually runs it.
 *
 * HOW IT TESTS. It does not open a browser and it does not re-implement the
 * banner. It lifts the real showOwnUrl block straight out of the shipped HTML,
 * runs it against a stand-in for the page and a stand-in for the network, and
 * reads the caption that comes out. If the block is edited, this test runs the
 * edited code. Modelled on src/http/brand-studio-screen.test.mjs, which reads the
 * same screens as source; this one goes one step further and executes the block.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NOT_LIVE_HTML } from "../../netlify/functions/partner-site.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "partner-galaxy.html"), "utf8");

const PARTNER = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://fundhub.ai";

/* ------------------------------------------------------------------ *
 * Lifting the real code out of the page.
 * ------------------------------------------------------------------ */

/* The banner is one self-running block. It starts at `(function showOwnUrl()`
   and ends at the only `})();` sitting at two spaces of indent after it —
   everything inside the block is indented deeper. If either marker moves, this
   throws instead of quietly testing nothing. */
function bannerSource() {
  const start = HTML.indexOf("(function showOwnUrl()");
  assert.ok(start !== -1,
    "showOwnUrl is gone from partner-galaxy.html — the banner is no longer built here, " +
    "so this test is stale and must be rewritten, not deleted");
  const end = HTML.indexOf("\n  })();", start);
  assert.ok(end !== -1, "showOwnUrl no longer closes at the expected indent — test is stale");
  return HTML.slice(start, end + "\n  })();".length);
}

/* A stand-in for the one element the banner writes to. Setting textContent
   clears the children, the way a real element does, so "replace the caption"
   and "append a link" cannot be confused with each other. */
function makeCaption(startingWords) {
  let text = startingWords;
  const kids = [];
  return {
    kids,
    appendChild(node) { kids.push(node); text += node.textContent; },
    get textContent() { return text; },
    set textContent(v) { text = v; kids.length = 0; }
  };
}

/* The starting words that live in the HTML itself. Read from the file, not
   copied, so the test cannot drift from the page. */
function startingCaption() {
  const m = /<div class="census" id="wl-own-url">([^<]*)<\/div>/.exec(HTML);
  assert.ok(m, "the wl-own-url caption element is gone from partner-galaxy.html");
  return m[1];
}

/* Run the real block with a fake page and a fake network.
   `routes` maps a URL prefix to { status, body } or to a thrown network error. */
async function runBanner({ token = "partner-token", routes = {} } = {}) {
  const caption = makeCaption(startingCaption());
  const asked = [];

  const doc = {
    getElementById: (id) => (id === "wl-own-url" ? caption : null),
    createTextNode: (t) => ({ tag: "#text", textContent: String(t) }),
    createElement: (t) => ({ tag: String(t), href: "", textContent: "" })
  };
  const store = { getItem: (k) => (k === "fh_token" ? token : null) };
  const loc = { origin: ORIGIN };

  const fakeFetch = (url) => {
    asked.push(url);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    const r = key ? routes[key] : { status: 404, body: { ok: false } };
    if (r.networkError) return Promise.reject(new Error("offline"));
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => (r.badJson
        ? Promise.reject(new Error("not json"))
        : Promise.resolve(r.body))
    });
  };

  // eslint-disable-next-line no-new-func
  const run = new Function("document", "localStorage", "location", "fetch", bannerSource());
  run(doc, store, loc, fakeFetch);

  // Two macrotask turns drain every microtask the fake promises can queue.
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const link = caption.kids.find((k) => k.tag === "a") || null;
  return { text: caption.textContent, link, asked };
}

const SESSION_OK = {
  "/api/auth/session": { status: 200, body: { ok: true, staff: { partner_id: PARTNER } } }
};
const pages = (items) => ({
  "/api/partner-pages": { status: 200, body: { ok: true, items } }
});
const applyPage = (status) => ({
  id: "p-apply", funnel_key: "apply", slug: "apply", status,
  live_path: status === "published" ? `/sites/${PARTNER}/apply` : null,
  live_url: status === "published" ? `/sites/${PARTNER}/apply` : null
});
const thanksPage = (status) => ({
  id: "p-thanks", funnel_key: "thankyou", slug: "thanks", status,
  live_path: status === "published" ? `/sites/${PARTNER}/thanks` : null,
  live_url: status === "published" ? `/sites/${PARTNER}/thanks` : null
});

/* ------------------------------------------------------------------ *
 * 1. It asks before it states.
 * ------------------------------------------------------------------ */

test("the banner reads the partner's own page list before it says anything", async () => {
  /* THE HEART OF THE BUG. The old banner built an address out of the session
     alone and never asked whether a page was live. Asking is what makes every
     other line on this screen true. */
  const out = await runBanner({
    routes: { ...SESSION_OK, ...pages([applyPage("published")]) }
  });
  assert.ok(out.asked.some((u) => u.startsWith("/api/partner-pages?partner_id=" + PARTNER)),
    "the banner never asked for this partner's page list — it is guessing again. Asked: " +
    JSON.stringify(out.asked));
});

/* ------------------------------------------------------------------ *
 * 2. The words and the link are the same place.
 * ------------------------------------------------------------------ */

test("what the partner reads is exactly where the link goes", async () => {
  const out = await runBanner({
    routes: { ...SESSION_OK, ...pages([applyPage("published")]) }
  });
  const addr = `${ORIGIN}/sites/${PARTNER}/apply`;
  assert.ok(out.link, "there is no link in the banner at all");
  assert.equal(out.link.textContent, addr, "the words on screen are not the live address");
  assert.equal(out.link.href, addr,
    "the link goes somewhere other than the address printed next to it — " +
    "that is the second half of the original bug");
  assert.equal(out.link.textContent, out.link.href,
    "the words and the destination have drifted apart again");
  assert.ok(out.text.includes("Your page"), "the caption lost its label");
});

/* ------------------------------------------------------------------ *
 * 3. A draft is called a draft.
 * ------------------------------------------------------------------ */

test("a draft is described as a draft, and no public address is promised", async () => {
  const out = await runBanner({
    routes: { ...SESSION_OK, ...pages([applyPage("draft")]) }
  });
  assert.match(out.text, /draft/i,
    "a partner whose only page is a draft is still not told so");
  assert.match(out.text, /not live/i, "it does not say the page is not live");
  assert.ok(!out.text.includes("/sites/"),
    "the banner is still printing a public web address for a page that is a draft — " +
    "clicking it lands on the not-found page. Caption was: " + out.text);
  assert.ok(out.link && out.link.href.startsWith("brand-studio.html"),
    "the only link offered for a draft must go to Brand Studio, where Publish lives");
});

test("a partner with no pages at all is told that, not given an address", async () => {
  const out = await runBanner({ routes: { ...SESSION_OK, ...pages([]) } });
  assert.match(out.text, /none made yet/i);
  assert.ok(!out.text.includes("/sites/"),
    "an address was promised for a partner who has not made a page");
  assert.ok(out.link && out.link.href.startsWith("brand-studio.html"));
});

/* ------------------------------------------------------------------ *
 * 4. Honesty when the read fails. (verifier finding, 2026-08-19)
 * ------------------------------------------------------------------ */

test("a page list that will not load says so, instead of telling a signed-in partner to sign in",
  async () => {
    /* The starting words on the page are "sign in to see your address". Leaving
       them there when the read failed tells somebody who is already signed in to
       sign in. A dash with a reason beats a confident wrong caption. */
    const out = await runBanner({
      routes: { ...SESSION_OK, "/api/partner-pages": { status: 500, body: { ok: false } } }
    });
    assert.match(out.text, /could not load/i,
      "the banner said nothing about the failure. Caption was: " + out.text);
    assert.ok(!/sign in to see/i.test(out.text),
      "a signed-in partner is still being told to sign in");
    assert.ok(!out.text.includes("/sites/"), "an address was guessed after a failed read");
  });

test("a page list that is refused says so too", async () => {
  const out = await runBanner({
    routes: { ...SESSION_OK, "/api/partner-pages": { status: 403, body: { ok: false } } }
  });
  assert.match(out.text, /could not load/i);
  assert.ok(!/sign in to see/i.test(out.text));
});

test("a session the server has expired is told to sign in again, in those words", async () => {
  const out = await runBanner({
    routes: { "/api/auth/session": { status: 401, body: { ok: false } } }
  });
  assert.match(out.text, /sign in again/i,
    "an expired sign-in gets no explanation. Caption was: " + out.text);
  assert.ok(!out.text.includes("/sites/"));
});

test("a sign-in that is not a partner is not told to sign in", async () => {
  const out = await runBanner({
    routes: { "/api/auth/session": { status: 200, body: { ok: true, staff: { role: "owner" } } } }
  });
  assert.ok(!/sign in to see/i.test(out.text),
    "somebody who is signed in is being told to sign in. Caption was: " + out.text);
  assert.ok(!out.text.includes("/sites/"), "an address was invented for a non-partner sign-in");
});

test("the network being down does not leave stale words on screen", async () => {
  const out = await runBanner({
    routes: { "/api/auth/session": { networkError: true } }
  });
  assert.match(out.text, /could not load/i);
});

test("nobody signed in keeps the page's own starting words", async () => {
  // The one case where "sign in to see your address" is true. It must survive.
  const out = await runBanner({ token: "", routes: {} });
  assert.equal(out.text, startingCaption());
  assert.deepEqual(out.asked, [], "the banner called the server with no token");
});

/* ------------------------------------------------------------------ *
 * 5. More than one page. (verifier finding, 2026-08-19)
 * ------------------------------------------------------------------ */

test("with several pages, 'Your page' means the apply page and nothing else", async () => {
  /* The API lists newest-edited first. A partner who tweaked their thank-you
     page this morning would have seen the thank-you address labelled "Your page".
     True address, wrong name for it. */
  const out = await runBanner({
    routes: { ...SESSION_OK, ...pages([thanksPage("published"), applyPage("published")]) }
  });
  const addr = `${ORIGIN}/sites/${PARTNER}/apply`;
  assert.ok(out.link, "no link in the banner");
  assert.equal(out.link.href, addr,
    "'Your page' pointed at a page that is not the apply page, only because that one " +
    "was edited more recently");
  assert.equal(out.link.textContent, addr);
});

test("a live page that is not the apply page is never called 'Your page'", async () => {
  const out = await runBanner({
    routes: { ...SESSION_OK, ...pages([thanksPage("published"), applyPage("draft")]) }
  });
  const thanks = `${ORIGIN}/sites/${PARTNER}/thanks`;
  assert.match(out.text, /apply page is not live/i,
    "the partner is not told their apply page is still not live. Caption was: " + out.text);
  assert.ok(out.link, "the live address was not offered at all");
  assert.equal(out.link.href, thanks);
  assert.equal(out.link.textContent, thanks, "words and destination differ");
  assert.ok(!/^Your page · https/.test(out.text),
    "a thank-you page is being presented as 'Your page'");
});

/* ------------------------------------------------------------------ *
 * 6. The not-found page's words, checked where the merge gate can see them.
 *    (These are the wording assertions that previously lived only in the
 *    database-only test file, which the blocking job skips.)
 * ------------------------------------------------------------------ */

test("the not-found page explains what a draft is and where Publish lives", () => {
  assert.match(NOT_LIVE_HTML, /draft/i, "a partner landing here is not told what a draft is");
  assert.match(NOT_LIVE_HTML, /Brand Studio/, "it does not say where to go");
  assert.match(NOT_LIVE_HTML, /Publish/, "it does not say which control to press");
  assert.ok(!NOT_LIVE_HTML.includes("This page is not published."),
    "the old bare wording is back");
});

test("the not-found page is one fixed set of words, so it cannot leak who exists", () => {
  /* REGRESSION GUARD. Every miss — no such partner, no such page, a draft —
     returns this one constant. Because it is a constant, it cannot vary by
     partner. This does not prove the fix; it stops a well-meaning "helpful"
     message being added later, which is exactly how the leak comes back. */
  assert.equal(typeof NOT_LIVE_HTML, "string");
  assert.ok(!/\$\{/.test(NOT_LIVE_HTML),
    "the not-found page now has something filled into it — anything that varies " +
    "tells a stranger which partner ids are real");
});
