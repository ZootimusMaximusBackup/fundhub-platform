/* Pulls the showOwnUrl block out of public/app/partner-galaxy.html and runs it
   against a stubbed browser, once per state. Prints the words the partner would
   read and the address the link actually goes to, so the two can be compared. */
import fs from "node:fs";

const src = fs.readFileSync(new URL("../../../../../../public/app/partner-galaxy.html", import.meta.url), "utf8");
const block = src.match(/\(function showOwnUrl\(\)[\s\S]*?\n  \}\)\(\);/);
if (!block) throw new Error("showOwnUrl block not found");

const PID = "9defaf28-47c5-43a0-8f5e-f41ef90f360a";

function makeEl() {
  const el = { kids: [], textContent: "", appendChild(n) { this.kids.push(n); } };
  Object.defineProperty(el, "shown", {
    get() {
      return this.kids.map((k) => k.data != null ? k.data : k.textContent).join("");
    }
  });
  return el;
}

async function run(pagesBody) {
  const el = makeEl();
  const g = {
    document: {
      getElementById: (id) => (id === "wl-own-url" ? el : null),
      createElement: () => ({ href: "", textContent: "" }),
      createTextNode: (data) => ({ data })
    },
    localStorage: { getItem: () => "tok-abc" },
    location: { origin: "https://fundhub.ai" },
    fetch: async (url) => ({
      ok: true,
      json: async () => url.startsWith("/api/auth/session")
        ? { ok: true, staff: { partner_id: PID } }
        : pagesBody
    })
  };
  const fn = new Function("document", "localStorage", "location", "fetch", block[0]);
  fn(g.document, g.localStorage, g.location, g.fetch);
  await new Promise((r) => setTimeout(r, 30));
  const link = el.kids.find((k) => k.href !== undefined);
  return {
    reads: el.shown,
    link_goes_to: link ? link.href : null,
    link_text: link ? link.textContent : null
  };
}

const draft = { ok: true, items: [
  { id: "p1", status: "draft", slug: "apply", live_path: null, live_url: null }] };
const published = { ok: true, items: [
  { id: "p1", status: "published", slug: "apply",
    live_path: `/sites/${PID}/apply`, live_url: `/sites/${PID}/apply` }] };
const domain = { ok: true, items: [
  { id: "p1", status: "published", slug: "apply",
    live_path: `/sites/${PID}/apply`, live_url: "https://money.example.com/apply" }] };
const none = { ok: true, items: [] };

const out = {
  "1_draft_only (the live partner's real state on 2026-08-19)": await run(draft),
  "2_published_on_fundhub": await run(published),
  "3_published_on_verified_custom_domain": await run(domain),
  "4_no_page_at_all": await run(none)
};
console.log(JSON.stringify(out, null, 2));
