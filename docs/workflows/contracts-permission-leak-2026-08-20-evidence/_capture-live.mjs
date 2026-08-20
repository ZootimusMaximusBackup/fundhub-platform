import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import config from "../../../playwright.live.config.mjs";
import { BASE, staffPassword } from "../../../e2e/live-auth.mjs";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(OUT, "shots");
const RAW = path.join(SHOTS, "_raw");
fs.mkdirSync(RAW, { recursive: true });

const browser = await chromium.launch({
  headless: false,
  slowMo: 60,
  ...(config.use.launchOptions || {})
});
const proof = {
  base: BASE,
  captured_at: new Date().toISOString(),
  merge: "a60822ef2365b6cfcff5c5c1e432fdf04ed5234c",
  checks: {}
};

async function signInLikeAPerson(page, email, nextPath = "") {
  const next = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  await page.goto(`${BASE}/login.html${next}`, { waitUntil: "domcontentloaded" });
  const emailInput = page.locator('input[type="email"], #email, input[name="email"]').first();
  const passwordInput = page.locator('input[type="password"], #password, input[name="password"]').first();
  await emailInput.pressSequentially(email, { delay: 20 });
  await passwordInput.pressSequentially(staffPassword(), { delay: 20 });
  await page.locator('button[type="submit"], button:has-text("Sign"), button:has-text("Log")')
    .first().click();
  await page.waitForURL((url) => !/login\.html/.test(url.pathname), { timeout: 30_000 });
  if (nextPath) {
    await page.waitForURL((url) => url.pathname === nextPath, { timeout: 30_000 });
  } else {
    await page.waitForURL(/\/app\/[^/]+\.html(?:[?#]|$)/, { timeout: 30_000 });
  }
}

async function addMarks(page, title, marks) {
  await page.evaluate(({ proofTitle, proofMarks }) => {
    const old = document.getElementById("contracts-live-proof-marks");
    if (old) old.remove();

    const root = document.createElement("div");
    root.id = "contracts-live-proof-marks";
    root.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Arial,sans-serif";

    const captions = [];
    proofMarks.forEach((mark, index) => {
      const candidates = Array.from(document.querySelectorAll(mark.selector));
      const element = candidates.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 &&
          style.display !== "none" && style.visibility !== "hidden";
      });
      if (!element) throw new Error(`mark target missing: ${mark.selector}`);
      const rect = element.getBoundingClientRect();
      const number = index + 1;

      const box = document.createElement("div");
      box.style.cssText = [
        "position:fixed",
        `left:${Math.max(2, rect.left - 5)}px`,
        `top:${Math.max(2, rect.top - 5)}px`,
        `width:${Math.min(innerWidth - Math.max(2, rect.left - 5) - 2, rect.width + 10)}px`,
        `height:${Math.min(innerHeight - Math.max(2, rect.top - 5) - 2, rect.height + 10)}px`,
        "border:4px solid #e00000",
        "box-sizing:border-box",
        "border-radius:6px",
        "box-shadow:0 0 0 2px rgba(255,255,255,.9)"
      ].join(";");
      root.appendChild(box);

      const badge = document.createElement("div");
      badge.textContent = String(number);
      badge.style.cssText = [
        "position:fixed",
        `left:${Math.max(7, rect.left)}px`,
        `top:${Math.max(7, rect.top)}px`,
        "width:28px",
        "height:28px",
        "border-radius:50%",
        "background:#e00000",
        "color:#fff",
        "font:700 17px/28px Arial,sans-serif",
        "text-align:center",
        "box-shadow:0 0 0 2px #fff"
      ].join(";");
      root.appendChild(badge);
      captions.push(`<div><b>${number}</b> — ${mark.caption}</div>`);
    });

    const legend = document.createElement("div");
    legend.innerHTML = `<div style="font-weight:800;margin-bottom:5px">${proofTitle}</div>` +
      captions.join("");
    legend.style.cssText = [
      "position:fixed",
      "left:244px",
      "right:8px",
      "bottom:8px",
      "background:#fff",
      "color:#111",
      "border:3px solid #e00000",
      "border-radius:6px",
      "padding:9px 12px",
      "font:14px/1.35 Arial,sans-serif",
      "box-shadow:0 3px 14px rgba(0,0,0,.28)"
    ].join(";");
    root.appendChild(legend);
    document.body.appendChild(root);
  }, { proofTitle: title, proofMarks: marks });
}

async function captureCloser() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signInLikeAPerson(page, "closer@fundhub.ai");
  await page.addInitScript(() => {
    if (location.pathname !== "/app/contracts.html") return;
    localStorage.setItem("__contracts_protected_painted", "0");
    const check = () => {
      const card = document.getElementById("tplCard");
      if (!card) return;
      const style = getComputedStyle(card);
      if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") {
        localStorage.setItem("__contracts_protected_painted", "1");
      }
    };
    new MutationObserver(check).observe(document, {
      childList: true, subtree: true, attributes: true
    });
    requestAnimationFrame(check);
  });

  await page.goto(`${BASE}/app/contracts.html`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/app/closer-dashboard.html", { timeout: 20_000 });
  await page.locator("#fh-shell-chip").waitFor({ state: "visible" });

  const state = await page.evaluate(() => ({
    pathname: location.pathname,
    resolved_role: localStorage.getItem("fh_role"),
    protected_panel_painted: localStorage.getItem("__contracts_protected_painted") === "1",
    contract_nav_visible: Array.from(document.querySelectorAll('a.navitem[href^="contracts.html"]'))
      .some((link) => {
        const style = getComputedStyle(link);
        return style.display !== "none" && style.visibility !== "hidden";
      }),
    protected_copy_present: /Contract wording|Upload a PDF|New wording/.test(document.body.innerText)
  }));
  assert.deepEqual(state, {
    pathname: "/app/closer-dashboard.html",
    resolved_role: "closer",
    protected_panel_painted: false,
    contract_nav_visible: false,
    protected_copy_present: false
  });

  await page.screenshot({ path: path.join(RAW, "closer-live-direct-route.png") });
  await addMarks(page, "Closer — live read-only proof", [{
    selector: "#side",
    caption: "Contracts is absent. Typing /app/contracts.html safely returned here."
  }]);
  await page.screenshot({ path: path.join(SHOTS, "closer-live-direct-route-MARKED.png") });
  proof.checks.closer = state;
  await context.close();
}

