import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = join(__dirname, "artifacts-v2");
mkdirSync(ARTIFACTS, { recursive: true });

const PAGES = [
  { path: "/watch.html", hasWidget: false, hasMarquee: true, hasVideoCard: true, scheduler: false },
  { path: "/apply.html", hasWidget: true, hasMarquee: true, hasVideoCard: false, scheduler: false },
  { path: "/book.html", hasWidget: true, hasMarquee: true, hasVideoCard: false, scheduler: true },
  { path: "/thank-you.html", hasWidget: false, hasMarquee: true, hasVideoCard: false, scheduler: false },
];

const VIEWPORTS = [320, 375, 390, 430, 768, 1024, 1280, 1440, 1920];
const CSS_ZOOMS = [0.5, 0.8, 1, 1.25, 1.5, 2];
const DPRS = [1, 2, 3];

/** Full break matrix — assertions only (screenshots would be thousands of files). */
const MATRIX = [];
for (const page of PAGES) {
  for (const width of VIEWPORTS) {
    for (const dpr of DPRS) {
      for (const zoom of CSS_ZOOMS) {
        MATRIX.push({ page, width, dpr, zoom });
      }
    }
  }
}

async function applyZoom(page, zoom) {
  await page.evaluate((z) => {
    document.documentElement.style.zoom = String(z);
  }, zoom);
}

async function layoutReport(page, { hasWidget, hasMarquee, hasVideoCard, scheduler, width, zoom }) {
  return page.evaluate(
    ({ hasWidget, hasMarquee, hasVideoCard, scheduler, width, zoom }) => {
      const report = {
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        overflow: false,
        gridOk: false,
        blackBand: false,
        marqueeOk: !hasMarquee,
        widgetOk: !hasWidget,
        footerOk: false,
        ghostOk: true,
        schedulerOk: !scheduler,
      };

      const z = zoom || 1;
      report.overflow =
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

      const before = getComputedStyle(document.body, "::before");
      const bgImage = before.backgroundImage || "";
      const covers =
        (before.position === "fixed" || before.position === "absolute") &&
        (before.inset === "0px" ||
          (before.top === "0px" && before.left === "0px" && before.right === "0px") ||
          before.minHeight === "100%");
      report.gridOk =
        bgImage.includes("linear-gradient") &&
        covers &&
        before.pointerEvents === "none";

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const areaLimit = vw * vh * 0.2;
      let blackArea = 0;
      for (const el of document.querySelectorAll("*")) {
        if (hasVideoCard && el.closest?.(".media")) continue;
        const cs = getComputedStyle(el);
        if (cs.backgroundColor.replace(/\s/g, "") !== "rgb(10,10,10)") continue;
        const r = el.getBoundingClientRect();
        const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
        const h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
        blackArea += w * h;
      }
      report.blackBand = blackArea > areaLimit;

      if (hasMarquee) {
        const track = document.querySelector(".marq-track");
        if (track) {
          const cs = getComputedStyle(track);
          report.marqueeOk =
            cs.animationName.includes("fhmarq") && cs.animationPlayState === "running";
        } else {
          report.marqueeOk = false;
        }
      }

      if (hasWidget) {
        const w = document.querySelector('[data-testid="fh-widget"]');
        if (w) {
          const cs = getComputedStyle(w);
          const r = w.getBoundingClientRect();
          const radius = parseFloat(cs.borderRadius) || 0;
          const cssWidth = r.width / z;
          report.widgetOk =
            radius > 0 &&
            cs.boxShadow !== "none" &&
            (width < 1024 || cssWidth <= 940);
        } else {
          report.widgetOk = false;
        }
      }

      const footer = document.querySelector("footer");
      if (footer) {
        const cs = getComputedStyle(footer);
        const bg = cs.backgroundColor.replace(/\s/g, "");
        report.footerOk = bg === "rgb(255,255,255)" || bg === "rgb(252,252,252)";
      }

      const ghost = document.querySelector(".ghost-mark .logo");
      if (ghost) {
        const cs = getComputedStyle(ghost);
        // period + letter bleed: negative margin bottom approved
        const mb = parseFloat(cs.marginBottom) || 0;
        report.ghostOk = mb < 0 || cs.opacity !== "0";
      }

      if (scheduler) {
        const slot = document.querySelector(
          '[data-page-element="AppointmentScheduler/V1"] button.cf2__time-slot, [data-page-element="AppointmentScheduler/V1"] button.DTP__time-slot',
        );
        const confirm = document.querySelector(
          '[data-page-element="AppointmentScheduler/V1"] button.cf2__confirm-button, [data-page-element="AppointmentScheduler/V1"] button.DTP__confirm-button',
        );
        const sidebar = document.querySelector(
          '[data-page-element="AppointmentScheduler/V1"] [class*="sm:w-1/3"]',
        );
        const addGuest = document.querySelector(
          '[data-page-element="AppointmentScheduler/V1"] .add-guest',
        );
        let slotH = 0;
        if (slot) {
          // account for CSS zoom on ancestor via getBoundingClientRect
          slotH = slot.getBoundingClientRect().height / z;
        }
        const confirmVisible = confirm
          ? getComputedStyle(confirm).display !== "none" &&
            getComputedStyle(confirm).visibility !== "hidden"
          : false;
        const confirmBg = confirm ? getComputedStyle(confirm).backgroundColor.replace(/\s/g, "") : "";
        const sidebarHidden = !sidebar || getComputedStyle(sidebar).display === "none";
        const guestHidden = !addGuest || getComputedStyle(addGuest).display === "none";
        // At 320: slots ≥44px visual when zoom=1; at other zooms scale expectation by layout zoom only
        const minTap = width <= 640 ? 44 : 30;
        report.schedulerOk =
          !!slot &&
          slotH + 0.5 >= minTap &&
          confirmVisible &&
          (confirmBg === "rgb(24,139,246)" || confirmBg === "#188bf6") &&
          sidebarHidden &&
          guestHidden;
        report.slotH = slotH;
        report.confirmBg = confirmBg;
      }

      return report;
    },
    { hasWidget, hasMarquee, hasVideoCard, scheduler, width, zoom },
  );
}

