import { chromium } from "playwright";
const errs = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await b.newPage({ viewport: { width: 1400, height: 1400 }, deviceScaleFactor: 1.5 });
page.on("pageerror", e => errs.push("pageerror: " + e.message));
await page.addInitScript(() => {
  try { localStorage.setItem("fh_token","t"); localStorage.setItem("fh_role","affiliate"); } catch(e){}
});
await page.goto("http://127.0.0.1:8099/app/affiliate.html", { waitUntil: "networkidle" });
await page.waitForTimeout(900);
const text = await page.locator("body").innerText();
/* The payouts table sits on a tab that is not the open one, and innerText skips
   hidden elements — so it is read from its own container rather than from the
   page text, which would report it missing when it is simply not on screen. */
const payText = await page.locator("#payBody").innerText();
console.log(JSON.stringify({
  noReferralsMessageGone: !/No referrals on file/.test(text),
  showsAReferral:       /Marcus Bell/.test(text),
  unknownStaysADash:    /Priya Raman/.test(text),
  realRate:             /20%/.test(text),
  downlineRate:         /5% on their referrals/.test(text),
  cookieTileGone:       !/60d/.test(text),
  attributionHonest:    /no expiry is recorded/.test(text),
  licenceGate:          /partner license is not signed/i.test(text),
  taxGate:              /no record of your tax form/i.test(text),
  payoutRowCarriesItsOwnHoldReason: /partner license unsigned/.test(payText),
  code:                 /AFF-000123/.test(text),
  bannedPhraseAbsent:   !/credit repair/i.test(text),
  errors: errs
}, null, 2));
await page.screenshot({ path: "/tmp/claude-0/pw/aff-raw.png", fullPage: true });
await b.close();
