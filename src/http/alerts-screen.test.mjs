/* Tests for the inline wiring script in public/app/alerts.html.
 *
 * WHY A SCREEN TEST AT ALL. There is no browser and no Playwright in this
 * environment, so nothing has LOOKED at this page. What can still be proved
 * without a browser is what the page DECIDES to put on screen, and that is where
 * the expensive mistakes live — so the real wiring script is lifted out of the
 * .html file and run against a stub DOM, exactly the way
 * src/http/subscriptions-screen.test.mjs does it. If the script drifts, this
 * goes red rather than the screen going quietly wrong. It proves nothing about
 * layout, colour or whether anything is legible; a human still has to open it.
 *
 * THE FOUR RULES UNDER TEST, ALL OF WHICH HAVE ALREADY COST SOMEBODY SOMETHING:
 *
 *   1. NO NUMBER THE SERVER DID NOT SEND. Audit M8: a screen left two invented
 *      dollar figures on screen under a real client's name when the read came
 *      back empty. This page ships no sample figures at all.
 *
 *   2. "NOTHING" AND "WE COULD NOT TELL" AND "WE DID NOT LOOK" ARE THREE
 *      DIFFERENT ANSWERS. A queue that renders an empty list as "you are fine"
 *      tells an owner their book is clean when the truth is that every rule is
 *      switched off. This is the whole reason the endpoint reports skips and
 *      un-run rules, and the screen is asserted to show them.
 *
 *   3. AN UNSET THRESHOLD SAYS SO IN WORDS AND NEVER SHOWS 0. A 0% threshold is
 *      a real setting that fires on every client with any balance at all, so
 *      printing 0 where nothing is set is not a cosmetic slip.
 *
 *   4. EVERYTHING IS ESCAPED. A client's name, a rule's note and a dismissal
 *      reason are typed by a person and stored as text. There are 252 innerHTML
 *      sites across public/app; a screen that interpolates a record without
 *      esc() turns a name into markup.
 *
 * And one specific to this screen: A DRY RUN MUST BE UNMISTAKABLE. The button
 * that writes and the button that does not are next to each other, and the page
 * has to say which one just happened.
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/alerts.html");
const DATA_JS = path.resolve(HERE, "../../public/app/data.js");
const HTML = fs.readFileSync(SCREEN, "utf8");
const DATA_SRC = fs.readFileSync(DATA_JS, "utf8");

const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const AID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** inlineScript — the page's own wiring, verbatim. `<script src=...>` tags carry
    attributes and so do not match; the wiring block is the only bare one. */
function inlineScript() {
  const m = HTML.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "alerts.html no longer has an inline wiring script");
  return m[1];
}

/* ── the browser stub ─────────────────────────────────────────────────────── */

