// Pipeline — drag and MOVE persist via POST /api/pipeline-cards.
//
// NO BACKEND.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

const STAGES = {
  ok: true,
  pipeline: "sales",
  total: 1,
  stages: [
    {
      key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 0,
      cards: [{
        id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
        owner: "Jordan Blake", entered_at: "2026-08-01T10:00:00Z",
        outcome_tier: null, funded: false, amount: 3000
      }]
    },
    {
      key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, cards: []
    }
  ]
};

test.describe("pipeline board", () => {

  test("renders live cards with client ids", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES
    });
    await expect(page.locator('.card[data-client-id]')).toHaveCount(1);
    await expect(page.locator('.card[data-client-id]')).toContainText("Dana Whitfield");
  });

  test("MOVE posts a pipeline-cards move", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES,
      "/api/pipeline-cards": async (route, { method }) => {
        if (method === "POST") {
          const body = JSON.parse(route.request().postData() || "{}");
          writes.push(body);
          return json(route, { ok: true, action: "move", ...body });
        }
        return json(route, { ok: true });
      }
    });
    await expect(page.locator('.card[data-client-id]')).toHaveCount(1);
    await page.locator('.card[data-client-id] .c-btn.route').first().click();
    await expect.poll(async () =>
      page.locator("#routeMenu").evaluate((el) => el && !el.hidden)
    ).toBe(true);
    await page.locator('#routeMenu .rm-item[data-pipeline-key]').first().click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].action).toBe("move");
    expect(writes[0].client_id).toBe(CLIENT_ID);
    expect(writes[0].pipeline_key).toBeTruthy();
    expect(writes[0].stage_key).toBeTruthy();
  });

  test("dropping a card onto another column posts a move", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": STAGES,
      "/api/pipeline-cards": async (route, { method }) => {
        if (method === "POST") {
          writes.push(JSON.parse(route.request().postData() || "{}"));
          return json(route, { ok: true, action: "move" });
        }
        return json(route, { ok: true });
      }
    });
    const card = page.locator('.card[data-client-id]').first();
    const dest = page.locator('.col[data-stage-key="booked"] .col-body').first();
    await expect(card).toBeVisible();
    await expect(dest).toBeVisible();
    const c = await card.boundingBox();
    const d = await dest.boundingBox();
    if (c && d) {
      await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
      await page.mouse.down();
      await page.mouse.move(d.x + d.width / 2, d.y + 20, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => writes.length, { timeout: 5000 }).toBeGreaterThan(0);
      expect(writes[0].stage_key).toBe("booked");
    }
  });
});
