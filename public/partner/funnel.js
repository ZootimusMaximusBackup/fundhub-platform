/* Ascension funnel — prices and checkout. Every /partner/ page loads this.
   ==========================================================================

   TWO JOBS, AND THE FIRST ONE IS WHY THE SECOND CAN BE TRUSTED.

   1. PRICES. Not one price is typed into the markup. Every visible figure is a
      <span data-price="autopsy"> filled from GET /api/public/funnel-checkout,
      which reads src/config/offers.mjs and the constants beside the charging
      code. A price in HTML is a second copy of a number, and the second copy is
      the one that is wrong after somebody changes the first.

      Until the fetch lands each slot shows an em dash and every buy button is
      disabled. A page that cannot state the price does not take money.

   2. CHECKOUT. A real form posting to a real till. These pages used to send a
      $27 buyer to the partner APPLICATION form, which is where a $10,000
      invite-only offer belongs and nowhere a self-serve purchase does.

   ATTRIBUTION SURVIVES THE HOP. `track` (which page sent them) and a1/a2 (the
   affiliate referral params src/workflows/af-02-referral-ownership-capture.mjs
   reads) are taken off the query string, remembered for the tab, and posted
   with the purchase. Someone landing on /partner/?a1=DKOWAL and buying on
   /partner/board/ two clicks later is still attributed. */
(function () {
  "use strict";

  var API = "/api/public/funnel-checkout";
  var KEY = "fundhub.funnel.attribution";
  var PARAMS = ["track", "a1", "a2"];

  /* ── attribution ─────────────────────────────────────────────────────── */

  function readAttribution() {
    var out = {};
    var q;
    try { q = new URLSearchParams(window.location.search); } catch (e) { q = null; }

    var stored = {};
    try { stored = JSON.parse(window.sessionStorage.getItem(KEY) || "{}") || {}; } catch (e) { stored = {}; }

    PARAMS.forEach(function (k) {
      var v = q ? q.get(k) : null;
      /* ?ref= and ?code= mean the same thing as ?a1= — all three appear on
         links in the wild and api/public/affiliate-click.mjs accepts all
         three. */
      if (!v && k === "a1" && q) v = q.get("ref") || q.get("code");
      out[k] = (v || stored[k] || "").slice(0, 40) || null;
    });

    try { window.sessionStorage.setItem(KEY, JSON.stringify(out)); } catch (e) { /* private mode */ }
    return out;
  }

  var attribution = readAttribution();

  /* ── prices ──────────────────────────────────────────────────────────── */

  function paint(catalogue) {
    var bySlug = {};
    (catalogue.items || []).forEach(function (i) { bySlug[i.slug] = i; });

    document.querySelectorAll("[data-price]").forEach(function (el) {
      var item = bySlug[el.getAttribute("data-price")];
      if (item && item.priceDisplay) el.textContent = item.priceDisplay;
    });
    document.querySelectorAll("[data-price-label]").forEach(function (el) {
      var item = bySlug[el.getAttribute("data-price-label")];
      if (item && item.priceLabel) el.textContent = item.priceLabel;
    });
    document.querySelectorAll("[data-notice]").forEach(function (el) {
      var text = (catalogue.notices || {})[el.getAttribute("data-notice")];
      if (text) el.textContent = text;
    });

    document.querySelectorAll("form[data-checkout]").forEach(function (form) {
      var item = bySlug[form.getAttribute("data-checkout")];
      var button = form.querySelector("button[type=submit]");
      if (!button) return;
      if (item && item.available) {
        button.disabled = false;
        button.textContent = button.getAttribute("data-label") || button.textContent;
      } else {
        button.disabled = true;
        say(form, item && !item.priceCents
          ? "This price is not set up yet. Nothing is being charged."
          : "Checkout is not available right now. Nothing has been charged.");
      }
    });
  }

  function say(form, message) {
    var slot = form.querySelector("[data-checkout-error]");
    if (slot) slot.textContent = message || "";
  }

  /* ── checkout ────────────────────────────────────────────────────────── */

  var MESSAGES = {
    email_required: "That email address does not look right. Check it and try again.",
    unknown_item: "Something is wrong with this page. Nothing has been charged.",
    price_missing: "This price is not set up yet. Nothing has been charged.",
    not_self_serve: "This one is sold on a review call, not on this page.",
    checkout_not_configured: "Checkout is not switched on yet. Nothing has been charged.",
    checkout_failed: "The payment page would not open. Nothing has been charged — please try again."
  };

  function submit(form, event) {
    event.preventDefault();
    var slug = form.getAttribute("data-checkout");
    var button = form.querySelector("button[type=submit]");
    var data = new FormData(form);

    say(form, "");
    if (button) {
      button.disabled = true;
      if (!button.getAttribute("data-label")) button.setAttribute("data-label", button.textContent);
      button.textContent = "Opening checkout…";
    }

    var body = {
      item: slug,
      email: data.get("email") || "",
      first_name: data.get("first_name") || "",
      last_name: data.get("last_name") || "",
      track: attribution.track,
      a1: attribution.a1,
      a2: attribution.a2
    };

    fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (res) { return res.json().catch(function () { return {}; }); })
      .then(function (out) {
        if (out && out.ok && out.checkoutUrl) {
          window.location.href = out.checkoutUrl;
          return;
        }
        say(form, MESSAGES[out && out.error] || MESSAGES.checkout_failed);
        restore(button);
      })
      .catch(function () {
        say(form, MESSAGES.checkout_failed);
        restore(button);
      });
  }

  function restore(button) {
    if (!button) return;
    button.disabled = false;
    button.textContent = button.getAttribute("data-label") || "Continue";
  }

  /* ── boot ────────────────────────────────────────────────────────────── */

  document.querySelectorAll("form[data-checkout]").forEach(function (form) {
    form.addEventListener("submit", function (e) { submit(form, e); });
  });

  /* Any link that leaves this page for another funnel page carries the
     attribution forward, so a shared /partner/?a1=X link still attributes a
     purchase made two clicks later even with sessionStorage unavailable. */
  document.querySelectorAll('a[href^="/partner/"]').forEach(function (a) {
    var carry = PARAMS.filter(function (k) { return attribution[k]; });
    if (!carry.length) return;
    try {
      var url = new URL(a.getAttribute("href"), window.location.origin);
      carry.forEach(function (k) {
        if (!url.searchParams.has(k)) url.searchParams.set(k, attribution[k]);
      });
      a.setAttribute("href", url.pathname + url.search + url.hash);
    } catch (e) { /* leave the link alone */ }
  });

  fetch(API, { headers: { accept: "application/json" } })
    .then(function (res) { return res.json(); })
    .then(function (out) { if (out && out.ok) paint(out); })
    .catch(function () { /* slots keep their em dash; buttons stay disabled */ });

  var yr = document.getElementById("yr");
  if (yr) yr.textContent = new Date().getFullYear();
})();