function attrsOf(tag) {
  const out = {};
  const re = /([a-zA-Z-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = m[2];
  return out;
}

function makeEl(id, html = "") {
  const el = {
    id,
    innerHTML: html,
    className: "",
    textContent: "",
    value: "",
    checked: false,
    style: { cssText: "" },
    listeners: {},
    attrs: {},
    setAttribute(k, v) { el.attrs[k] = v; },
    getAttribute(k) { return el.attrs[k] ?? null; },
    addEventListener(type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    appendChild() {},
    /* Enough of a query engine for the two selectors this page uses. The
       buttons live inside an innerHTML string, so the alternative is not
       testing the write paths at all — and the write paths are the half of this
       screen that changes somebody's data. */
    querySelectorAll(sel) {
      const m = /\[([a-z-]+)\]/.exec(String(sel));
      if (!m) return [];
      const re = new RegExp('<button[^>]*\\s' + m[1] + '="[^"]*"[^>]*>', "g");
      const out = [];
      let hit;
      while ((hit = re.exec(el.innerHTML))) {
        const b = makeEl("");
        b.attrs = attrsOf(hit[0]);
        out.push(b);
        (el.registry || []).push(b);
      }
      return out;
    }
  };
  return el;
}

/**
 * runScreen — evaluate data.js and the page's wiring against a stub browser.
 *
 * `respond(path, opts)` answers each request the screen issues, GET or POST.
 * Elements are created on demand, so controls the script binds to after a render
 * exist without this file having to know their ids — what is asserted is the
 * HTML the script produced, not the wiring of a fake DOM.
 */
async function runScreen({ search = "", respond, seed } = {}) {
  const els = { alertsMount: makeEl("alertsMount"), alertsMountSource: makeEl("alertsMountSource") };
  els.alertsMount.registry = [];
  const calls = [];

  const sandbox = {
    console,
    document: {
      getElementById: (id) => (els[id] || (els[id] = makeEl(id))),
      createElement: () => makeEl(""),
      querySelectorAll: () => [],
      body: { appendChild: (el) => { els[el.id] = el; } }
    },
    localStorage: {
      getItem: (k) => (k === "fh_token" ? "t0ken" : null),
      setItem() {}, removeItem() {}
    },
    location: { search },
    URLSearchParams,
    Promise,
    Array,
    fetch: (p, opts) => {
      calls.push({ path: p, method: (opts && opts.method) || "GET", body: opts && opts.body });
      const r = respond(p, opts);
      return Promise.resolve({ status: r.status, json: () => Promise.resolve(r.body) });
    }
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(DATA_SRC, sandbox, { filename: DATA_JS });
  if (seed) seed(els);
  vm.runInContext(inlineScript(), sandbox, { filename: SCREEN + "#wiring" });

  const drain = async () => { for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r)); };
  await drain();

  return {
    els,
    calls,
    html: () => els.alertsMount.innerHTML,
    banner: () => (els["fh-data-banner"] ? els["fh-data-banner"].textContent : ""),
    /* fire — press a control the render produced. Buttons created by id (the
       two run buttons) are looked up directly; buttons inside the rendered HTML
       come from the registry the stub query engine fills. */
    async click(id) {
      const el = els[id];
      assert.ok(el && el.listeners.click, `#${id} is not on the page, or nothing is bound to it`);
      el.listeners.click.forEach((fn) => fn());
      await drain();
    },
    async clickAttr(attr, value) {
      const hits = els.alertsMount.registry.filter((b) => b.getAttribute(attr) === value);
      assert.ok(hits.length, `no button with ${attr}="${value}" was rendered`);
      const b = hits[hits.length - 1];
      assert.ok(b.listeners.click, `the ${attr}="${value}" button has nothing bound to it`);
      b.listeners.click.forEach((fn) => fn());
      await drain();
    }
  };
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const FIG = (label, display, partial = false) => ({ label, display, partial });

const ALERT = (over = {}) => ({
  id: AID, client_id: CID, client_name: "Dana Reyes",
  kind: "utilization_threshold", severity: "warning", state: "open",
  title: "Total utilization is 80%, over the configured 30% threshold.",
  as_of: "2026-07-01T00:00:00.000Z", raised_at: "2026-07-20T09:00:00.000Z",
  acknowledged_at: null, resolved_at: null, dismissed_reason: null,
  figures: [FIG("Card use", "80%"), FIG("Total balance", "8000.00")],
  ...over
});

const TRIGGER = (over = {}) => ({
  rule: "utilization_over_threshold",
  measures: "Adds up the balances on this client's open credit cards and fires when the result is above the percentage you set.",
  configured: false, enabled: false, threshold_kind: "utilization",
  threshold_bps: null, threshold_pct: null, threshold_score: null, threshold_display: null,
  severity: null, notes: null, signed_off_at: null, updated_at: null,
  ...over
});

const RUN = (over = {}) => ({
  ok: true, dry_run: true, wrote: false, client_id: CID,
  as_of: "2026-07-01T00:00:00.000Z",
  inputs: {
    tradelines: 2, tradelines_dated: 2,
    score: { known: true, score: 640, bureau: "Equifax", source: "crs", is_primary: true, recorded_at: "2026-07-02T00:00:00.000Z" }
  },
  rules: [
    {
      ...TRIGGER({ configured: true, enabled: true, threshold_pct: 30, threshold_display: "30%" }),
      outcome: "would_raise", reason: null,
      reason_text: "this rule's condition is true right now. Nothing was written — this was a dry run.",
      alert: { id: null, kind: "utilization_threshold", severity: "warning",
               title: "Total utilization is 80%, over the configured 30% threshold.",
               figures: [FIG("Card use", "80%")] }
    }
  ],
  raised: 1, skipped: [],
  ...over
});

/* respondWith — one place that knows which request is which. */
function respondWith({
  alerts = { ok: true, scope: "book", state: "open", alerts: [] },
  triggers = { ok: true, can_configure: true, triggers: [TRIGGER()] },
  alertsStatus = 200,
  triggersStatus = 200,
  post = { status: 200, body: { ok: true } }
} = {}) {
  return (p, opts) => {
    if (opts && opts.method === "POST") return post;
    if (p.indexOf("/api/finance/alerts?view=triggers") === 0) {
      return { status: triggersStatus, body: triggers };
    }
    if (p.indexOf("/api/finance/alerts") === 0) {
      return { status: alertsStatus, body: alerts };
    }
    throw new Error("the screen called an endpoint nobody expected: " + p);
  };
}

/* Any run of digits with a decimal point — the shape of money on this page.
   A shape test rather than a list, so it also catches a figure a future version
   invents. */
const MONEY_SHAPED = /\b\d[\d,]*\.\d{2}\b/;

/* ── what the screen asks for ─────────────────────────────────────────────── */

describe("alerts.html — the reads it issues", () => {

  test("with no client it reads the open queue for the whole book, and the rules", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.equal(s.calls.length, 2);
    assert.ok(s.calls.some((c) => c.path === "/api/finance/alerts"));
    assert.ok(s.calls.some((c) => c.path === "/api/finance/alerts?view=triggers"));
  });

  test("with a client it reads that client's alerts", async () => {
    const s = await runScreen({ search: "?client_id=" + CID, respond: respondWith({}) });
    assert.ok(s.calls.some((c) => c.path === "/api/finance/alerts?client_id=" + CID));
  });
});

/* ── rule 1 and 2: silence is never reported as good news ─────────────────── */

describe("alerts.html — an empty queue is not a clean book", () => {

  test("no alerts open says so AND points at the rules", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.match(s.html(), /No alerts are open/);
    assert.match(s.html(), /not the same as your book being fine/,
      "an empty queue was reported as though it meant everything is fine");
    assert.ok(!MONEY_SHAPED.test(s.html()), "money is on screen with no alerts:\n" + s.html());
  });

  test("a failed queue read does NOT claim there are no alerts", async () => {
    const s = await runScreen({
      respond: respondWith({ alertsStatus: 500, alerts: { ok: false, error: "boom" } })
    });
    assert.match(s.html(), /could not be read/);
    assert.ok(!/No alerts are open/.test(s.html()),
      "a read that failed was reported as a book with nothing wrong in it");
  });

  test("the endpoint being unfinished is not an outage", async () => {
    const s = await runScreen({
      respond: respondWith({ alertsStatus: 501, alerts: { ok: false, error: "not_implemented" } })
    });
    assert.match(s.banner(), /not built yet/);
    assert.ok(!/database/i.test(s.banner()), "an unbuilt endpoint was announced as a database problem");
  });

  test("a client with no alerts is not told they are fine", async () => {
    const s = await runScreen({
      search: "?client_id=" + CID,
      respond: respondWith({ alerts: { ok: true, scope: "client", alerts: [] } })
    });
    assert.match(s.html(), /No alerts have ever been raised for this client/);
    assert.match(s.html(), /a rule that is switched off, or that has no threshold, never fires/);
  });
});

/* ── rule 3: an unset threshold ───────────────────────────────────────────── */

describe("alerts.html — the rules panel", () => {

  test("a rule nobody has configured says so, and shows no threshold number", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.match(s.html(), /never configured/);
    assert.match(s.html(), /no threshold set — this rule cannot fire/);
    assert.ok(!/threshold 0/.test(s.html()),
      "an unset threshold rendered as 0, which is a real setting that fires on everybody");
  });

  test("a threshold that IS set is shown in the unit a person reads", async () => {
    const s = await runScreen({
      respond: respondWith({
        triggers: { ok: true, triggers: [TRIGGER({ configured: true, enabled: true, threshold_pct: 30, threshold_display: "30%" })] }
      })
    });
    assert.match(s.html(), /threshold 30%/);
  });

  test("a threshold of zero is shown as zero, because zero is a decision", async () => {
    const s = await runScreen({
      respond: respondWith({
        triggers: { ok: true, triggers: [TRIGGER({ configured: true, threshold_pct: 0, threshold_display: "0%" })] }
      })
    });
    assert.match(s.html(), /threshold 0%/);
  });

  test("what each rule measures is printed, in the server's words", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.match(s.html(), /Adds up the balances/);
  });

  test("a rule with no description does not get one invented for it", async () => {
    const s = await runScreen({
      respond: respondWith({ triggers: { ok: true, triggers: [TRIGGER({ measures: null })] } })
    });
    assert.match(s.html(), /No description was sent for this rule/);
  });

  test("saving a rule posts what the boxes say, with an empty threshold sent as empty", async () => {
    const s = await runScreen({
      respond: respondWith({
        triggers: { ok: true, can_configure: true, triggers: [TRIGGER({ configured: true, enabled: false })] }
      })
    });
    await s.clickAttr("data-save", "utilization_over_threshold");
    const write = s.calls.find((c) => c.method === "POST");
    assert.ok(write, "the save button posted nothing");
    const sent = JSON.parse(write.body);
    assert.equal(sent.action, "set_trigger");
    assert.equal(sent.rule, "utilization_over_threshold");
    assert.equal(sent.enabled, false, "a rule came on by itself");
    assert.strictEqual(sent.threshold_pct, "",
      "an empty threshold box was omitted or turned into a number");
  });

  test("a reader who may not change a rule is not offered a control that would 403", async () => {
    const s = await runScreen({
      respond: respondWith({
        triggers: { ok: true, can_configure: false, triggers: [TRIGGER({ configured: true })] }
      })
    });
    assert.ok(!/data-save=/.test(s.html()), "a save button was offered to somebody who cannot save");
    assert.match(s.html(), /Only an owner or an admin can change this/);
    assert.match(s.html(), /Adds up the balances/, "the rule itself was hidden as well as its controls");
  });

  test("a rule with a score threshold sends a score, not a percentage", async () => {
    const s = await runScreen({
      respond: respondWith({
        triggers: {
          ok: true, can_configure: true,
          triggers: [TRIGGER({ rule: "score_below_threshold", threshold_kind: "score", configured: true })]
        }
      })
    });
    await s.clickAttr("data-save", "score_below_threshold");
    const sent = JSON.parse(s.calls.find((c) => c.method === "POST").body);
    assert.ok("threshold_score" in sent, "the score rule posted a percentage");
    assert.ok(!("threshold_pct" in sent));
  });
});

