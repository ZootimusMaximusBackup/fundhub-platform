// Calendar — live dates and dated tasks. No July sample. Join Call / Client file
// enable only when task data supplies a meeting URL / client id.

import { test, expect } from "@playwright/test";
import { CLIENT_ID, CLOSER, TASK_NO_LINK, TASK_WITH_CALL, wireApi, gotoScreen } from "./harness.mjs";

function todayAt(h, min) {
  const d = new Date();
  d.setHours(h, min || 0, 0, 0);
  return d.toISOString();
}

function todayLong() {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric"
  });
}

test.describe("Calendar call controls", () => {

  test("Join Call and Client file are disabled with no link or client", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_NO_LINK] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unJoin")).toBeDisabled();
    await expect(page.locator("#unFile")).toBeDisabled();
    await expect(page.locator("#unFile")).toHaveText("Client file");
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

  test("Client file enables when client_id is linked", async ({ page }) => {
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

  test("Client file navigates to the client control panel", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [TASK_WITH_CALL] })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unFile")).toBeEnabled({ timeout: 10_000 });
    await page.locator("#unFile").click();
    await expect(page).toHaveURL(new RegExp(`client-control-panel\\.html\\?client_id=${CLIENT_ID}`));
  });

  test("Join Call stays disabled without a meeting URL", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({
          ok: true,
          tasks: [{
            id: "task-nocall", client_id: CLIENT_ID, client_name: "Dana Whitfield",
            title: "Follow-up call", due_at: todayAt(16, 0), done: false
          }]
        })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unClient")).toHaveText("Dana Whitfield", { timeout: 10_000 });
    await expect(page.locator("#unJoin")).toBeDisabled();
  });
});

test.describe("Calendar is today's week, not July sample", () => {

  test("date label is actual today and sample chips are gone", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": () => ({ ok: true, tasks: [] }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator(".datelabel")).toHaveText(todayLong(), { timeout: 10_000 });
    await expect(page.locator(".weekstrip")).not.toContainText("Priya Nair");
    await expect(page.locator(".weekstrip")).not.toContainText("Derek Owusu");
    await expect(page.locator(".weekstrip")).not.toContainText("Dana Whitlock");
    await expect(page.locator(".day-wrap")).toContainText("Nothing booked.");
    await expect(page.locator("#statBooked")).toHaveText("0");
    await expect(page.locator("#statDone")).toHaveText("0");
    await expect(page.locator("#statNoshow")).toHaveText("—");
    await expect(page.locator("#statShow")).toHaveText("—");
    await expect(page.locator("#statLeft")).toHaveText("0");
  });

  test("week strip counts come from dated tasks", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({
          ok: true,
          tasks: [
            { id: "t1", client_name: "Live Client", title: "Closer call", due_at: todayAt(16, 0), done: false },
            { id: "t2", client_name: "Done Client", title: "Wrap-up", due_at: todayAt(10, 0), done: true }
          ]
        })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#statBooked")).toHaveText("2", { timeout: 10_000 });
    await expect(page.locator("#statDone")).toHaveText("1");
    await expect(page.locator("#statLeft")).toHaveText("1");
    await expect(page.locator(".day-wrap")).toContainText("Live Client");
    await page.locator('#seg span[data-v="week"]').click();
    await expect(page.locator(".weekstrip")).toContainText("Live Client");
    await expect(page.locator(".weekstrip")).not.toContainText("Priya Nair");
  });

  test("Today button returns to the real current day", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: { "/api/tasks": () => ({ ok: true, tasks: [] }) }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator(".datelabel")).toHaveText(todayLong(), { timeout: 10_000 });
    await page.locator(".navbtn").nth(1).click();
    await expect(page.locator(".datelabel")).not.toHaveText(todayLong());
    await page.locator(".today-btn").click();
    await expect(page.locator(".datelabel")).toHaveText(todayLong());
  });
});

test.describe("Calendar Up Next / Then / briefing", () => {

  test("clicking a Then row loads that appointment in Up Next", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({
          ok: true,
          tasks: [
            { id: "task-a", client_id: CLIENT_ID, client_name: "Alpha Person",
              title: "First call", due_at: todayAt(16, 0), done: false },
            { id: "task-b", client_id: CLIENT_ID, client_name: "Beta Person",
              title: "Second call", due_at: todayAt(18, 0), done: false }
          ]
        })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unClient")).toHaveText("Alpha Person", { timeout: 10_000 });
    await page.locator('.then-row[data-task-id="task-b"]').click();
    await expect(page.locator("#unClient")).toHaveText("Beta Person");
    await expect(page.locator('.then-row[data-task-id="task-a"]')).toBeVisible();
  });

  test("Before you dial shows the task title, never a UUID", async ({ page }) => {
    const uid = "9af65808-a619-4e65-ae91-239766a006b7";
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({
          ok: true,
          tasks: [{
            id: "task-uid",
            client_name: "Chris ProveFunding",
            title: "Strategy session",
            body: uid,
            due_at: todayAt(16, 0),
            done: false
          }]
        })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#unBody")).toHaveText("Strategy session", { timeout: 10_000 });
    await expect(page.locator("#unBody")).not.toContainText(uid);
    await expect(page.locator("#upNext")).not.toContainText(uid);
  });
});
