import { session, open, save, OUT, BASE } from "./_lib.mjs";

const EMAIL = process.env.T11_EMAIL || "partner@fundhub.ai";
const TAG = process.env.T11_TAG || "02";
const s = await session(EMAIL);
const { page, rec } = s;
const bodies = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!/\/api\/(social|partner-marketing)/.test(u)) return;
  let body = null;
  try { body = await res.text(); } catch { body = "<unreadable>"; }
  if (body && body.length > 3000) body = body.slice(0, 3000) + "…TRUNCATED";
  bodies.push({ method: res.request().method(), url: u.replace(BASE, ""), status: res.status(), body });
});

s.reset();
const load = await open(page, "/app/social-studio.html");
await page.screenshot({ path: `${OUT}/${TAG}-social-full.png`, fullPage: true });

const dom = await page.evaluate(() => {
  const t = (id) => { const e = document.getElementById(id); return e ? e.textContent.trim().replace(/\s+/g, " ") : "<no #" + id + ">"; };
  const sel = document.getElementById("cChannel");
  const btnRow = [...document.querySelectorAll("button")].map((b) => ({
    id: b.id || null, text: (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60),
    disabled: b.disabled, visible: !!(b.offsetWidth || b.offsetHeight), title: b.getAttribute("title") || null
  }));
  const chGrid = document.getElementById("chGrid");
  const wb = document.getElementById("wbEyebrow");
  return {
    chCount: t("chCount"), ghCount: t("ghCount"),
    connectedAccountsHTMLText: chGrid ? chGrid.textContent.trim().replace(/\s+/g, " ").slice(0, 500) : null,
    notConnectedText: (document.getElementById("ghGrid") || {}).textContent ? document.getElementById("ghGrid").textContent.trim().replace(/\s+/g, " ").slice(0, 400) : null,
    oauthBoxVisible: !!(document.getElementById("oauthConnectBox") || {}).offsetHeight,
    oauthMsg: t("oauthMsg"),
    cChannel: sel ? { present: true, value: sel.value, options: [...sel.options].map((o) => ({ value: o.value, label: o.textContent })) } : { present: false },
    approvalBody: t("approvalBody").slice(0, 900),
    approvalSaysSettingNotRead: /setting not read/i.test(t("approvalBody")),
    waitingTabCount: t("nQueued"),
    waitingPaneText: (document.querySelector('[data-pane="queued"]') ? document.querySelector('[data-pane="queued"]').textContent.trim() : null),
    rowsPaneText: (() => { const e = document.getElementById("rowsHost") || document.querySelector(".rowlist"); return e ? e.textContent.trim().replace(/\s+/g, " ").slice(0, 600) : null; })(),
    suiteChip: t("ssSuiteTxt"), suiteMsg: t("ssSuiteMsg"), ssGenMsg: t("ssGenMsg"),
    ssNotice: t("ssNoticeTxt"), queueMsg: t("queueMsg"),
    suiteEnabledFlag: window.__ssSuiteEnabled,
    buttons: btnRow.filter((b) => b.visible),
    bodyTextHasDiscard: /discard|delete|remove|cancel post/i.test(document.body.innerText)
  };
});

// --- Queue post: type a caption then press it -------------------------------
s.reset();
await page.fill("#cCaption", "T11 live repro check — please ignore.").catch(() => {});
await page.waitForTimeout(400);
await page.click("#queueBtn").catch((e) => console.log("queue click failed " + e.message));
await page.waitForTimeout(6000);
const queue = {
  message: await page.evaluate(() => { const e = document.getElementById("queueMsg"); return e ? e.textContent.trim() : null; }),
  network: rec.api.slice(), nonGet: rec.intercepted.slice(), console: rec.console.slice()
};
await page.screenshot({ path: `${OUT}/${TAG}-social-after-queue.png`, fullPage: true });

// --- "Write 3 posts for me": press once, cap the wait at 90s ----------------
s.reset();
const gen = { pressed: false };
const genBtn = await page.$("#ssGenBtn");
if (genBtn) {
  gen.disabledBefore = await genBtn.isDisabled();
  gen.title = await genBtn.getAttribute("title");
  if (!gen.disabledBefore) {
    const t0 = Date.now();
    await genBtn.click();
    gen.pressed = true;
    let msg = "";
    for (let i = 0; i < 45; i++) {
      await page.waitForTimeout(2000);
      msg = await page.evaluate(() => { const e = document.getElementById("ssGenMsg"); return e ? e.textContent.trim() : ""; });
      const done = rec.api.some((c) => /\/api\/social\/generate/.test(c.url));
      if (done && !/…|writ|work|load/i.test(msg)) break;
    }
    gen.elapsedMs = Date.now() - t0;
    gen.finalMsg = msg;
    gen.network = rec.api.slice();
    gen.nonGet = rec.intercepted.slice();
    gen.console = rec.console.slice();
    gen.waitingCountAfter = await page.evaluate(() => { const e = document.getElementById("nQueued"); return e ? e.textContent.trim() : null; });
  } else {
    gen.note = "button was disabled — not pressed";
  }
}
await page.screenshot({ path: `${OUT}/${TAG}-social-after-generate.png`, fullPage: true });

save(`${TAG}-social-dom.json`, { email: EMAIL, role: rec.role, load, dom, queue, gen });
save(`${TAG}-social-network.json`, bodies);
console.log(JSON.stringify({ load, role: rec.role, dom, queue: { message: queue.message, nonGet: queue.nonGet }, gen }, null, 2).slice(0, 9000));
await s.browser.close();
