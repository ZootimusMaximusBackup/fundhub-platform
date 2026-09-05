import { chromium } from "/home/user/fundhub-platform/node_modules/playwright/index.mjs";

const MARK_CSS = `
.fhmark{position:absolute;border:3px solid #E11D48;border-radius:6px;pointer-events:none;z-index:99998}
.fhnum{position:absolute;background:#E11D48;color:#fff;font:700 13px/22px Arial,sans-serif;
  width:22px;height:22px;border-radius:50%;text-align:center;z-index:99999;pointer-events:none}
.fhlegend{position:absolute;left:0;right:0;background:#0A0A0A;color:#fff;z-index:100000;
  font:13px/1.7 Arial,sans-serif;padding:16px 20px}
.fhlegend h4{font:700 12px/1.4 Arial,sans-serif;letter-spacing:.16em;margin:0 0 10px;color:#A1A1AA}
.fhlegend li{margin:0 0 4px;list-style:none}
.fhlegend b{display:inline-block;background:#E11D48;color:#fff;width:19px;height:19px;border-radius:50%;
  text-align:center;font:700 11px/19px Arial,sans-serif;margin-right:8px}
`;

async function annotate(page, marks, title) {
  await page.addStyleTag({ content: MARK_CSS });
  await page.evaluate(({ marks, title }) => {
    document.querySelectorAll(".fhmark,.fhnum,.fhlegend").forEach(n => n.remove());
    let n = 0;
    const legend = [];
    for (const m of marks) {
      const el = document.querySelector(m.sel);
      if (!el) continue;
      n += 1;
      const r = el.getBoundingClientRect();
      const top = r.top + window.scrollY, left = r.left + window.scrollX;
      const box = document.createElement("div");
      box.className = "fhmark";
      box.style.cssText += `top:${top - 4}px;left:${left - 4}px;width:${r.width + 8}px;height:${r.height + 8}px`;
      document.body.appendChild(box);
      const num = document.createElement("div");
      num.className = "fhnum";
      num.textContent = String(n);
      num.style.cssText += `top:${top - 15}px;left:${left - 15}px`;
      document.body.appendChild(num);
      legend.push(`<li><b>${n}</b>${m.text}</li>`);
    }
    const doc = document.documentElement;
    const h = Math.max(doc.scrollHeight, document.body.scrollHeight);
    const box = document.createElement("div");
    box.className = "fhlegend";
    box.style.top = (h + 24) + "px";
    box.innerHTML = `<h4>${title}</h4><ul>${legend.join("")}</ul>`;
    document.body.appendChild(box);
    document.body.style.minHeight = (h + 24 + 40 + legend.length * 24 + 40) + "px";
  }, { marks, title });
  await page.waitForTimeout(120);
}

const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await b.newPage({ viewport: { width: 1080, height: 1500 }, deviceScaleFactor: 2 });
await page.addInitScript(() => { try { localStorage.setItem("fh_token", "t"); } catch (e) {} });
await page.goto("http://127.0.0.1:8099/progress.html", { waitUntil: "networkidle" });
await page.waitForSelector("#cStage .stage-h");

await annotate(page, [
  { sel: "#cStage .stage-l",            text: "WHERE AM I — round 2 of 6, when it started, and the date the bureaus have to reply." },
  { sel: "#cScores .panel:nth-child(3)", text: "A bureau with no pull reads NOT PULLED YET. Never a 0, never a blank a client could read as a low score." },
  { sel: "#bizToggle",                   text: "Business credit is a LIST, not one blended number. Tapping a name switches which business is shown." },
  { sel: "#cMove .moveline",             text: "WHAT MOVED — items gone, and the middle score change against a real earlier reading." },
  { sel: "#cNext",                       text: "WHAT IS NEXT — exactly ONE thing, labelled YOUR MOVE or OUR MOVE. Never a list." }
], "PROGRESS PAGE — the three questions it answers, in order");
await page.screenshot({ path: "/tmp/claude-0/pw/shot-1-top.png", fullPage: true });

await page.evaluate(() => document.querySelectorAll(".fhmark,.fhnum,.fhlegend").forEach(n => n.remove()));
await annotate(page, [
  { sel: "#cWaypoints .wp:nth-child(2)", text: "Each item says WHOSE JOB IT IS, and shows OVERDUE when it is past its date." },
  { sel: "#cWaypoints .wp:last-child .alt", text: "Where a paid alternative exists it is priced right next to the job. An item with none simply has no button — never a 'free'." },
  { sel: "#paidGo",                      text: "The round button. Pressing it shows the price broken out; nothing is charged on this screen." },
  { sel: "#cPaid .note",                 text: "A paid round does NOT use up one of the rounds in the programme." },
  { sel: "#cReferral",                   text: "REFER A FRIEND — one press mints the client's own code and share link." }
], "PROGRESS PAGE — the checklist, the paid round, and referral");
await page.screenshot({ path: "/tmp/claude-0/pw/shot-2-list.png", fullPage: true });

// The two confirmations.
await page.evaluate(() => document.querySelectorAll(".fhmark,.fhnum,.fhlegend").forEach(n => n.remove()));
await page.locator("#paidGo").click();
await page.waitForTimeout(250);
await annotate(page, [
  { sel: "#dlgB .rows",  text: "STEP ONE — every line of the price, itemised, with the total." },
  { sel: "#dlgS",        text: "Says in plain words that nothing is charged on this screen." }
], "THE ROUND BUTTON — first press shows the price");
await page.screenshot({ path: "/tmp/claude-0/pw/shot-3-price.png" });

await page.evaluate(() => document.querySelectorAll(".fhmark,.fhnum,.fhlegend").forEach(n => n.remove()));
await page.locator('#dlgA button:has-text("Yes, continue")').click();
await page.waitForTimeout(250);
await annotate(page, [
  { sel: "#dlgT",     text: "STEP TWO — a SECOND, separate confirmation with the amount repeated. The first press is the one people make by accident." },
  { sel: "#dlgB",     text: "Says a member of our team sends the round. Paying does not put anything in the post by itself." }
], "THE ROUND BUTTON — second press confirms the amount");
await page.screenshot({ path: "/tmp/claude-0/pw/shot-4-confirm.png" });

await b.close();
console.log("shots written");
