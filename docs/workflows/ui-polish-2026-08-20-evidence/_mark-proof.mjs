/* Build marked before/after proof sheets with browser-drawn callouts. */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const SOURCE = path.join(ROOT, "docs/workflows/ui-standards-audit-2026-08-20/evidence");
const AFTER = path.join(HERE, "after");
const MARKED = path.join(HERE, "marked");
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || "/usr/local/bin/google-chrome";

const CASES = [
  {
    id: "shared-mobile-account-row", screen: "closer-call", viewport: "390",
    before: [3, 77, 94, 21], after: [2, 5, 96, 15],
    beforeText: "The account bar covers live call facts at the bottom of the phone.",
    afterText: "The account bar is in page flow above the call facts."
  },
  {
    id: "pipeline-header", screen: "pipeline", viewport: "1440",
    before: [16, 0, 82, 11], after: [16, 0, 83, 14],
    beforeText: "The title, company tag, clock, search, and account bar collide.",
    afterText: "The clock leaves before the surviving header controls collide."
  },
  {
    id: "lenders-header", screen: "lenders", viewport: "1440",
    before: [16, 0, 83, 11], after: [16, 0, 83, 12],
    beforeText: "The pushed clock breaks the lender header into overlapping lines.",
    afterText: "The header wraps cleanly and drops the expendable clock."
  },
  {
    id: "products-overflow", screen: "products-commissions", viewport: "1440",
    before: [15, 0, 84, 28], after: [15, 0, 84, 30],
    beforeText: "The closed editor and header controls make the page wider than the laptop.",
    afterText: "The closed editor is inert and the full header stays inside the laptop."
  },
  {
    id: "contracts-role", screen: "contracts", viewport: "closer-1440",
    before: [15, 7, 84, 72], after: [0, 0, 30, 82],
    beforeText: "A closer can see the Owner and Admin contract-wording controls.",
    afterText: "A closer is sent home and has no Contract templates menu row."
  },
  {
    id: "client-control-panel-phone", screen: "client-control-panel", viewport: "390",
    before: [0, 10, 100, 86], after: [2, 27, 96, 61],
    beforeText: "The phone view has dead space and two squeezed side-by-side panels.",
    afterText: "The client picker and key facts stack in one readable flow."
  },
  {
    id: "documents-phone", screen: "documents", viewport: "390",
    before: [3, 0, 95, 96], after: [3, 0, 94, 96],
    beforeText: "The floating account bar covers controls and the cards stay narrow.",
    afterText: "Account controls reserve header space and cards use one phone column."
  },
  {
    id: "calendar-phone", screen: "calendar", viewport: "390",
    before: [0, 0, 100, 34], after: [2, 0, 96, 77],
    beforeText: "The weekly strip runs off the phone and hides Friday and Saturday.",
    afterText: "Date controls and daily numbers stack without sideways page overflow."
  },
  {
    id: "messaging-phone", screen: "messaging", viewport: "390",
    before: [54, 72, 45, 27], after: [53, 72, 44, 26],
    beforeText: "The fixed Chat control covers conversation context.",
    afterText: "The message column reserves clear space around the fixed control."
  },
  {
    id: "my-numbers-copy", screen: "my-numbers", viewport: "1440",
    before: [16, 19, 68, 26], after: [16, 19, 68, 26],
    beforeText: "The empty offer area exposes a raw API path.",
    afterText: "The empty offer area gives a plain-language answer."
  },
  {
    id: "sales-floor-funnel", screen: "sales-floor", viewport: "390",
    before: [2, 23, 96, 49], after: [2, 23, 96, 70],
    beforeText: "The funnel squeezes columns and leaves an unexplained gray cell.",
    afterText: "Each funnel step is a full-width card with clear spacing."
  },
  {
    id: "template-editor-state", screen: "template-editor", viewport: "1440",
    before: [15, 0, 84, 25], after: [15, 0, 84, 25],
    beforeText: "The finished empty page still says Loading.",
    afterText: "The status truthfully says there are no messages yet."
  },
  {
    id: "inquiry-metric-hierarchy", screen: "inquiry-remover", viewport: "1440",
    before: [16, 11, 46, 33], after: [16, 11, 46, 33],
    beforeText: "Workload numbers are barely larger than their labels.",
    afterText: "Workload numbers use the shared large metric size."
  },
  {
    id: "content-admin-phone", screen: "content-admin", viewport: "390",
    before: [0, 0, 100, 52], after: [0, 0, 96, 58],
    beforeText: "Account and Save controls float over the phone content.",
    afterText: "Header and Save controls wrap into their own rows."
  },
  {
    id: "agent-editor-bottom", screen: "agent-editor", viewport: "390",
    before: [0, 68, 100, 31], after: [0, 68, 96, 31],
    beforeText: "The fixed orange status bar covers the last card.",
    afterText: "The editor reserves bottom space above the fixed status bar."
  },
  {
    id: "client-portal-signature", screen: "client-portal", viewport: "1440",
    before: [24, 29, 53, 68], after: [24, 31, 53, 66],
    beforeText: "The signature action ends below the 900-pixel laptop view.",
    afterText: "The welcome stays first and the complete signature action fits in view."
  }
];

