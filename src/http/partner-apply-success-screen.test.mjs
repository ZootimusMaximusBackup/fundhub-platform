// What the public apply page SAYS after a white-label application is submitted.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): customer-facing copy.
//
// WHAT WAS WRONG. public/affiliates/index.html has one success panel behind two
// very different outcomes. An AFFILIATE really is created on submit — row,
// login, referral link — so "your login is ready" is true for them. A
// WHITE-LABEL application is invite-only: api/public/partner-apply.mjs writes
// one partners row at status 'invited' and returns password, login_url,
// referral_url and site_url ALL NULL, because none of those things exist until
// a person approves it (POST /api/partners/approve).
//
// The panel printed them anyway. A white-label applicant saw "✓ YOU'RE IN",
// "Your login is ready", a "First password" row that was blank, and a "Log in
// now" button pointing at a login they did not have.
//
// HOW THIS IS TESTED. Not by grepping the file for words. The page's submit
// handler is lifted out of the HTML and RUN, against a tiny stub document and a
// stub fetch that answers with the real response shape the endpoint returns. So
// these assertions are on what the panel actually ends up showing.
//
// NO DATABASE. The response bodies below are copied from the shapes asserted in
// src/http/partner-apply.test.mjs and src/http/partner-signup.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, "../../public/affiliates/index.html");
const HTML = fs.readFileSync(PAGE, "utf8");

/* The one statement under test, lifted from the page's inline script: the
   submit handler and nothing else. Slicing rather than evaluating the whole
   block keeps a cursor animation and an IntersectionObserver out of a test that
   is about words on a screen. */
const HANDLER_SRC = (() => {
  const start = HTML.indexOf("document.getElementById('pform').addEventListener('submit',");
  assert.notEqual(start, -1, "the apply form's submit handler moved — this test is now blind");
  const end = HTML.lastIndexOf("</script>");
  assert.ok(end > start, "could not find the end of the inline script");
  return HTML.slice(start, end);
})();

function el(id) {
  return {
    id,
    textContent: "",
    innerHTML: "",
    href: "",
    value: "",
    checked: false,
    disabled: false,
    style: { display: "" },
    scrollIntoView() {},
    querySelector() { return null; }
  };
}

/* A document just deep enough for the handler: every id it asks for, plus the
   form's submit button. Any id the handler invents that is not on the page
   throws, which is the failure mode this stub exists to catch. */
function makeDom(form = {}) {
  const ids = [
    "p-name", "p-email", "p-phone", "p-co", "p-track", "p-aud", "p-sms",
    "apply-err", "pform", "success", "success-chk", "success-title",
    "success-lead", "success-cred", "success-email", "success-pass",
    "success-link", "success-link-label", "success-next", "success-next-email",
    "success-login", "success-login-row"
  ];
  const nodes = Object.fromEntries(ids.map((id) => [id, el(id)]));
  for (const id of ids) {
    assert.ok(HTML.includes(`id="${id}"`), `the page has no element with id ${id}`);
  }

  nodes["p-name"].value = form.name || "Dana Owner";
  nodes["p-email"].value = form.email || "dana@example.test";
  nodes["p-phone"].value = form.phone || "6615550100";
  nodes["p-co"].value = form.company || "Dana Funding LLC";
  nodes["p-track"].value = form.track || "white_label";
  nodes["p-aud"].value = form.audience || "I speak to small business owners.";
  nodes["p-sms"].checked = !!form.sms;

  const button = { disabled: false, textContent: "Submit partner application" };
  nodes.pform.querySelector = (sel) => (sel === "button[type=submit]" ? button : null);

  return {
    nodes,
    button,
    document: {
      getElementById(id) {
        if (!(id in nodes)) throw new Error(`no element with id ${id}`);
        return nodes[id];
      }
    }
  };
}

/* Runs the real handler against one API answer and hands back the panel. */
async function submit({ form, response, status = 200 }) {
  const dom = makeDom(form);
  let submitted = null;
  let handler = null;

  const formEl = dom.nodes.pform;
  formEl.addEventListener = (type, fn) => { if (type === "submit") handler = fn; };

  const fetchStub = (url, init) => {
    submitted = { url, body: JSON.parse(init.body) };
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(response)
    });
  };

  const alerts = [];
  // eslint-disable-next-line no-new-func
  const load = new Function("document", "fetch", "alert", HANDLER_SRC);
  load(dom.document, fetchStub, (m) => alerts.push(m));
  assert.ok(handler, "the page never registered a submit handler");

  let prevented = false;
  await handler.call(formEl, { preventDefault() { prevented = true; } });
  // The handler does not return its promise chain, so let the microtasks run.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

  return { ...dom, submitted, alerts, prevented };
}

const WHITE_LABEL_RESPONSE = {
  ok: true,
  kind: "partner",
  status: "pending_review",
  email: "dana@example.test",
  password: null,
  login_url: null,
  referral_url: null,
  tracking_id: null,
  site_url: null,
  site_path: null,
  partner_id: "9f2c1d3e-0000-4000-8000-000000000001",
  affiliate_id: null
};

