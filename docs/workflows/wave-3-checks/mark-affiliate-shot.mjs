import { chromium } from "/home/user/fundhub-platform/node_modules/playwright/index.mjs";
const CSS = `
.fhmark{position:absolute;border:3px solid #E11D48;border-radius:6px;pointer-events:none;z-index:99998}
.fhnum{position:absolute;background:#E11D48;color:#fff;font:700 13px/22px Arial,sans-serif;
  width:22px;height:22px;border-radius:50%;text-align:center;z-index:99999}
.fhlegend{position:absolute;left:0;right:0;background:#0A0A0A;color:#fff;z-index:100000;
  font:13px/1.7 Arial,sans-serif;padding:16px 20px}
.fhlegend div{margin-bottom:4px}
.fhlegend b{display:inline-block;background:#E11D48;color:#fff;width:19px;height:19px;border-radius:50%;
  text-align:center;font:700 11px/19px Arial,sans-serif;margin-right:8px}`;

async function annotate(page, marks, title) {
  await page.addStyleTag({ content: CSS });
  await page.evaluate(({ marks, title }) => {
    document.querySelectorAll(".fhmark,.fhnum,.fhlegend").forEach(n => n.remove());
    let n = 0; const rows = [];
    for (const m of marks) {
      const el = document.querySelector(m.sel);
      if (!el) continue;
      n += 1;
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY, left = r.left + window.scrollX;
      const box = document.createElement("div"); box.className = "fhmark";
      box.style.cssText += `top:${top-4}px;left:${left-4}px;width:${r.width+8}px;height:${r.height+8}px`;
      document.body.appendChild(box);
      const num = document.createElement("div"); num.className = "fhnum"; num.textContent = String(n);
      num.style.cssText += `top:${top-15}px;left:${left-15}px`;
      document.body.appendChild(num);
      rows.push(`<div><b>${n}</b>${m.text}</div>`);
    }
    const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const leg = document.createElement("div"); leg.className = "fhlegend";
    leg.style.top = (h + 20) + "px";
    leg.innerHTML = `<div style="color:#A1A1AA;letter-spacing:.16em;font-weight:700;margin-bottom:10px">${title}</div>${rows.join("")}`;
    document.body.appendChild(leg);
    document.body.style.minHeight = (h + 20 + 60 + rows.length * 26) + "px";
  }, { marks, title });
  await page.waitForTimeout(150);
}

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await b.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1.5 });
await page.addInitScript(() => { try { localStorage.setItem("fh_token","t"); } catch(e){} });
await page.goto("http://127.0.0.1:8099/app/affiliate.html", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await annotate(page, [
  { sel: "#affRate",       text: "RATE was the words 'Per agreement', read from nothing. It is now the real 20% from the rate table, with the 5% downline rate under it." },
  { sel: "#affRateNote",   text: "" },
  { sel: "#licenseBanner", text: "The payout hold now names the licence on record so it can be chased, instead of a bare 'unsigned'." },
  { sel: "#taxBanner",     text: "The tax gate says we hold NO RECORD — not that the affiliate failed to send one. Nothing writes that column yet and this page cannot tell the two apart." },
  { sel: "#leadBody",      text: "THE TABLE THAT SAID 'No referrals on file' FOR EVERY AFFILIATE, ALWAYS. Row 2's commission is a dash: the ledger has not worked it out, and a dash is not $0.00." }
].filter(m => m.text), "AFFILIATE SCREEN — what was hardcoded, and what is now read");
await page.screenshot({ path: "/tmp/claude-0/pw/shot-5-affiliate.png", fullPage: true });
await b.close();
console.log("ok");
