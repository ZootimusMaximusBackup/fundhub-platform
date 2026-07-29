/* Fundhub screens — shared client.
   Real API first. If the database isn't wired yet, falls back to DEMO MODE
   so the screens are usable immediately. The moment DATABASE_URL is set on
   Netlify, the real API answers and demo mode never engages. */
const FH = (() => {
  const token = () => localStorage.getItem("fh_token") || "";
  const isDemo = () => localStorage.getItem("fh_demo") === "1";

  /* ---------------- demo credentials ---------------- */
  const DEMO_USERS = {
    "chris@fundhub.ai":  { pw: "demo1234", role: "owner",              name: "Chris Stanbridge" },
    "demo@fundhub.ai":   { pw: "demo1234", role: "owner",              name: "Demo Owner" },
    "sarah@fundhub.ai":  { pw: "demo1234", role: "admin",              name: "Sarah Whitfield" },
    "jordan@fundhub.ai": { pw: "demo1234", role: "closer",             name: "Jordan Blake" },
    "nina@fundhub.ai":   { pw: "demo1234", role: "closer",             name: "Nina Castellano" },
    "marcus@fundhub.ai": { pw: "demo1234", role: "funding_advisor",    name: "Marcus Webb" },
    "alvin@fundhub.ai":  { pw: "demo1234", role: "inquiry_specialist", name: "Alvin Torres" }
  };

  /* ---------------- demo dataset ---------------- */
  const D = (() => {
    const mk = (id, first, last, tier, prequal, approved, crs, tasks, flags = {}) => ({
      id, first_name: first, last_name: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      phone: "+1555" + String(1000000 + id * 7919).slice(0, 7),
      outcome_tier: tier,
      funded: !!approved, funded_amount: approved || null, days_to_fund: approved ? 9 + (id % 8) : null,
      channel_source: ["Meta Ads", "Direct Mail", "Referral", "Organic"][id % 4],
      dnd_sms: false, dnd_email: false, dnd_voice: false,
      custom_fields: {
        crs_paid: flags.crs_paid ?? true,
        deposit_paid: flags.deposit_paid ?? false,
        sale_closed: flags.sale_closed ?? false,
        total_funding_estimate: prequal
      },
      transactions: { count: flags.tx ?? 1, latest_product: flags.product ?? "UnderwriteIQ Diagnostic", latest_amount: flags.amount ?? 32, latest_status: "paid" },
      crs_count: crs, task_count: tasks,
      created_at: new Date(Date.now() - id * 36e5 * 19).toISOString()
    });
    const clients = [
      mk(1,  "Anthony",  "Brooks",     "FULL_FUNDING",        31000, null,  1, 2, { deposit_paid: true, product: "Funding Deposit", amount: 3000, tx: 2 }),
      mk(2,  "Brian",    "Nakamura",   "FUNDING_PLUS_REPAIR", 35000, null,  1, 1),
      mk(3,  "Carlos",   "Mendez",     "PREMIUM_STACK",       73000, null,  2, 3, { deposit_paid: true, sale_closed: true, product: "Funding Deposit", amount: 3000, tx: 3 }),
      mk(4,  "Derek",    "Washington", "FULL_FUNDING",        60000, 32000, 2, 1, { deposit_paid: true, sale_closed: true, product: "Success Fee", amount: 3200, tx: 3 }),
      mk(5,  "Diana",    "Thornton",   "REPAIR_ONLY",         52000, null,  1, 2),
      mk(6,  "James",    "Whitfield",  "FUNDING_PLUS_REPAIR", 57000, null,  1, 2, { deposit_paid: true }),
      mk(7,  "Jasmine",  "Cole",       "MANUAL_REVIEW",       28000, null,  0, 1, { crs_paid: false }),
      mk(8,  "Kevin",    "Rogers",     "FULL_FUNDING",        82000, null,  1, 0, { deposit_paid: true }),
      mk(9,  "Linda",    "Park",       "REPAIR_ONLY",         58000, null,  0, 1, { crs_paid: false }),
      mk(10, "Marcus",   "Wellington", "PREMIUM_STACK",       88000, 32000, 2, 2, { deposit_paid: true, sale_closed: true, product: "Success Fee", amount: 3200, tx: 3 }),
      mk(11, "Michelle", "Torres",     "FULL_FUNDING",        70000, null,  1, 1, { deposit_paid: true }),
      mk(12, "Natasha",  "Bell",       "FULL_FUNDING",        48000, null,  1, 0, { deposit_paid: true }),
      mk(13, "Patricia", "Gomez",      "PREMIUM_STACK",       90000, null,  2, 2, { deposit_paid: true, sale_closed: true }),
      mk(14, "Robert",   "Chen",       "FUNDING_PLUS_REPAIR", 42000, null,  1, 1),
      mk(15, "Samantha", "Reed",       "REPAIR_ONLY",         18000, null,  0, 1, { crs_paid: false }),
      mk(16, "Tyler",    "Brooks",     "FRAUD_HOLD",              0, null,  1, 1)
    ];
    const TASKS = [
      ["Funding intake — pull CRS",                              "s-06", 1,  false],
      ["Pre-funding review — confirm docs before submit",        "c-05", 1,  false],
      ["Remove inquiries — round in progress",                   "c-02", 3,  false],
      ["3-way handoff — advisor follow-up on UnderwriteIQ",      "ai-set-04", 2, false],
      ["No progress 72h — investigate",                          "dpc-05", 5, false],
      ["Send DIY invoice (Commas checkout) — confirm payment",   "ds-02", 9,  false],
      ["Declined after CRS — document reason + confirm messaging","c-06", 7,  false],
      ["Funding didn't buy — follow-up",                         "s-08", 15, false],
      ["Missing docs — bank statements outstanding",             "f-06", 6,  false],
      ["Post-funding monitoring check",                          "f-08", 4,  false],
      ["Bank email received — triage",                           "f-11", 10, false],
      ["Client funding inbox — provision",                       "f-10", 11, false],
      ["Fix UnderwriteIQ mapping — critical fields missing",     "u-05", 13, false],
      ["Renewal second wave — reach out",                        "n-06", 4,  false],
      ["Inbound reply needs a human",                            "dpc-03", 14, false],
      ["Round approved — confirm terms with client",             "f-04", 3,  true],
      ["Strategy session booked",                                "calcom", 8, true]
    ];
    const tasks = TASKS.map((t, i) => {
      const c = clients.find(x => x.id === t[2]);
      return {
        id: "t" + (i + 1), client_id: t[2], assignee: null, title: t[0],
        body: null, due_at: null, source_workflow: t[1], done: t[3],
        client_name: c ? `${c.first_name} ${c.last_name}` : null,
        created_at: new Date(Date.now() - (i + 1) * 36e5 * 7).toISOString()
      };
    });
    const cases = [
      { id: "recDEMO001", fields: { client_name: "Marcus Wellington", case_status: "Queued", ai_call_status: "Not Scheduled", selected_bureaus_raw: "EX", personal_state: "OH", remover_notes: "1 Experian inquiry flagged during round cleanup", request_source: "Round Cleanup", requested_by: "System", requested_at: "Mar 29 3:00 AM" } },
      { id: "recDEMO002", fields: { client_name: "James Whitfield", case_status: "Scheduled", ai_call_status: "Scheduled", ai_call_scheduled_for: "Today 2:15 PM ET", selected_bureaus_raw: "EX,EQ", personal_state: "OH", remover_notes: "", request_source: "Advisor request", requested_by: "Marcus Webb" } },
      { id: "recDEMO003", fields: { client_name: "Diana Thornton", case_status: "Call Failed", ai_call_status: "Failed", selected_bureaus_raw: "TU", personal_state: "TX", remover_notes: "IVR dropped at identity verification — retry needed", request_source: "Round Cleanup", requested_by: "System" } },
      { id: "recDEMO004", fields: { client_name: "Anthony Brooks", case_status: "Awaiting Remover", ai_call_status: "Transferred", selected_bureaus_raw: "EX", personal_state: "AZ", remover_notes: "AI reached fraud dept and transferred. Human takeover required.", request_source: "Round Cleanup", requested_by: "System" } },
      { id: "recDEMO005", fields: { client_name: "Robert Chen", case_status: "Calling", ai_call_status: "In Progress", selected_bureaus_raw: "EQ", personal_state: "CA", remover_notes: "", request_source: "Advisor request", requested_by: "Marcus Webb" } }
    ];
    return { clients, tasks, cases };
  })();

  /* ---------------- demo router ---------------- */
  function demoRoute(path, opts) {
    const [p, qs] = path.split("?");
    const q = new URLSearchParams(qs || "");
    const body = opts.body ? (typeof opts.body === "string" ? JSON.parse(opts.body) : opts.body) : {};
    const method = (opts.method || "GET").toUpperCase();
    const staff = JSON.parse(localStorage.getItem("fh_demo_staff") || "null");

    if (p === "/api/auth/login") {
      const email = String(body.email || "").trim().toLowerCase();
      const u = DEMO_USERS[email];
      if (!u || body.password !== u.pw) return { status: 401, ok: false, data: { ok: false, error: "invalid_credentials" } };
      const s = { id: "demo-" + email, org_id: "demo-org", role: u.role, email, name: u.name, status: "active" };
      localStorage.setItem("fh_demo", "1");
      localStorage.setItem("fh_demo_staff", JSON.stringify(s));
      return { status: 200, ok: true, data: { ok: true, token: "demo-token", expiresAt: new Date(Date.now() + 6048e5).toISOString(), staff: s } };
    }
    if (p === "/api/auth/session") {
      if (!staff) return { status: 401, ok: false, data: { ok: false, error: "unauthorized" } };
      return { status: 200, ok: true, data: { ok: true, staff } };
    }
    if (p === "/api/auth/logout") {
      localStorage.removeItem("fh_demo"); localStorage.removeItem("fh_demo_staff");
      return { status: 200, ok: true, data: { ok: true } };
    }
    if (p === "/api/dashboard/clients") {
      return { status: 200, ok: true, data: { ok: true, count: D.clients.length, clients: D.clients } };
    }
    if (p === "/api/dashboard/client") {
      const c = D.clients.find(x => String(x.id) === String(q.get("id")));
      if (!c) return { status: 404, ok: false, data: { ok: false, error: "not_found" } };
      return { status: 200, ok: true, data: {
        ok: true, client: c,
        transactions: c.custom_fields.deposit_paid
          ? [{ id: "x1", product_name: "UnderwriteIQ Diagnostic", amount_paid: 32, status: "paid", created_at: c.created_at },
             { id: "x2", product_name: "Funding Deposit", amount_paid: 3000, status: "paid", created_at: c.created_at }]
          : [{ id: "x1", product_name: "UnderwriteIQ Diagnostic", amount_paid: 32, status: "paid", created_at: c.created_at }],
        crs_results: Array.from({ length: c.crs_count }, (_, i) => ({ id: "c" + i, outcome_tier: c.outcome_tier, created_at: c.created_at })),
        messages: [],
        tasks: D.tasks.filter(t => t.client_id === c.id)
      } };
    }
    if (p === "/api/tasks") {
      if (method === "PATCH") {
        const t = D.tasks.find(x => x.id === body.id);
        if (t) t.done = !!body.done;
        return { status: 200, ok: true, data: { ok: true, task: t } };
      }
      const want = (q.get("done") || "false").toLowerCase();
      let list = D.tasks;
      if (want === "false") list = list.filter(t => !t.done);
      else if (want === "true") list = list.filter(t => t.done);
      if (q.get("client_id")) list = list.filter(t => String(t.client_id) === q.get("client_id"));
      return { status: 200, ok: true, data: { ok: true, count: list.length, tasks: list } };
    }
    if (p === "/api/inquiry") {
      const action = q.get("action");
      if (action === "cases") {
        const st = q.get("status");
        let list = D.cases;
        if (st) list = list.filter(c => c.fields.case_status === st);
        else if (q.get("all") !== "1") list = list.filter(c => c.fields.case_status !== "Completed");
        return { status: 200, ok: true, data: { ok: true, count: list.length, cases: list } };
      }
      if (action === "update") {
        const c = D.cases.find(x => x.id === body.case_id);
        if (c) Object.assign(c.fields, body.fields || {});
        return { status: 200, ok: true, data: { ok: true, id: body.case_id, fields: c ? c.fields : {} } };
      }
      if (action === "schedule" || action === "launch") {
        const c = D.cases.find(x => x.id === body.case_id);
        if (c) { c.fields.case_status = "Scheduled"; c.fields.ai_call_status = "Scheduled"; c.fields.ai_call_scheduled_for = "Queued (demo)"; }
        return { status: 200, ok: true, data: { ok: true, demo: true } };
      }
      return { status: 400, ok: false, data: { ok: false, error: "unknown_action" } };
    }
    if (p === "/api/dashboard/seed") return { status: 200, ok: true, data: { ok: true, demo: true } };
    return { status: 404, ok: false, data: { ok: false, error: "not_found" } };
  }

  /* ---------------- api ---------------- */
  async function api(path, opts = {}) {
    if (isDemo() || path === "/api/auth/login") {
      if (!isDemo()) {
        // Try the real backend once. If it can't answer, use demo.
        try {
          const r = await fetch(path, {
            ...opts,
            headers: { "content-type": "application/json", ...(opts.headers || {}) },
            body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body
          });
          if (r.status !== 404 && r.status < 500) {
            let data = null; try { data = await r.json(); } catch {}
            if (data && (data.ok || r.status === 401)) return { status: r.status, ok: r.ok, data };
          }
        } catch { /* backend unreachable → demo */ }
      }
      return demoRoute(path, opts);
    }

    const r = await fetch(path, {
      ...opts,
      headers: {
        "content-type": "application/json",
        ...(token() ? { authorization: "Bearer " + token() } : {}),
        ...(opts.headers || {})
      },
      body: opts.body && typeof opts.body !== "string" ? JSON.stringify(opts.body) : opts.body
    });
    if (r.status === 401 && !location.pathname.endsWith("/login.html")) {
      location.href = "/login.html?next=" + encodeURIComponent(location.pathname);
      return new Promise(() => {});
    }
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, ok: r.ok, data };
  }

  const NAV = [
    { href: "/closer.html",  label: "Closer",  roles: ["closer", "funding_advisor", "admin", "owner"] },
    { href: "/ops.html",     label: "Ops",     roles: ["funding_advisor", "admin", "owner"] },
    { href: "/tasks.html",   label: "Tasks",   roles: ["closer", "funding_advisor", "inquiry_specialist", "setter", "admin", "owner"] },
    { href: "/inquiry.html", label: "Inquiry", roles: ["inquiry_specialist", "admin", "owner"] }
  ];

  async function guard() {
    const { ok, data } = await api("/api/auth/session");
    if (!ok) { location.href = "/login.html"; return null; }
    const staff = data.staff;
    const role = String(staff.role || "").toLowerCase();
    const bar = document.querySelector(".top nav");
    if (bar) {
      bar.innerHTML = "";
      for (const item of NAV) {
        if (!(role === "owner" || item.roles.includes(role))) continue;
        const a = document.createElement("a");
        a.href = item.href; a.textContent = item.label;
        if (location.pathname === item.href) a.className = "on";
        bar.appendChild(a);
      }
      const site = document.createElement("a");
      site.href = "/"; site.textContent = "↗ Site"; site.style.marginLeft = "auto";
      bar.appendChild(site);
    }
    const who = document.querySelector(".top .who");
    if (who) who.innerHTML = `${esc(staff.name || staff.email)} · ${esc(role)}` +
      (isDemo() ? ` <span class="chip warn" style="margin-left:8px">DEMO DATA</span>` : "");
    const out = document.querySelector("#logout");
    if (out) out.onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      localStorage.removeItem("fh_token"); localStorage.removeItem("fh_demo"); localStorage.removeItem("fh_demo_staff");
      location.href = "/login.html";
    };
    window.STAFF = staff;
    return staff;
  }

  function poll(fn, ms = 10000) {
    let t;
    const tick = async () => { try { await fn(); } catch (e) { console.error(e); } t = setTimeout(tick, ms); };
    tick();
    document.addEventListener("visibilitychange", () => { clearTimeout(t); if (!document.hidden) tick(); });
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const money = (n) => (n === null || n === undefined || n === "" || isNaN(Number(n))) ? "—" : "$" + Number(n).toLocaleString();
  const ago = (ts) => {
    if (!ts) return "—";
    const s = (Date.now() - new Date(ts).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  };
  const TIER_CHIP = { PREMIUM_STACK:"ok", FULL_FUNDING:"ok", FUNDING_PLUS_REPAIR:"info", REPAIR_ONLY:"warn", MANUAL_REVIEW:"accent", FRAUD_HOLD:"alert" };
  const tierChip = (t) => t ? `<span class="chip ${TIER_CHIP[t] || ""}">${esc(t)}</span>` : `<span class="chip">—</span>`;
  const CASE_CHIP = { "Queued":"warn","Scheduled":"info","Calling":"accent","Awaiting Remover":"warn","Call Failed":"alert","Blocked":"alert","Transferred":"accent","On Hold":"warn","Completed":"ok" };
  const caseChip = (s) => s ? `<span class="chip ${CASE_CHIP[s] || ""}">${esc(s)}</span>` : `<span class="chip">—</span>`;

  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  }

  return { api, guard, poll, esc, money, ago, tierChip, caseChip, toast, isDemo };
})();