const AFFILIATE_RESPONSE = {
  ok: true,
  kind: "affiliate",
  status: "active",
  email: "dana@example.test",
  password: "s3cret-first-password",
  login_url: "https://fundhub.ai/login.html",
  referral_url: "https://fundhub.ai/start?ref=TRK123",
  tracking_id: "TRK123",
  site_url: null,
  site_path: null,
  partner_id: null,
  affiliate_id: "9f2c1d3e-0000-4000-8000-000000000002"
};

/* ── White-label: an application, not an account ─────────────────────────── */

test("a white-label applicant is never shown a blank password", async () => {
  const { nodes } = await submit({ response: WHITE_LABEL_RESPONSE });
  assert.equal(nodes["success-cred"].style.display, "none",
    "the credentials list has nothing to put in it and must be hidden");
  assert.equal(nodes["success-pass"].textContent, "",
    "nothing must be written into the password row at all");
});

test("a white-label applicant is not offered a login they do not have", async () => {
  const { nodes } = await submit({ response: WHITE_LABEL_RESPONSE });
  assert.equal(nodes["success-login-row"].style.display, "none",
    "'Log in now' pointed at a login the application did not create");
  assert.equal(nodes["success-link"].href, "",
    "and no link is repointed at the login page as a consolation");
});

test("a white-label applicant is told an application was received, not that they are in", async () => {
  const { nodes } = await submit({ response: WHITE_LABEL_RESPONSE });
  assert.match(nodes["success-chk"].textContent, /APPLICATION RECEIVED/);
  assert.ok(!/YOU'RE IN/i.test(nodes["success-chk"].textContent));
  assert.match(nodes["success-title"].textContent, /application is in/i);
  assert.ok(!/login is ready/i.test(nodes["success-title"].textContent));
  assert.match(nodes["success-lead"].textContent, /nothing is live yet/i);
  assert.match(nodes["success-lead"].textContent, /review call/i,
    "the next real step is a call with a person");
});

test("the white-label next-steps list is shown, addressed to the email they typed", async () => {
  const { nodes } = await submit({ response: WHITE_LABEL_RESPONSE });
  assert.equal(nodes["success-next"].style.display, "block");
  assert.equal(nodes["success-next-email"].textContent, "dana@example.test");
});

test("the white-label success copy promises no money, no date and no outcome", async () => {
  const { nodes } = await submit({ response: WHITE_LABEL_RESPONSE });
  const copy = [
    nodes["success-chk"].textContent,
    nodes["success-title"].textContent,
    nodes["success-lead"].textContent
  ].join(" ");
  // No earnings claims anywhere public: zero measured paid closes exist.
  assert.ok(!/\$|\bearn\b|\bincome\b|\bcommission\b|\brevenue\b|%/i.test(copy), copy);
  // No promise about when, which nobody has committed to keeping.
  assert.ok(!/\b(24|48|72)\s*hours?\b|\bwithin \d|\bsame day\b|\btomorrow\b/i.test(copy), copy);
});

test("the submit button never claims it is creating a login", async () => {
  assert.ok(!/Creating your login/i.test(HTML),
    "white-label submits create no login, so the button must not say one is being made");
  const { button } = await submit({ response: WHITE_LABEL_RESPONSE });
  assert.match(button.textContent, /Sending your application/i);
});

/* ── Affiliate: unchanged, and still honest when there is no new password ── */

test("an affiliate still gets their first password and referral link", async () => {
  const { nodes } = await submit({
    form: { track: "affiliate" },
    response: AFFILIATE_RESPONSE
  });
  assert.notEqual(nodes["success-cred"].style.display, "none");
  assert.equal(nodes["success-pass"].textContent, "s3cret-first-password");
  assert.equal(nodes["success-link"].href, "https://fundhub.ai/start?ref=TRK123");
  assert.match(nodes["success-link-label"].textContent, /referral link/i);
  assert.equal(nodes["success-next"].style.display, "",
    "the review-call list belongs to white-label only");
});

test("an affiliate who already had a login is told so, not shown a blank box", async () => {
  const { nodes } = await submit({
    form: { track: "affiliate" },
    response: { ...AFFILIATE_RESPONSE, password: null }
  });
  assert.notEqual(nodes["success-pass"].textContent, "",
    "an empty password row reads as 'we lost it'");
  assert.match(nodes["success-pass"].textContent, /already use/i);
});

/* ── The request itself ──────────────────────────────────────────────────── */

test("the form posts the applicant's own consent tick, untouched", async () => {
  const { submitted } = await submit({
    form: { sms: true },
    response: WHITE_LABEL_RESPONSE
  });
  assert.equal(submitted.url, "/api/public/partner-apply");
  assert.equal(submitted.body.sms_consent, true);
  assert.equal(submitted.body.track, "white_label");
  assert.equal(submitted.body.phone, "6615550100");
});

test("a failed submit says the application did not send, and lets them retry", async () => {
  const { nodes, button } = await submit({
    response: { ok: false, error: "server_down" },
    status: 500
  });
  assert.equal(button.disabled, false, "the button must come back");
  assert.match(button.textContent, /Submit partner application/i);
  assert.equal(nodes["apply-err"].style.display, "block");
  assert.match(nodes["apply-err"].textContent, /application/i);
  assert.ok(!/login/i.test(nodes["apply-err"].textContent),
    "a white-label failure has nothing to do with a login");
  assert.equal(nodes.success.style.display, "", "no success panel on a failure");
});
