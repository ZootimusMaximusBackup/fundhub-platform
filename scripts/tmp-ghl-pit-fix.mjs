/**
 * One-shot: log into GHL, open Private Integrations, enable SMS scopes,
 * copy/create PIT if needed, check phone numbers. Writes secrets to a
 * gitignored file only — never prints full tokens.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "credentials", "ghl-pit-session");
mkdirSync(OUT, { recursive: true });

const LOCATION_ID = "ORh91GeY4acceSASSnLR";
const REQUIRED_SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "conversations.readonly",
  "conversations.write",
  "conversations/message.readonly",
  "conversations/message.write",
  "locations.readonly",
];

function loadCreds() {
  const raw = readFileSync(join(ROOT, "credentials", "provider-logins.md"), "utf8");
  const email = (raw.match(/## GHL[\s\S]*?email:\s*(\S+)/) || [])[1];
  const password = (raw.match(/## GHL[\s\S]*?password:\s*(\S+)/) || [])[1];
  if (!email || !password) throw new Error("GHL creds missing from provider-logins.md");
  return { email, password };
}

function last4(s) {
  return s && s.length >= 4 ? s.slice(-4) : "(none)";
}

async function shot(page, name) {
  const p = join(OUT, `${name}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
  writeFileSync(join(OUT, `${name}.url.txt`), page.url());
  return p;
}

async function dump(page, name) {
  await shot(page, name);
  const html = await page.content().catch(() => "");
  writeFileSync(join(OUT, `${name}.html`), html.slice(0, 500_000));
  const text = await page.locator("body").innerText().catch(() => "");
  writeFileSync(join(OUT, `${name}.txt`), text.slice(0, 200_000));
}

async function maybeDismiss(page) {
  for (const sel of [
    'button:has-text("Accept")',
    'button:has-text("Got it")',
    'button:has-text("Close")',
    'button:has-text("Not now")',
    'button:has-text("Skip")',
    '[aria-label="Close"]',
  ]) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      await el.click().catch(() => {});
    }
  }
}

async function main() {
  const { email, password } = loadCreds();
  const result = {
    ok: false,
    login: "pending",
    twofa: false,
    integration: null,
    scopesEnabled: [],
    newTokenLast4: null,
    tokenWrote: false,
    phoneCheck: null,
    notes: [],
  };

  const browser = await chromium.launch({
    headless: false,
    slowMo: 80,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45_000);

  try {
    console.log("→ opening app.gohighlevel.com");
    await page.goto("https://app.gohighlevel.com/", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await dump(page, "01-landing");

    // Login form variants
    const emailSel = 'input[type="email"], input[name="email"], input#email, input[placeholder*="mail" i]';
    const passSel = 'input[type="password"], input[name="password"], input#password';

    // Sometimes landing is agency dashboard already (cookie). If login fields present, fill.
    if (await page.locator(emailSel).first().isVisible({ timeout: 8000 }).catch(() => false)) {
      console.log("→ filling email/password");
      await page.locator(emailSel).first().fill(email);
      await page.locator(passSel).first().fill(password);
      await shot(page, "02-filled");
      const submit = page.locator(
        'button[type="submit"], button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Login"), button:has-text("Continue")'
      ).first();
      await submit.click();
      await page.waitForTimeout(4000);
      await dump(page, "03-after-login-click");
    } else {
      result.notes.push("no login form visible — may already be sessioned");
      await dump(page, "02-no-login-form");
    }

    // 2FA / OTP?
    const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
    if (
      bodyText.includes("verification") ||
      bodyText.includes("two-factor") ||
      bodyText.includes("2fa") ||
      bodyText.includes("authenticate") ||
      bodyText.includes("security code") ||
      bodyText.includes("enter code") ||
      (await page.locator('input[name*="otp" i], input[placeholder*="code" i]').first().isVisible({ timeout: 1500 }).catch(() => false))
    ) {
      result.twofa = true;
      result.login = "blocked_2fa";
      await dump(page, "03-2fa");
      writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
      console.log("BLOCKED: 2FA — Chris must approve in authenticator / email / SMS");
      // keep browser open a bit for visibility
      await page.waitForTimeout(15_000);
      await browser.close();
      return;
    }

    result.login = "ok_or_partial";
    await maybeDismiss(page);

    // Try direct location settings URLs used by GHL v2
    const candidates = [
      `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/settings/private-integrations`,
      `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/settings/company`,
      `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/settings/`,
      `https://app.gohighlevel.com/location/${LOCATION_ID}/settings/private-integrations`,
      `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/settings/phone-system`,
    ];

    for (const url of candidates) {
      console.log("→ try", url);
      await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(3500);
      await maybeDismiss(page);
      const name = "nav-" + url.split("/").slice(-2).join("-");
      await dump(page, name);
      const t = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
      if (t.includes("private integration") || t.includes("create new integration") || page.url().includes("private-integration")) {
        result.notes.push(`landed private integrations via ${url}`);
        break;
      }
    }

    await dump(page, "10-settings-area");

    // If we see a list of integrations, click FundHub / pit
    const fundhubRow = page.locator('text=/FundHub|pit-|Private Integration/i').first();
    if (await fundhubRow.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("→ clicking FundHub/pit row");
      await fundhubRow.click().catch(() => {});
      await page.waitForTimeout(2000);
    }

    // Look for Edit / Create
    for (const label of ["Edit", "Create Private Integration", "Create New Integration", "Create", "New Integration"]) {
      const btn = page.getByRole("button", { name: new RegExp(label, "i") }).first();
      if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) {
        console.log("→ click button", label);
        await btn.click().catch(() => {});
        await page.waitForTimeout(2000);
        break;
      }
    }

    await dump(page, "11-integration-editor");

    // Enable checkboxes / switches matching required scopes (fuzzy text)
    const scopeHints = [
      [/contacts.*view|view.*contacts|contacts\.readonly/i, "contacts.readonly"],
      [/contacts.*edit|edit.*contacts|contacts\.write/i, "contacts.write"],
      [/conversations(?!.*message).*view|view.*conversations(?!.*message)|conversations\.readonly/i, "conversations.readonly"],
      [/conversations(?!.*message).*edit|edit.*conversations(?!.*message)|conversations\.write/i, "conversations.write"],
      [/message.*view|view.*message|conversations\/message\.readonly|conversation messages.*view/i, "conversations/message.readonly"],
      [/message.*edit|edit.*message|conversations\/message\.write|conversation messages.*edit|send.*message/i, "conversations/message.write"],
      [/locations.*view|view.*locations|locations\.readonly/i, "locations.readonly"],
    ];

    // Prefer clicking labels containing these words near unchecked inputs
    const enableTexts = [
      "View Contacts",
      "Edit Contacts",
      "View Conversations",
      "Edit Conversations",
      "View Conversation Messages",
      "Edit Conversation Messages",
      "View Locations",
      "contacts.readonly",
      "contacts.write",
      "conversations.readonly",
      "conversations.write",
      "conversations/message.readonly",
      "conversations/message.write",
      "locations.readonly",
    ];

    for (const text of enableTexts) {
      const loc = page.getByText(text, { exact: false }).first();
      if (!(await loc.isVisible({ timeout: 800 }).catch(() => false))) continue;
      // click nearby checkbox/switch
      const row = loc.locator("xpath=ancestor::*[self::label or self::div or self::li][1]");
      const box = row.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').first();
      if (await box.count()) {
        const checked =
          (await box.getAttribute("aria-checked").catch(() => null)) === "true" ||
          (await box.isChecked().catch(() => false));
        if (!checked) {
          await box.click({ force: true }).catch(async () => {
            await loc.click().catch(() => {});
          });
          result.scopesEnabled.push(text);
          await page.waitForTimeout(200);
        } else {
          result.scopesEnabled.push(`${text} (already on)`);
        }
      } else {
        await loc.click().catch(() => {});
        result.scopesEnabled.push(`${text} (clicked text)`);
      }
    }

    await dump(page, "12-scopes-toggled");

    // Save / Update / Continue
    for (const label of ["Update", "Save", "Continue", "Confirm", "Create"]) {
      const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") }).first();
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        console.log("→ save", label);
        await btn.click().catch(() => {});
        await page.waitForTimeout(2500);
        break;
      }
    }

    await dump(page, "13-after-save");

    // Look for token display / copy
    let token = null;
    const tokenRe = /pit-[A-Za-z0-9._-]{20,}/g;
    const pageText = await page.locator("body").innerText().catch(() => "");
    const html = await page.content().catch(() => "");
    const found = [...new Set([...(pageText.match(tokenRe) || []), ...(html.match(tokenRe) || [])])];
    if (found.length) {
      token = found[0];
      result.newTokenLast4 = last4(token);
      result.tokenWrote = true;
      writeFileSync(join(OUT, "new-pit-token.txt"), token + "\n", { mode: 0o600 });
      result.notes.push(`captured pit token last4=${result.newTokenLast4}`);
    } else {
      // Try Copy button
      const copyBtn = page.getByRole("button", { name: /copy/i }).first();
      if (await copyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await copyBtn.click().catch(() => {});
        await page.waitForTimeout(500);
        const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
        if (clip && clip.startsWith("pit-")) {
          token = clip.trim();
          result.newTokenLast4 = last4(token);
          result.tokenWrote = true;
          writeFileSync(join(OUT, "new-pit-token.txt"), token + "\n", { mode: 0o600 });
          result.notes.push(`copied pit token last4=${result.newTokenLast4}`);
        }
      }
    }

    // If no existing integration edit worked, try Create flow with name FundHub CRM
    if (!token && result.scopesEnabled.length === 0) {
      result.notes.push("could not clearly toggle scopes — UI may need manual assist; check screenshots");
    }

    // Phone numbers check
    const phoneUrls = [
      `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/settings/phone-system`,
      `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/settings/phone_numbers`,
      `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/settings/twilio`,
      `https://app.gohighlevel.com/v2/location/${LOCATION_ID}/phone-system/numbers`,
    ];
    for (const url of phoneUrls) {
      await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForTimeout(3000);
      const t = await page.locator("body").innerText().catch(() => "");
      await dump(page, "phone-" + url.split("/").pop());
      if (/phone|number|\+1|sms|lc phone/i.test(t) && t.length > 80) {
        const nums = t.match(/\+?1?[\s\-.]?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}/g) || [];
        result.phoneCheck = { url, sampleNumbers: [...new Set(nums)].slice(0, 8), snippet: t.slice(0, 1500) };
        break;
      }
    }

    result.ok = true;
    result.integration = "attempted";
    writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
    console.log("RESULT", JSON.stringify({ ...result, /* no token */ }, null, 2));
    await page.waitForTimeout(8000);
  } catch (err) {
    result.notes.push(String(err && err.message ? err.message : err));
    await dump(page, "99-error").catch(() => {});
    writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
    console.error("ERROR", err);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