async function captureOwnerOrAdmin(role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signInLikeAPerson(page, `${role}@fundhub.ai`, "/app/contracts.html");
  await page.goto(`${BASE}/app/contracts.html`, { waitUntil: "domcontentloaded" });
  await page.locator(".fh-page-access-confirmed").waitFor({ state: "attached" });
  await page.locator("#btnUpload").waitFor({ state: "visible" });
  await page.locator("#btnNewTpl").waitFor({ state: "visible" });
  await page.locator('a.navitem[href^="contracts.html"]:visible').first()
    .waitFor({ state: "visible" });
  await page.waitForFunction(() =>
    /\blive\b/i.test(document.getElementById("liveTxt")?.textContent || "")
  );

  const state = {
    pathname: new URL(page.url()).pathname,
    upload_visible: await page.locator("#btnUpload").isVisible(),
    new_wording_visible: await page.locator("#btnNewTpl").isVisible(),
    contract_nav_visible: await page.locator('a.navitem[href^="contracts.html"]:visible').count() > 0
  };
  assert.deepEqual(state, {
    pathname: "/app/contracts.html",
    upload_visible: true,
    new_wording_visible: true,
    contract_nav_visible: true
  });

  await page.screenshot({ path: path.join(RAW, `${role}-live-contracts.png`) });
  await addMarks(page, `${role === "owner" ? "Owner" : "Admin"} — live read-only proof`, [
    { selector: 'a.navitem[href^="contracts.html"]', caption: "Contracts menu row is visible." },
    { selector: "#btnUpload", caption: "Upload PDF is visible; it was not clicked." },
    { selector: "#btnNewTpl", caption: "New wording is visible; it was not clicked." }
  ]);
  await page.screenshot({ path: path.join(SHOTS, `${role}-live-contracts-MARKED.png`) });
  proof.checks[role] = state;
  await context.close();
}

try {
  await captureCloser();
  await captureOwnerOrAdmin("owner");
  await captureOwnerOrAdmin("admin");
  fs.writeFileSync(
    path.join(OUT, "live-proof.json"),
    JSON.stringify(proof, null, 2) + "\n"
  );
} finally {
  await browser.close();
}
