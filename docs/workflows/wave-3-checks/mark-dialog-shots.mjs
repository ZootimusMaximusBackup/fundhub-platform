import { chromium } from "/home/user/fundhub-platform/node_modules/playwright/index.mjs";

const CSS = `
#dlg{position:relative}
#dlg .fhmark{position:absolute;border:3px solid #E11D48;border-radius:6px;pointer-events:none}
#dlg .fhnum{position:absolute;background:#E11D48;color:#fff;font:700 12px/20px Arial,sans-serif;
  width:20px;height:20px;border-radius:50%;text-align:center}
#dlg .fhleg{background:#0A0A0A;color:#fff;font:12px/1.6 Arial,sans-serif;padding:12px 16px;margin-top:4px}
#dlg .fhleg div{margin-bottom:4px}
#dlg .fhleg b{display:inline-block;background:#E11D48;color:#fff;width:17px;height:17px;border-radius:50%;
  text-align:center;font:700 10px/17px Arial,sans-serif;margin-right:7px}
`;

async function markDialog(page, marks, title) {
  await page.evaluate(({ marks, title }) => {
    const d = document.getElementById("dlg");
    d.querySelectorAll(".fhmark,.fhnum,.fhleg").forEach(n => n.remove());
    const dr = d.getBoundingClientRect();
    let n = 0; const rows = [];
    for (const m of marks) {
      const el = d.querySelector(m.sel);
      if (!el) continue;
      n += 1;
      const r = el.getBoundingClientRect();
      const box = document.createElement("div");
      box.className = "fhmark";
      box.style.cssText = `top:${r.top - dr.top - 4}px;left:${r.left - dr.left - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`;
      d.appendChild(box);
      const num = document.createElement("div");
      num.className = "fhnum"; num.textContent = String(n);
      num.style.cssText = `top:${r.top - dr.top - 12}px;left:${r.left - dr.left - 12}px`;
      d.appendChild(num);
      rows.push(`<div><b>${n}</b>${m.text}</div>`);
    }
    const leg = document.createElement("div");
    leg.className = "fhleg";
    leg.innerHTML = `<div style="color:#A1A1AA;letter-spacing:.14em;font-weight:700;margin-bottom:8px">${title}</div>${rows.join("")}`;
    d.appendChild(leg);
  }, { marks, title });
  await page.waitForTimeout(150);
}

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await b.newPage({ viewport: { width: 900, height: 800 }, deviceScaleFactor: 2 });
await page.addInitScript(() => { try { localStorage.setItem("fh_token", "t"); } catch (e) {} });
await page.goto("http://127.0.0.1:8099/progress.html", { waitUntil: "networkidle" });
await page.waitForSelector("#cStage .stage-h");
await page.addStyleTag({ content: CSS });

await page.locator("#paidGo").click();
await page.waitForTimeout(250);
await markDialog(page, [
  { sel: "#dlgB .rows", text: "STEP ONE — every line of the price itemised, with the total." },
  { sel: "#dlgS",       text: "Says in plain words that nothing is charged on this screen." }
], "THE ROUND BUTTON — first press shows the price");
await page.locator("#dlg").screenshot({ path: "/tmp/claude-0/pw/shot-3-price.png" });

await page.locator('#dlgA button:has-text("Yes, continue")').click();
await page.waitForTimeout(250);
await markDialog(page, [
  { sel: "#dlgT", text: "STEP TWO — a second, separate confirmation with the amount repeated. The first press is the one people make by accident." },
  { sel: "#dlgB .note:first-child", text: "A member of our team sends the round. Paying does not put anything in the post by itself." },
  { sel: "#dlgB .note:last-child",  text: "It still does not use a round from the programme." }
], "THE ROUND BUTTON — second press confirms the amount");
await page.locator("#dlg").screenshot({ path: "/tmp/claude-0/pw/shot-4-confirm.png" });

await b.close();
console.log("ok");
