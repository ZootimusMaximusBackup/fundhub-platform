/* Fundhub screens v0 — shared client. Bearer session, guard, nav, polling. */
const FH = (() => {
  const token = () => localStorage.getItem("fh_token") || "";

  async function api(path, opts = {}) {
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
    let data = null;
    try { data = await r.json(); } catch { /* non-json */ }
    return { status: r.status, ok: r.ok, data };
  }

  const NAV = [
    { href: "/closer.html",  label: "Closer",   roles: ["closer", "funding_advisor", "admin", "owner"] },
    { href: "/ops.html",     label: "Ops",      roles: ["funding_advisor", "admin", "owner"] },
    { href: "/tasks.html",   label: "Tasks",    roles: ["closer", "funding_advisor", "inquiry_specialist", "setter", "admin", "owner"] },
    { href: "/inquiry.html", label: "Inquiry",  roles: ["inquiry_specialist", "admin", "owner"] }
  ];

  // guard() — session check + role-aware top bar. Returns staff.
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
    }
    const who = document.querySelector(".top .who");
    if (who) who.textContent = `${staff.name || staff.email} · ${role}`;
    const out = document.querySelector("#logout");
    if (out) out.onclick = async () => {
      await api("/api/auth/logout", { method: "POST" });
      localStorage.removeItem("fh_token");
      location.href = "/login.html";
    };
    window.STAFF = staff;
    return staff;
  }

  // poll — run now, then every ms while the tab is visible.
  function poll(fn, ms = 10000) {
    let t;
    const tick = async () => { try { await fn(); } catch (e) { console.error(e); } t = setTimeout(tick, ms); };
    tick();
    document.addEventListener("visibilitychange", () => {
      clearTimeout(t);
      if (!document.hidden) tick();
    });
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n === null || n === undefined || n === "" || isNaN(Number(n)))
    ? "—" : "$" + Number(n).toLocaleString();
  const ago = (ts) => {
    if (!ts) return "—";
    const s = (Date.now() - new Date(ts).getTime()) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m";
    if (s < 86400) return Math.round(s / 3600) + "h";
    return Math.round(s / 86400) + "d";
  };

  const TIER_CHIP = {
    PREMIUM_STACK: "ok", FULL_FUNDING: "ok", FUNDING_PLUS_REPAIR: "info",
    REPAIR_ONLY: "warn", MANUAL_REVIEW: "accent", FRAUD_HOLD: "alert"
  };
  const tierChip = (t) => t
    ? `<span class="chip ${TIER_CHIP[t] || ""}">${esc(t)}</span>`
    : `<span class="chip">—</span>`;

  const CASE_CHIP = {
    "Queued": "warn", "Scheduled": "info", "Calling": "accent",
    "Awaiting Remover": "warn", "Call Failed": "alert", "Blocked": "alert",
    "Transferred": "accent", "On Hold": "warn", "Completed": "ok"
  };
  const caseChip = (s) => s
    ? `<span class="chip ${CASE_CHIP[s] || ""}">${esc(s)}</span>`
    : `<span class="chip">—</span>`;

  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 2200);
  }

  return { api, guard, poll, esc, money, ago, tierChip, caseChip, toast };
})();