/* ── the dry run ──────────────────────────────────────────────────────────── */

describe("alerts.html — trying the rules", () => {

  test("with no client the run panel asks for one instead of offering a button", async () => {
    const s = await runScreen({ respond: respondWith({}) });
    assert.match(s.html(), /alerts.html\?client_id=/);
    assert.ok(!/dryRunBtn/.test(s.html()));
  });

  test("the trial button posts dry_run and the page says nothing was written", async () => {
    const s = await runScreen({
      search: "?client_id=" + CID,
      respond: respondWith({ post: { status: 200, body: RUN() } })
    });
    await s.click("dryRunBtn");
    const write = s.calls.find((c) => c.method === "POST");
    assert.equal(JSON.parse(write.body).dry_run, true);
    assert.match(s.html(), /Nothing was written down/);
    assert.match(s.html(), /would fire/);
  });

  test("the real button does not send dry_run, and the page says it ran for real", async () => {
    const s = await runScreen({
      search: "?client_id=" + CID,
      respond: respondWith({
        post: { status: 200, body: RUN({ dry_run: false, wrote: true,
          rules: [{ ...TRIGGER({ configured: true, enabled: true, threshold_display: "30%" }),
                    outcome: "raised", reason: null, reason_text: "this rule's condition is true, and an alert was written.",
                    alert: { id: AID, kind: "utilization_threshold", severity: "warning", title: "Total utilization is 80%.", figures: [] } }] }) }
      })
    });
    await s.click("realRunBtn");
    const write = s.calls.find((c) => c.method === "POST");
    assert.equal(JSON.parse(write.body).dry_run, false);
    assert.match(s.html(), /This ran for real/);
    assert.match(s.html(), /fired — an alert was written/);
  });

  test("a rule that did not run says why, in words a person can act on", async () => {
    const s = await runScreen({
      search: "?client_id=" + CID,
      respond: respondWith({
        post: { status: 200, body: RUN({ rules: [{
          ...TRIGGER({ configured: true, enabled: true }),
          outcome: "not_run", reason: "threshold_unset",
          reason_text: "no threshold has been set for this rule, so it cannot fire.",
          alert: null
        }] }) }
      })
    });
    await s.click("dryRunBtn");
    assert.match(s.html(), /not run/);
    assert.match(s.html(), /no threshold has been set for this rule/);
  });

  test("a run that failed does not leave a result on screen", async () => {
    const s = await runScreen({
      search: "?client_id=" + CID,
      respond: respondWith({ post: { status: 500, body: { ok: false, error: "dry_run_unavailable" } } })
    });
    await s.click("dryRunBtn");
    assert.ok(!/would fire/.test(s.html()), "a failed run left an outcome on screen");
    assert.ok(!/Nothing was written down/.test(s.html()));
  });

  test("the inputs behind a run are reported, so nobody guesses which figures were used", async () => {
    const s = await runScreen({
      search: "?client_id=" + CID,
      respond: respondWith({ post: { status: 200, body: RUN() } })
    });
    await s.click("dryRunBtn");
    assert.match(s.html(), /Read 2 card\(s\)/);
    assert.match(s.html(), /credit score on file 640 from Equifax/);
    assert.match(s.html(), /true as of 2026-07-01/);
  });

  test("an undated picture says it is undated rather than dating it today", async () => {
    const s = await runScreen({
      search: "?client_id=" + CID,
      respond: respondWith({ post: { status: 200, body: RUN({ as_of: null, inputs: { tradelines: 2, tradelines_dated: 1, score: { known: false, score: null, bureau: null, source: null, is_primary: false, recorded_at: null } } }) } })
    });
    await s.click("dryRunBtn");
    assert.match(s.html(), /not dated/);
    assert.match(s.html(), /no credit score on file/);
  });
});

