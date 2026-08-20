import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const OUT = path.dirname(fileURLToPath(import.meta.url));
const BASE = "http://127.0.0.1:8917";
const browser = await chromium.launch({ headless: true });
const proof = { base: BASE, captured_at: new Date().toISOString(), closer: [], owner_admin: {} };

function demoStaff(role) {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    org_id: "00000000-0000-4000-8000-000000000002",
    name: role === "closer" ? "Closer Proof" : role === "owner" ? "Owner Proof" : "Admin Proof",
    email: `e2e+${role}@fundhub.test`,
    role
  };
}

async function seedRole(page, role, cachedRole = role) {
  await page.addInitScript(({ staff, cached }) => {
    localStorage.setItem("fh_token", "demo");
    localStorage.setItem("fh_demo", "1");
    localStorage.setItem("fh_demo_staff", JSON.stringify(staff));
    localStorage.setItem("fh_role", cached);

    if (location.pathname === "/app/contracts.html") {
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
    }
  }, { staff: demoStaff(role), cached: cachedRole });
}

async function markCloserProof(page, mobile) {
  await page.evaluate((isMobile) => {
    const old = document.getElementById("contracts-proof-marks");
    if (old) old.remove();

    const side = document.getElementById("side");
    if (!side) throw new Error("sidebar missing");
    const sr = side.getBoundingClientRect();

    const root = document.createElement("div");
    root.id = "contracts-proof-marks";
    root.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:Arial,sans-serif";

    const box = document.createElement("div");
    box.style.cssText = [
      "position:fixed",
      `left:${Math.max(3, sr.left + 3)}px`,
      `top:${Math.max(3, sr.top + 38)}px`,
      `width:${Math.max(20, sr.width - 6)}px`,
      `height:${Math.max(20, Math.min(innerHeight - 115, sr.height - 82))}px`,
      "border:4px solid #e00000",
      "box-sizing:border-box",
      "border-radius:6px",
      "box-shadow:0 0 0 2px rgba(255,255,255,.9)"
    ].join(";");
    root.appendChild(box);

    const number = document.createElement("div");
    number.textContent = "1";
    number.style.cssText = [
      "position:fixed",
      `left:${Math.max(8, sr.left + 9)}px`,
      `top:${Math.max(8, sr.top + 44)}px`,
      "width:28px",
      "height:28px",
      "border-radius:50%",
      "background:#e00000",
      "color:#fff",
      "font:700 17px/28px Arial,sans-serif",
      "text-align:center",
      "box-shadow:0 0 0 2px #fff"
    ].join(";");
    root.appendChild(number);

    const legend = document.createElement("div");
    legend.innerHTML =
      "<div style=\"font-weight:800;margin-bottom:4px\">1 — Closer menu</div>" +
      "<div>Contract templates is absent after a direct visit to /app/contracts.html.</div>" +
      "<div style=\"margin-top:4px;font-weight:700\">Safe result: " +
      location.pathname.replace(/</g, "&lt;") + "</div>";
    legend.style.cssText = [
      "position:fixed",
      isMobile ? "left:8px" : "left:244px",
      "right:8px",
      "bottom:8px",
      "background:#fff",
      "color:#111",
      "border:3px solid #e00000",
      "border-radius:6px",
      "padding:9px 12px",
      "font:14px/1.3 Arial,sans-serif",
      "box-shadow:0 3px 14px rgba(0,0,0,.28)"
    ].join(";");
    root.appendChild(legend);
    document.body.appendChild(root);
  }, mobile);
}

async function closerShot(width, height, filename) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const navigations = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations.push(frame.url());
  });

  // Deliberately stale owner hint: only the resolved closer session may decide.
  await seedRole(page, "closer", "owner");
  await page.goto(`${BASE}/app/contracts.html`, { waitUntil: "domcontentloaded" });
  await page.waitForURL("**/app/closer-dashboard.html", { timeout: 10_000 });
  await page.waitForSelector("#fh-shell-chip");

  const state = await page.evaluate(() => ({
    pathname: location.pathname,
    resolved_role: localStorage.getItem("fh_role"),
    protected_panel_painted: localStorage.getItem("__contracts_protected_painted") === "1",
    contract_nav_visible: Array.from(document.querySelectorAll('a.navitem[href^="contracts.html"]'))
      .some((a) => {
        const s = getComputedStyle(a);
        return s.display !== "none" && s.visibility !== "hidden";
      }),
    protected_copy_present: /Contract wording|Upload a PDF|New wording/.test(document.body.innerText)
  }));

  assert.equal(state.pathname, "/app/closer-dashboard.html");
  assert.equal(state.resolved_role, "closer");
  assert.equal(state.protected_panel_painted, false);
  assert.equal(state.contract_nav_visible, false);
  assert.equal(state.protected_copy_present, false);

  if (width <= 480) {
    await page.click("#fh-menu-btn");
    await page.waitForSelector("#side.open");
    await page.waitForFunction(() =>
      document.querySelector("#side").getBoundingClientRect().left >= -1);
  }
  await markCloserProof(page, width <= 480);
  await page.screenshot({ path: path.join(OUT, filename), fullPage: false });

  proof.closer.push({ width, height, filename, navigations, ...state });
  await context.close();
}

async function ownerAdminCheck(role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await seedRole(page, role);
  await page.goto(`${BASE}/app/contracts.html`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".fh-page-access-confirmed");
  await page.waitForSelector("#btnUpload:visible");
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
  proof.owner_admin[role] = state;
  await context.close();
}

try {
  await closerShot(1440, 900, "closer-direct-route-1440-MARKED.png");
  await closerShot(390, 844, "closer-direct-route-390-MARKED.png");
  await ownerAdminCheck("owner");
  await ownerAdminCheck("admin");
  fs.writeFileSync(path.join(OUT, "proof.json"), JSON.stringify(proof, null, 2) + "\n");
} finally {
  await browser.close();
}
