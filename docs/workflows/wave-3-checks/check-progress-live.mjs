import { chromium } from "playwright";
const TOKEN = process.env.TOK;
const errs = [];
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await b.newPage({ viewport: { width: 1100, height: 1500 }, deviceScaleFactor: 2 });
page.on("pageerror", e => errs.push("pageerror: " + e.message));
page.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !/fonts\.(googleapis|gstatic)|Failed to load resource/.test(t)) errs.push("console: " + t);
});
await page.addInitScript(t => { try { localStorage.setItem("fh_token", t); } catch(e){} }, TOKEN);

await page.goto("http://127.0.0.1:8099/progress.html", { waitUntil: "networkidle" });
await page.waitForSelector("#cStage .stage-h", { timeout: 8000 });
const text = () => page.locator("body").innerText();
const t1 = await text();

const out = {
  // it loaded from the REAL endpoint, not a "nearly ready" fallback
  realDataNotPlaceholder: !/nearly ready/i.test(t1) && /Round 2 of 6/.test(t1),
  overdueItemShown:       /Proof of address/.test(t1) && /overdue/i.test(t1),
  oneNextStepOwnedByYou:  /your move/i.test(t1),
  roundOfferedAt100:      /\$100/.test(t1),
  noBannedPhrase:         !/credit repair/i.test(t1),
  noFilingClaim:          !/\bfiled\b/i.test(t1),
};

// press Refer a friend for real
/* EITHER STATE IS CORRECT, so the check handles both rather than assuming a
   fresh file. A client who has never pressed it sees the button; one who has
   sees their link. Re-running this against the same database must not report a
   working page as broken just because the first run already enrolled them. */
const hasButton = await page.locator("#refGo").count();
out.startedFrom = hasButton ? "not yet enrolled" : "already enrolled";
if (hasButton) await page.locator("#refGo").click();
await page.waitForSelector("#refUrl", { timeout: 8000 });
/* The share link lives in an <input value=...>, and innerText does not include
   input values — reading it off the page text reported a working link as
   missing. Read the value. */
const shareUrl = await page.locator("#refUrl").inputValue();
out.referralMintedALink = /AFF-\d+/.test(await page.locator("#cReferral").innerText())
  && /start\.html\?ref=AFF-\d+/.test(shareUrl);

// reload: the page must now REMEMBER the enrolment via the progress endpoint
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#cStage .stage-h", { timeout: 8000 });
const t3 = await page.locator("#cReferral").innerText();
out.enrolmentSurvivesReload = /Your link is ready/.test(t3) && /AFF-\d+/.test(t3);

// the round button, all the way to the POST
await page.locator("#opt-creditor").click();
await page.locator("#opt-cfpb_and_ag").click();
await page.waitForTimeout(150);
out.totalAddsUpTo130 = (await page.locator("#paidTotal").textContent()).trim() === "$130";
await page.locator("#paidGo").click();
await page.waitForTimeout(250);
out.priceBrokenOut = /Creditor letter/.test(await page.locator("#dlg").innerText());
await page.locator('#dlgA button:has-text("Yes, continue")').click();
await page.waitForTimeout(250);
out.secondConfirmRepeatsAmount = /Confirm \$130/.test(await page.locator("#dlg").innerText());
await page.locator('#dlgA button:has-text("Take me to payment")').click();
await page.waitForTimeout(2500);
const dlg = await page.locator("#dlg").innerText();
out.postWasUnderstood = !/Not switched on yet/.test(dlg);
/* No payment key in a scratch container, so the link cannot be minted. The page
   must say that honestly and must NOT claim a failure — see the checkout_pending
   branch in progress.html. */
/* TWO OUTCOMES ARE BOTH CORRECT HERE and the check must accept either, because
   which one you get depends on whether this press is the first for that
   idempotency key:
     first press, mint fails  → 502 with the server's own refusal sentence
     repeat press, no link yet → ok:true with checkout_pending
   What must hold in BOTH: the client is told no money moved, and the page never
   claims a payment succeeded. Those are the assertions. */
out.saysNoMoneyMoved = /nothing has been charged|no card has been touched/i.test(dlg);
out.neverClaimsPaymentSucceeded = !/payment page is ready|paid|charged your/i.test(dlg);
out.reassuranceNotDuplicated =
  (dlg.match(/nothing has been charged/gi) || []).length <= 1;
out.postOutcome = dlg.split("\n")[0];
out.errors = errs;
console.log(JSON.stringify(out, null, 2));
await page.screenshot({ path: "/var/tmp/pg/live-progress.png", fullPage: true });
await b.close();
