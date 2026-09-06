import { chromium } from "playwright";
const errs = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await b.newPage({ viewport: { width: 1400, height: 1200 }, deviceScaleFactor: 1.5 });
page.on("pageerror", e => errs.push(e.message));
await page.addInitScript(() => { try { localStorage.setItem("fh_token","t"); } catch(e){} });
await page.goto("http://127.0.0.1:8099/app/client-portal.html", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const html = await page.content();
const act = await page.locator("#tp-act").innerHTML();
console.log(JSON.stringify({
  fakeStepperGone:    !/id="stepper"/.test(html),
  preStepperKept:     /id="stepper-pre"/.test(html),
  progressLink:       /href="\/progress\.html"/.test(html),
  activityPainted:    /Round 2 letters mailed/.test(act),
  activityNotEmpty:   !/No activity recorded/.test(act),
  errors: errs
}, null, 2));
await b.close();
