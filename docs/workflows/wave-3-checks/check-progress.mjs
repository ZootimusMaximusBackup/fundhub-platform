import { chromium } from "playwright";
const errs = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await b.newContext({ viewport: { width: 1100, height: 1400 } });
const page = await ctx.newPage();
/* A blocked external font request is not a page fault. This repo's pages link
   the Google Fonts stylesheet, and a sandbox with no outbound network logs a
   resource error for it that has nothing to do with the code under test. Only
   errors that are NOT that are collected. */
const THIRD_PARTY = /fonts\.(googleapis|gstatic)\.com|Failed to load resource/;
page.on("console", m => {
  if (m.type() === "error" && !THIRD_PARTY.test(m.text())) errs.push("console: " + m.text());
});
page.on("pageerror", e => errs.push("pageerror: " + e.message));

await page.addInitScript(() => { try { localStorage.setItem("fh_token", "fake-token"); } catch (e) {} });
await page.goto("http://127.0.0.1:8099/progress.html", { waitUntil: "networkidle" });
await page.waitForSelector("#cStage .stage-h", { timeout: 5000 });

const text = await page.locator("body").innerText();

const checks = [
  ["stage sentence",      /Round 2 of 6/],
  ["bureau deadline",     /bureaus ha(ve|d) until 2 April 2026/],
  ["movement items",      /2 items are gone/],
  ["movement score",      /up 36 since January/],
  ["not pulled yet",      /Not pulled yet/],
  ["next step is one",    /Proof of address/],
  ["whose move",          /your move/i],
  ["business toggle",     /Second Trade Co/i],
  ["paid round price",    /\$100/],
  ["no cap consumed",     /does not use one of your included rounds/],
  ["timeline painted",    /Round 2 letters mailed/],
  ["referral button",     /Refer a friend/]
];
const bad = checks.filter(([, re]) => !re.test(text)).map(([n]) => n);

// The two things the page must never say.
const banned = [];
if (/credit repair/i.test(text)) banned.push("credit repair");
if (/\bfiled\b/i.test(text)) banned.push("filed");
if (/\b0\b/.test(await page.locator("#cScores").innerText())) banned.push("a zero in the score panels");

await page.screenshot({ path: "/tmp/claude-0/pw/progress-full.png", fullPage: true });

// The business panel toggles rather than blending.
const before = await page.locator("#cScores .panels").last().innerText();
await page.locator('#bizToggle button[data-biz="1"]').click();
await page.waitForTimeout(200);
const after = await page.locator("#cScores .panels").last().innerText();
const toggled = before !== after && /Second Trade Co/.test(after) && /Not pulled yet/.test(after);

// The round button: price breakout, then a SECOND confirmation.
await page.locator("#paidGo").click();
await page.waitForTimeout(200);
const dlg1 = await page.locator("#dlg").innerText();
await page.locator('#dlgA button:has-text("Yes, continue")').click();
await page.waitForTimeout(250);
const dlg2 = await page.locator("#dlg").innerText();
await page.screenshot({ path: "/tmp/claude-0/pw/progress-confirm.png" });

console.log(JSON.stringify({
  missing: bad,
  banned,
  businessToggles: toggled,
  firstDialogBreaksOutPrice: /Three bureaus/.test(dlg1) && /Total/.test(dlg1),
  firstDialogChargesNothing: /Nothing is charged on this screen/.test(dlg1),
  secondDialogIsAConfirm: /Confirm \$100/.test(dlg2),
  secondDialogSaysHumanSends: /member of our team sends it/.test(dlg2),
  errors: errs
}, null, 2));
await b.close();
