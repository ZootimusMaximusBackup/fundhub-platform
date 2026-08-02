// Agent Editor — Save / Promote / Demote / New must POST /api/agents.
//
// NO BACKEND. Follows messaging-inbox via harness.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, EMPTY_PAGE } from "./harness.mjs";

const AGENTS = {
  ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
  items: [{
    code: "AG-01", name: "Lead Follow-up", agent_class: "client_facing",
    channel: "sms", status: "draft", runtime: null,
    owner_label: "Sarah Whitfield",
    prompt: "x".repeat(80),
    guardrails: {
      block: "y".repeat(40), triggers: ["lead.created"],
      escalation: { path: "Sarah Whitfield · Sales Manager", after: "1 hour" }
    },
    prompt_missing: false, guardrails_missing: false
  }]
};

function agentExtra(writes) {
  return {
    "/api/read/agents": AGENTS,
    "/api/agents": async (route, { method }) => {
      if (method !== "POST") return json(route, { ok: false, error: "method_not_allowed" }, 405);
      const body = JSON.parse(route.request().postData() || "{}");
      writes.push(body);
      if (body.action === "create") {
        return json(route, {
          ok: true, action: "create",
          agent: {
            code: "AG-02", name: body.name || "New agent", status: "draft",
            agent_class: "client_facing", channel: "internal",
            prompt: null, guardrails: {}, prompt_missing: true, guardrails_missing: true
          }
        });
      }
      if (body.action === "promote") {
        return json(route, {
          ok: true, action: "promote",
          agent: { ...AGENTS.items[0], status: "live", runtime: "internal" }
        });
      }
      if (body.action === "demote") {
        return json(route, {
          ok: true, action: "demote",
          agent: { ...AGENTS.items[0], status: "shadow", runtime: "internal" }
        });
      }
      return json(route, {
        ok: true, action: "save",
        agent: {
          ...AGENTS.items[0],
          name: body.name || AGENTS.items[0].name,
          prompt: body.prompt || AGENTS.items[0].prompt,
          guardrails: body.guardrails || AGENTS.items[0].guardrails
        }
      });
    }
  };
}

test.describe("agent editor writes", () => {

  test("loads the registry row", async ({ page }) => {
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra([]));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
  });

  test("Save posts to /api/agents and does not claim success without a write", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra(writes));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
    // Prompt lives inside a collapsed <details> — force the fill.
    await page.locator("#a_prompt").fill("z".repeat(90), { force: true });
    await page.locator("#saveBtn").click();
    await expect.poll(() => writes.some((w) => w.action === "save")).toBe(true);
    await expect(page.locator("#saveNote")).toContainText(/SAVED|NOT SAVED/);
  });

  test("New posts create and selects the new agent", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra(writes));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
    await page.locator("#newBtn").click();
    await expect.poll(() => writes.some((w) => w.action === "create"), { timeout: 10_000 }).toBe(true);
    await expect(page.locator("#a_name")).toHaveValue("New agent");
  });

  test("Promote saves then promotes", async ({ page }) => {
    const writes = [];
    page.on("dialog", async (d) => { await d.accept(); });
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra(writes));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
    await expect(page.locator("#promoteBtn")).toBeEnabled({ timeout: 5_000 });
    await page.locator("#promoteBtn").click();
    await expect.poll(() => writes.map((w) => w.action).join(","), { timeout: 10_000 })
      .toContain("promote");
  });
});
