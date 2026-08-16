// Products, client control panel, calendar — the persist / handler fixes.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

test.describe("products & commissions", () => {

  test("Save posts to /api/products", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/products-commissions.html", OWNER, {
      "/api/read/products": {
        ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
        items: [{
          code: "funding_bundle", name: "Funding Bundle", category: "funding",
          default_price: 3000, min_price: 2000, max_price: 5000,
          price_is_variable: true, active_rules: 1
        }]
      },
      "/api/read/commissions": { ok: true, count: 0, items: [] },
      "/api/products": async (route, { method }) => {
        if (method === "POST") {
          const body = JSON.parse(route.request().postData() || "{}");
          writes.push(body);
          return json(route, {
            ok: true, action: body.action,
            product: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              code: body.code || "funding_bundle",
              name: body.name, category: body.category,
              default_price: body.default_price, min_price: body.min_price,
              max_price: body.max_price, price_is_variable: body.price_is_variable
            }
          });
        }
        return json(route, { ok: true });
      }
    });
    await page.locator("tr[data-p], #prodBody tr, tbody tr").first().click();
    const name = page.locator("#p_name");
    await expect(name).toBeVisible({ timeout: 5000 });
    await name.fill("Funding Bundle Plus");
    await page.locator("#edSave").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].action).toBe("save");
    expect(writes[0].name).toBe("Funding Bundle Plus");
  });

  test("rails column stays empty rather than inventing funnels", async ({ page }) => {
    await openScreen(page, "/app/products-commissions.html", OWNER, {
      "/api/read/products": {
        ok: true, count: 1, items: [{
          code: "funding_bundle", name: "Funding Bundle", category: "funding",
          default_price: 3000, min_price: 2000, max_price: 5000,
          price_is_variable: true, active_rules: 0
        }]
      },
      "/api/read/commissions": { ok: true, items: [] }
    });
    await expect(page.locator("body")).not.toContainText("Sales · Card Stacking · Repair");
  });
});

test.describe("client control panel open buttons", () => {

  test("Open Funding Matrix goes to finance-os with the client id", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER);
    await page.locator("#more-menu summary, details.more > summary").click();
    const btn = page.locator('[data-open="funding"]');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page).toHaveURL(new RegExp(`finance-os\\.html\\?client_id=${CLIENT_ID}`));
  });

  test("GHL Contact stays disabled with no contact URL", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER);
    await expect(page.locator('[data-open="ghl"]')).toBeDisabled();
  });

  test("Raw Report opens documents", async ({ page }) => {
    await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}`, OWNER);
    await page.locator("#more-menu summary, details.more > summary").click();
    const btn = page.locator('[data-open="raw"]');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page).toHaveURL(/documents\.html/);
  });
});

test.describe("calendar Join Call and Client file", () => {

  test("buttons are disabled when nothing is up next", async ({ page }) => {
    await openScreen(page, "/app/calendar.html", OWNER, {
      "/api/tasks": { ok: true, tasks: [] }
    });
    await expect(page.locator("#unJoin")).toBeDisabled();
    await expect(page.locator("#unFile")).toBeDisabled();
  });

  test("Client file enables when a dated task has a client_id", async ({ page }) => {
    const due = new Date();
    due.setHours(due.getHours() + 1);
    await openScreen(page, "/app/calendar.html", OWNER, {
      "/api/tasks": {
        ok: true,
        tasks: [{
          id: "task-1", client_id: CLIENT_ID, client_name: "Dana Whitfield",
          title: "Follow-up call", body: "Confirm docs",
          due_at: due.toISOString(), assignee_name: "Jordan Blake", done: false
        }]
      }
    });
    await expect(page.locator("#unFile")).toBeEnabled({ timeout: 5000 });
    await page.locator("#unFile").click();
    await expect(page).toHaveURL(new RegExp(`client-control-panel\\.html\\?client_id=${CLIENT_ID}`));
  });

  test("Join Call stays disabled without a meeting URL", async ({ page }) => {
    const due = new Date();
    due.setHours(due.getHours() + 1);
    await openScreen(page, "/app/calendar.html", OWNER, {
      "/api/tasks": {
        ok: true,
        tasks: [{
          id: "task-1", client_id: CLIENT_ID, client_name: "Dana Whitfield",
          title: "Follow-up call", due_at: due.toISOString(), done: false
        }]
      }
    });
    await expect(page.locator("#unJoin")).toBeDisabled();
  });
});