/* ── the alerts themselves ────────────────────────────────────────────────── */

describe("alerts.html — a raised alert", () => {

  test("shows what fired, for whom, when, and the numbers behind it", async () => {
    const s = await runScreen({ respond: respondWith({ alerts: { ok: true, alerts: [ALERT()] } }) });
    const html = s.html();
    assert.match(html, /Total utilization is 80%/);
    assert.match(html, /Dana Reyes/);
    assert.match(html, /raised 2026-07-20/);
    assert.match(html, /data true as of 2026-07-01/);
    assert.match(html, /8,000\.00/, "the figure behind the alert is not on screen");
  });

  test("an unknown figure is an em dash and NEVER a zero", async () => {
    const s = await runScreen({
      respond: respondWith({
        alerts: { ok: true, alerts: [ALERT({ figures: [FIG("Total credit limit", null), FIG("Card use", null)] })] }
      })
    });
    const html = s.html();
    assert.match(html, /is-unknown">—</);
    assert.ok(!/>0</.test(html) && !/0\.00/.test(html),
      "an unknown figure rendered as a zero:\n" + html);
  });

  test("a floor carries the + marker and an em dash never does", async () => {
    const s = await runScreen({
      respond: respondWith({
        alerts: { ok: true, alerts: [ALERT({ figures: [FIG("Total balance", "8000.00", true), FIG("Total credit limit", null, true)] })] }
      })
    });
    const html = s.html();
    assert.match(html, /fh-num is-partial">8,000\.00/);
    assert.match(html, /fh-num is-unknown">—/,
      "an unknown value also carried the floor marker, which renders as '—+' (audit m16)");
  });

  test("an alert with no as-of date says the date is unknown rather than showing today", async () => {
    const s = await runScreen({
      respond: respondWith({ alerts: { ok: true, alerts: [ALERT({ as_of: null })] } })
    });
    assert.match(s.html(), /data true as of an unknown date/);
  });

  test("a client with no name on file is not given one", async () => {
    const s = await runScreen({
      respond: respondWith({ alerts: { ok: true, alerts: [ALERT({ client_name: null })] } })
    });
    assert.match(s.html(), /no name on file/);
    assert.ok(!/Unknown Client/i.test(s.html()));
  });

  test("only an open alert offers the three buttons", async () => {
    const open = await runScreen({ respond: respondWith({ alerts: { ok: true, alerts: [ALERT()] } }) });
    assert.match(open.html(), /data-act="acknowledge"/);

    const done = await runScreen({
      respond: respondWith({ alerts: { ok: true, alerts: [ALERT({ state: "resolved", resolved_at: "2026-07-22T00:00:00.000Z" })] } })
    });
    assert.ok(!/data-act=/.test(done.html()), "a resolved alert still offered a button that would 404");
    assert.match(done.html(), /resolved 2026-07-22/);
  });

  test("a dismissal with no reason says the reason is missing rather than leaving a gap", async () => {
    const s = await runScreen({
      respond: respondWith({ alerts: { ok: true, alerts: [ALERT({ state: "dismissed", dismissed_reason: null })] } })
    });
    assert.match(s.html(), /no reason written down/);
  });

  test("acknowledging posts the alert id and re-reads the queue rather than editing the page", async () => {
    const s = await runScreen({
      respond: respondWith({
        alerts: { ok: true, alerts: [ALERT()] },
        post: { status: 200, body: { ok: true, action: "acknowledge", changed: true, reason: null, alert: ALERT({ state: "acknowledged" }) } }
      })
    });
    const before = s.calls.length;
    await s.clickAttr("data-act", "acknowledge");
    const write = s.calls.find((c) => c.method === "POST");
    assert.deepEqual(JSON.parse(write.body), { action: "acknowledge", alert_id: AID });
    assert.ok(s.calls.length > before + 1, "the screen edited its own copy instead of re-reading");
  });

  test("'somebody already did that' is reported as what it is, not as a success", async () => {
    const s = await runScreen({
      respond: respondWith({
        alerts: { ok: true, alerts: [ALERT()] },
        post: { status: 200, body: { ok: true, action: "acknowledge", changed: false, reason: "already_acknowledged", alert: ALERT({ state: "acknowledged" }) } }
      })
    });
    await s.clickAttr("data-act", "acknowledge");
    assert.equal(s.els.flashMsg.textContent, "Nothing changed — already_acknowledged.");
  });
});

/* ── rule 4: escaping ─────────────────────────────────────────────────────── */

describe("alerts.html — record data is never markup", () => {

  test("a client name carrying markup is escaped", async () => {
    const s = await runScreen({
      respond: respondWith({
        alerts: { ok: true, alerts: [ALERT({ client_name: '<img src=x onerror="alert(1)">' })] }
      })
    });
    assert.ok(!/<img/.test(s.html()), "a client name became markup:\n" + s.html());
    assert.match(s.html(), /&lt;img/);
  });

  test("an alert title carrying markup is escaped", async () => {
    const s = await runScreen({
      respond: respondWith({ alerts: { ok: true, alerts: [ALERT({ title: "<script>steal()</script>" })] } })
    });
    assert.ok(!/<script>steal/.test(s.html()));
  });

  test("a dismissal reason carrying markup is escaped", async () => {
    const s = await runScreen({
      respond: respondWith({
        alerts: { ok: true, alerts: [ALERT({ state: "dismissed", dismissed_reason: "<b>paid off</b>" })] }
      })
    });
    assert.ok(!/<b>paid off/.test(s.html()));
  });

  test("a note on a rule cannot break out of its own input box", async () => {
    const s = await runScreen({
      respond: respondWith({
        triggers: { ok: true, triggers: [TRIGGER({ configured: true, notes: '" onfocus="steal()' })] }
      })
    });
    assert.ok(!/onfocus="steal/.test(s.html()), "a note escaped its attribute:\n" + s.html());
  });

  test("a rule description carrying markup is escaped", async () => {
    const s = await runScreen({
      respond: respondWith({ triggers: { ok: true, triggers: [TRIGGER({ measures: "<i>x</i>" })] } })
    });
    assert.ok(!/<i>x<\/i>/.test(s.html()));
  });
});

/* ── the page itself ──────────────────────────────────────────────────────── */

describe("alerts.html — the page", () => {

  test("the way out of the screen is a real link, not history.back()", () => {
    assert.match(HTML, /<a href="command-center\.html"/,
      "the back link is not a real href — back() does nothing when the page was opened from a pasted URL");
    // The wiring script, not the whole file: the comment above the link says the
    // words "history.back()" to explain why it is not used, and a test that
    // cannot tell an explanation from a call is a test that punishes the comment.
    assert.ok(!/history\.back\(\)/.test(inlineScript()),
      "the script navigates with history.back(), which does nothing from a pasted URL");
  });

  test("the scaffold placeholder is gone", () => {
    assert.ok(!/alertsMountPlaceholder/.test(HTML),
      "the 'this screen is being built' note is still on a screen that is built");
  });

  test("the page states, in words, that nothing here is sent to a client", () => {
    assert.match(HTML, /Nothing on this page is sent to a client/);
  });

  test("the page ships no figures of its own", () => {
    /* Comments, the stylesheet and the wiring script are stripped first. A CSS
       line-height ("13px/1.45") is money-shaped to a regular expression and is
       not a figure about anybody's money; what this test is looking for is a
       number sitting in the MARKUP, which is what audit M8 was. */
    const body = HTML
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<style>[\s\S]*?<\/style>/g, "")
      .replace(/<script>[\s\S]*?<\/script>/g, "");
    assert.ok(!MONEY_SHAPED.test(body), "the markup carries a money figure of its own:\n" + body);
  });

  test("it links the shared Finance OS stylesheet rather than restating the em-dash rule", () => {
    assert.match(HTML, /href="finance-os\.css"/);
  });
});