test.describe("CF fragment break matrix", () => {
  for (const { page: meta, width, dpr, zoom } of MATRIX) {
    const name = `${meta.path} @${width} dpr${dpr} zoom${zoom}`;
    test(name, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        deviceScaleFactor: dpr,
      });
      const page = await context.newPage();
      await page.goto(meta.path, { waitUntil: "domcontentloaded" });
      await applyZoom(page, zoom);
      await page.waitForTimeout(50);

      const report = await layoutReport(page, { ...meta, width, zoom });

      expect(
        report.overflow,
        `horizontal overflow: scrollWidth=${report.scrollWidth} innerWidth=${report.innerWidth}`,
      ).toBe(false);
      expect(report.gridOk, "fixed/absolute grid layer missing").toBe(true);
      expect(report.blackBand, "black band covering >20% viewport").toBe(false);
      expect(report.marqueeOk, "marquee animation not running").toBe(true);
      expect(report.widgetOk, "widget card styles failed").toBe(true);
      expect(report.footerOk, "footer not solid white").toBe(true);
      expect(report.ghostOk, "ghost wordmark period/bleed missing").toBe(true);
      if (meta.scheduler && zoom === 1) {
        expect(
          report.schedulerOk,
          `scheduler polish failed slotH=${report.slotH} confirmBg=${report.confirmBg}`,
        ).toBe(true);
      }

      await context.close();
    });
  }
});

test.describe("visual baselines (canonical)", () => {
  const shots = [
    { path: "/watch.html", width: 1280 },
    { path: "/apply.html", width: 1280 },
    { path: "/book.html", width: 1280 },
    { path: "/thank-you.html", width: 1280 },
    { path: "/apply.html", width: 375 },
    { path: "/book.html", width: 375 },
  ];
  for (const { path, width } of shots) {
    test(`screenshot ${path} ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(200);
      await expect(page).toHaveScreenshot(`${path.replace(/\W+/g, "_")}_${width}.png`, {
        fullPage: true,
        animations: "disabled",
        maxDiffPixelRatio: 0.005,
      });
    });
  }
});

test.describe("before/after + grid A/B artifacts", () => {
  test("book before/after at 375 and 1440", async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/book.html", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: join(ARTIFACTS, `book-after-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  });

  test("apply before/after at 375 and 1440", async ({ page }) => {
    for (const width of [375, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/apply.html", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: join(ARTIFACTS, `apply-after-${width}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  });

  test("grid A/B pair at 1280", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/grid-a-fixed.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: join(ARTIFACTS, "grid-a-fixed-1280.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/grid-b-absolute.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: join(ARTIFACTS, "grid-b-absolute-1280.png"),
      fullPage: true,
      animations: "disabled",
    });
    // Also zoom stress for absolute (Bug 3 tear check — evidence only)
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1.5";
    });
    await page.waitForTimeout(100);
    await page.screenshot({
      path: join(ARTIFACTS, "grid-b-absolute-1280-zoom150.png"),
      fullPage: true,
      animations: "disabled",
    });
  });

  test("scheduler usable at 320", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto("/book.html", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(100);
    const report = await layoutReport(page, {
      hasWidget: true,
      hasMarquee: true,
      hasVideoCard: false,
      scheduler: true,
      width: 320,
      zoom: 1,
    });
    expect(report.overflow).toBe(false);
    expect(report.schedulerOk).toBe(true);
    await page.screenshot({
      path: join(ARTIFACTS, "book-scheduler-320.png"),
      fullPage: true,
      animations: "disabled",
    });
  });
});

test.describe("watch favicon", () => {
  test("overrides tab icon with fundhub mark", async ({ page }) => {
    await page.goto("/watch.html", { waitUntil: "domcontentloaded" });
    const icons = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel*="icon"],link[rel="apple-touch-icon"]')].map((l) => ({
        rel: l.rel,
        hrefHead: l.href.slice(0, 22),
        sizes: l.getAttribute("sizes"),
      })),
    );
    expect(
      icons.some((i) => i.hrefHead === "data:image/png;base64," && i.rel.includes("icon")),
    ).toBe(true);
    expect(icons.some((i) => i.rel === "apple-touch-icon" && i.sizes === "180x180")).toBe(
      true,
    );
  });
});