function imageData(file) {
  return `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
}

function sourceFile(item) {
  const sourceViewport = item.viewport === "closer-1440" ? "1440" : item.viewport;
  return path.join(SOURCE, item.screen, `annotated-${sourceViewport}.png`);
}

function afterFile(item) {
  const name = item.viewport === "closer-1440"
    ? "closer-1440-fold.png"
    : `${item.viewport}-fold.png`;
  return path.join(AFTER, item.screen, name);
}

function markStyle([left, top, width, height]) {
  return `left:${left}%;top:${top}%;width:${width}%;height:${height}%`;
}

fs.mkdirSync(MARKED, { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 1300 } });

for (const item of CASES) {
  const before = imageData(sourceFile(item));
  const after = imageData(afterFile(item));
  await page.setContent(`<!doctype html>
    <style>
      *{box-sizing:border-box}body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif}
      #sheet{width:1400px;background:#fff}
      .title{padding:18px 24px;background:#09090b;color:#fff;font-size:24px;font-weight:800}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:2px;background:#dc2626}
      .panel{position:relative;background:#fff;overflow:hidden;min-height:440px;display:flex;align-items:flex-start;justify-content:center}
      .panel img{display:block;width:100%;height:auto}
      .tag{position:absolute;left:14px;top:14px;z-index:3;background:#09090b;color:#fff;border-radius:6px;padding:8px 12px;font-size:18px;font-weight:800}
      .mark{position:absolute;border:6px solid #ef2222;z-index:2;box-shadow:0 0 0 2px #fff}
      .num{position:absolute;left:-5px;top:-42px;width:36px;height:36px;border-radius:50%;background:#ef2222;color:#fff;text-align:center;line-height:36px;font-size:21px;font-weight:900}
      .legend{padding:18px 24px 22px;border-top:4px solid #ef2222;background:#fff}
      .line{display:flex;gap:12px;align-items:flex-start;margin:7px 0;font-size:20px;line-height:1.35}
      .dot{flex:0 0 32px;height:32px;border-radius:50%;background:#ef2222;color:#fff;text-align:center;line-height:32px;font-weight:900}
    </style>
    <div id="sheet">
      <div class="title">${item.id.replaceAll("-", " ").toUpperCase()}</div>
      <div class="grid">
        <div class="panel"><span class="tag">BEFORE</span><img src="${before}">
          <span class="mark" style="${markStyle(item.before)}"><span class="num">1</span></span>
        </div>
        <div class="panel"><span class="tag">AFTER</span><img src="${after}">
          <span class="mark" style="${markStyle(item.after)}"><span class="num">2</span></span>
        </div>
      </div>
      <div class="legend">
        <div class="line"><span class="dot">1</span><span>${item.beforeText}</span></div>
        <div class="line"><span class="dot">2</span><span>${item.afterText}</span></div>
      </div>
    </div>`);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
  await page.locator("#sheet").screenshot({ path: path.join(MARKED, `${item.id}-MARKED.png`) });
}

await browser.close();
console.log(JSON.stringify({ markedPairs: CASES.length, output: MARKED }, null, 2));
