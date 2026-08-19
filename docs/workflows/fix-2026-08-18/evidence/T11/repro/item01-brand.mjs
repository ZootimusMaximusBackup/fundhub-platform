import { session, open, save, OUT, BASE } from "./_lib.mjs";

const s = await session("partner@fundhub.ai");
const { page, rec } = s;
const bodies = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!/\/api\/(partner-brand|org-brand|auth\/session|read\/partners)/.test(u)) return;
  let body = null;
  try { body = await res.text(); } catch { body = "<unreadable>"; }
  if (body && body.length > 4000) body = body.slice(0, 4000) + "…TRUNCATED";
  bodies.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status(), body });
});

s.reset();
const load = await open(page, "/app/brand-studio.html");
await page.screenshot({ path: OUT + "/01-brand-fields-before.png", fullPage: true });

const FIELDS = ["bName", "bEntity", "bAddr", "bEmail", "bDomain"];
const dom = await page.evaluate((ids) => {
  const out = { fields: [], mode: window.__fhBrandMode ?? "<undefined>", partnerId: window.__fhBrandPartnerId ?? "<undefined>",
    hasFHData: typeof window.FHData, D: null, saveMsg: null, banner: null, url: location.href };
  for (const id of ids) {
    const el = document.getElementById(id);
    out.fields.push(el ? { id, value: el.value, valueLen: el.value.length, placeholder: el.getAttribute("placeholder"), tag: el.tagName } : { id, MISSING: true });
  }
  try { out.D = JSON.parse(JSON.stringify(window.D || null)); } catch (e) { out.D = "<unserialisable>"; }
  const sm = document.getElementById("saveMsg"); out.saveMsg = sm ? sm.textContent.trim() : null;
  const b = document.getElementById("fh-data-banner"); out.banner = b ? b.textContent.trim().slice(0, 400) : null;
  return out;
}, FIELDS);

const beforeConsole = rec.console.slice();
const beforeApi = rec.api.slice();

// --- press Save (permitted: writes only this partner's own brand row) -------
s.reset();
const saveBtn = await page.$("#saveBtn");
let saveResult = { clicked: false };
if (saveBtn) {
  await saveBtn.click();
  await page.waitForTimeout(6000);
  saveResult = {
    clicked: true,
    saveMsg: await page.evaluate(() => { const e = document.getElementById("saveMsg"); return e ? e.textContent.trim() : null; }),
    banner: await page.evaluate(() => { const e = document.getElementById("fh-data-banner"); return e ? e.textContent.trim().slice(0, 400) : null; }),
    networkAfterClick: rec.api.slice(),
    nonGetAttempts: rec.intercepted.slice(),
    console: rec.console.slice()
  };
}
await page.screenshot({ path: OUT + "/01-brand-after-save.png", fullPage: true });

save("01-brand-dom.json", { login: rec.login, role: rec.role, load, dom, consoleAtLoad: beforeConsole, apiAtLoad: beforeApi, save: saveResult });
save("01-brand-network.json", bodies);
console.log(JSON.stringify({ load, mode: dom.mode, partnerId: dom.partnerId, hasFHData: dom.hasFHData, fields: dom.fields, saveMsg: dom.saveMsg, console: beforeConsole, saveResult }, null, 2));
await s.browser.close();
