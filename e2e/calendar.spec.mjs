// Calendar — Join Call and His file enable only when task data supplies them.

import { test, expect } from "@playwright/test";
import { CLIENT_ID, CLOSER, TASK_NO_LINK, TASK_WITH_CALL, wireApi, gotoScreen } from "./harness.mjs";

test.describe("Calendar call controls", () => {

  test("Join Call and His file are disabled with no link or client", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_NO_LINK] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unJoin")).toBeDisabled();
    await expect(page.locator("#unFile")).toBeDisabled();
  });

  test("Join Call enables when meeting_url is present", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unJoin")).toBeEnabled({ timeout: 10_000 });
  });

  test("His file enables when client_id is linked", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unFile")).toBeEnabled({ timeout: 10_000 });
  });

  test("Join Call stores the meeting URL on the button", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unJoin")).toBeEnabled({ timeout: 10_000 });
    await expect(page.locator("#unJoin")).toHaveAttribute("data-join-url", /meet\.example\.com/);
  });

  test("His file navigates to the client control panel", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unFile")).toBeEnabled({ timeout: 10_000 });
    await page.locator("#unFile").click();
    await expect(page).toHaveURL(new RegExp(`client-control-panel\\.html\\?id=${CLIENT_ID}`));
  });
});
