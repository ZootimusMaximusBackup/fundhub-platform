// Hole 10 — Control Panel and Present must open the same file whether the link
// says ?id=, ?client=, ?client_id= or ?contact=. Before this, Control Panel
// ignored ?client= / ?contact= and Present ignored ?id= / ?client=, so a link
// from another screen landed on an empty "needs contact" page.

import { test, expect } from "@playwright/test";

const ID = "ac1ac964-e02b-468b-9cbe-7030e03dd13b";
const KEYS = ["id", "client", "client_id", "contact"];

/* Every screen here reaches the backend with the id in the query string or the
   body. Watching requests is the honest check: it proves the page decided which
   file to open, not just that it rendered. */
async function idsSeen(page, url) {
  const hits = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    let body = "";
    try { body = req.postData() || ""; } catch { /* GET */ }
    if (req.url().includes(ID) || body.includes(ID)) hits.push(req.url());
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  await page.goto(url);
  await page.waitForTimeout(1200);
  return hits;
}

for (const key of KEYS) {
  test(`control panel opens the file from ?${key}=`, async ({ page }) => {
    const hits = await idsSeen(page, `/app/client-control-panel.html?${key}=${ID}`);
    expect(hits.length, `no request carried the client id for ?${key}=`).toBeGreaterThan(0);
  });
}

for (const key of KEYS) {
  test(`present opens the file from ?${key}=`, async ({ page }) => {
    const hits = await idsSeen(page, `/app/present.html?${key}=${ID}`);
    expect(hits.length, `no request carried the client id for ?${key}=`).toBeGreaterThan(0);
  });
}
