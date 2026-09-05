import { chromium } from "playwright";
const CSS = `.fhmark{position:absolute;border:3px solid #E11D48;border-radius:6px;pointer-events:none;z-index:99998}
.fhnum{position:absolute;background:#E11D48;color:#fff;font:700 13px/22px Arial,sans-serif;width:22px;height:22px;border-radius:50%;text-align:center;z-index:99999}
.fhlegend{position:absolute;left:0;right:0;background:#0A0A0A;color:#fff;z-index:100000;font:13px/1.7 Arial,sans-serif;padding:16px 20px}
.fhlegend div{margin-bottom:4px}
.fhlegend b{display:inline-block;background:#E11D48;color:#fff;width:19px;height:19px;border-radius:50%;text-align:center;font:700 11px/19px Arial,sans-serif;margin-right:8px}`;
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await b.newPage({ viewport: { width: 1080, height: 1500 }, deviceScaleFactor: 2 });
await page.addInitScript(t => { try { localStorage.setItem("fh_token", t); } catch(e){} }, process.env.TOK);
await page.goto("http://127.0.0.1:8099/progress.html", { waitUntil: "networkidle" });
await page.waitForSelector("#cStage .stage-h");
await page.locator("#refGo").click().catch(()=>{});
await page.waitForTimeout(1200);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#cStage .stage-h");
await page.addStyleTag({ content: CSS });
await page.evaluate((marks) => {
  let n = 0; const rows = [];
  for (const m of marks) {
    const el = document.querySelector(m.sel); if (!el) continue;
    n++; const r = el.getBoundingClientRect();
    const top = r.top + scrollY, left = r.left + scrollX;
    const box = document.createElement("div"); box.className = "fhmark";
    box.style.cssText += `top:${top-4}px;left:${left-4}px;width:${r.width+8}px;height:${r.height+8}px`;
    document.body.appendChild(box);
    const num = document.createElement("div"); num.className="fhnum"; num.textContent=String(n);
    num.style.cssText += `top:${top-15}px;left:${left-15}px`; document.body.appendChild(num);
    rows.push(`<div><b>${n}</b>${m.text}</div>`);
  }
  const h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
  const leg = document.createElement("div"); leg.className="fhlegend"; leg.style.top=(h+20)+"px";
  leg.innerHTML = `<div style="color:#A1A1AA;letter-spacing:.16em;font-weight:700;margin-bottom:10px">THE PROGRESS PAGE, ON REAL DATA — no fixture, real endpoint, real database</div>${rows.join("")}`;
  document.body.appendChild(leg);
  document.body.style.minHeight = (h+20+70+rows.length*26)+"px";
}, [
  { sel: "#cStage .stage-l", text: "Read from the live endpoint — the round, the stage, and the date the bureaus have to reply. Before today this whole page said 'nearly ready'." },
  { sel: "#cNext", text: "One item, owned by the client, marked overdue — computed from its due date, never stored." },
  { sel: "#cPaid .opt:nth-of-type(3)", text: "The add-on that used to read 'CFPB and state attorney general FILINGS'. The word is gone: nothing here records that anything was filed." },
  { sel: "#paidGo", text: "This button posted to an address that did not exist, in a shape the server did not read. It now reaches the real endpoint." },
  { sel: "#cReferral", text: "Refer a friend, pressed for real — the code and link survived a page reload, which is the seam that was broken in both directions." }
]);
await page.waitForTimeout(200);
await page.screenshot({ path: "/var/tmp/pg/live-annotated.png", fullPage: true });
await b.close(); console.log("ok");
