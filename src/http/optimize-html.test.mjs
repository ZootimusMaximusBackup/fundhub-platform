// public/optimize.html is referrals only. Book goes to the phonecall calendar.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(HERE, "../../public/optimize.html");
const TOML = path.resolve(HERE, "../../netlify.toml");

const html = fs.readFileSync(PAGE, "utf8");
const toml = fs.readFileSync(TOML, "utf8");

test("optimize.html books on schedule/phonecall, not funding-book-call or xyl.in", () => {
  assert.match(
    html,
    /https:\/\/apply\.fundhub\.ai\/schedule\/phonecall/,
    "must reuse the credit-repair phonecall calendar URL"
  );
  assert.doesNotMatch(
    html,
    /funding-book-call/,
    "must not send referrals to the funding survey calendar"
  );
  assert.match(html, /Get My Credit Report/, "primary button must say what happens");
  assert.match(html, /book a call/i, "the call is still reachable from this page");
  assert.match(
    html,
    /Fundhub Credit Solutions LLC/,
    "public entity must be Fundhub Credit Solutions LLC"
  );
  assert.doesNotMatch(html, /xyl\.in/i, "must not send people to xyl.in");
  assert.doesNotMatch(html, /Identity\s*IQ/i, "must not mention Identity IQ");
  assert.doesNotMatch(html, /\bCRS\b/, "must not mention CRS");
  assert.doesNotMatch(
    html,
    /href="https:\/\/apply\.fundhub\.ai\/"/,
    "must not send people to bare apply.fundhub.ai/"
  );
  assert.doesNotMatch(
    html,
    /your score will go up/i,
    "must not claim a credit outcome"
  );
  // The Audit section was removed from this page on 2026-08-28 (owner decision:
  // one form, first/last/email/phone, and the SmartCredit signup — nothing else).
  // The compliance guards below are the part that must never move.
  assert.match(
    html,
    /sms_consent/,
    "a page that takes a mobile number must carry the consent box"
  );
  assert.match(
    html,
    /Reply STOP to opt out/,
    "consent must keep the shipped opt-out wording"
  );
  assert.doesNotMatch(html, /credit repair/i, "must not say credit repair on the page");
  assert.match(html, /\/api\/public\/optimize/, "the page reads its config from the public optimize door");
  assert.match(
    html,
    /affiliateUrl/,
    "the signup link must be overridable from the server config, not only hardcoded"
  );
  assert.match(html, /affiliateUrl/, "Pull your file uses their partner affiliate URL when the widget is dark");
});

test("netlify.toml rewrites /optimize.com to the hidden page, not xyl.in", () => {
  assert.match(
    toml,
    /from\s*=\s*"\/optimize\.com"[\s\S]*?to\s*=\s*"\/optimize\.html"/,
    "/optimize.com must rewrite to /optimize.html"
  );
  assert.doesNotMatch(
    toml,
    /from\s*=\s*"\/optimize\.com"[\s\S]*?xyl\.in/,
    "/optimize.com must not 302 to xyl.in"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE REVIEW REQUIRED — ConsumerDirect's SmartCredit compliance review
// (developer.consumerdirect.io/docs/support-compliance-review). They read this
// page before they will issue a production key. Every check below is one of
// their twelve numbered items, and each one exists so the wording cannot be
// quietly dropped later. Do not weaken these.
// ─────────────────────────────────────────────────────────────────────────────

test("item 2 — SmartCredit is named, and named as separate from Fundhub", () => {
  assert.match(html, /SmartCredit/, "the product must be named where a person can read it");
  assert.match(
    html,
    /It is not a\s+Fundhub product and it is not part of Fundhub Credit Solutions LLC/,
    "SmartCredit must be stated as not a Fundhub product"
  );
  assert.match(html, /class="scbox"/, "SmartCredit needs its own bordered block, not our card");
});

test("item 3 — the registered trademark symbol is used, and attributed", () => {
  assert.match(html, /SmartCredit&reg;/, "SmartCredit must carry the registered mark");
  assert.match(
    html,
    /SmartCredit is a registered trademark\. It is not owned by Fundhub Credit Solutions LLC\./,
    "the trademark attribution line must stay in the footer"
  );
});

test("item 4 — SmartCredit is described only as a credit monitoring product", () => {
  assert.match(
    html,
    /SmartCredit&reg; is a credit monitoring product\./,
    "the one-line description must stay exactly this narrow"
  );
  assert.doesNotMatch(
    html,
    /we pull all three bureaus/i,
    "the person pulls their own report through SmartCredit; Fundhub does not pull it"
  );
});

test("item 5 — nothing on the page suggests credit repair services", () => {
  assert.doesNotMatch(html, /credit repair/i, "the banned phrase itself");
  assert.doesNotMatch(html, /right to dispute/i, "disputing describes credit repair");
  assert.doesNotMatch(html, /must investigate/i, "the 30-day bureau duty describes credit repair");
  assert.doesNotMatch(html, /must be deleted or corrected/i, "deletion describes credit repair");
  assert.doesNotMatch(html, /class="marq/, "the FCRA rights ticker was removed from this page");
  assert.doesNotMatch(
    html,
    /mark what is being reported wrong/i,
    "naming wrong entries describes credit repair"
  );
  assert.match(
    html,
    /does not repair credit or contact bureaus on your behalf/,
    "the strongest sentence on the page must stay"
  );
});

test("item 6 — the person is told this is a separate membership before they sign up", () => {
  assert.match(
    html,
    /This is a\s+separate membership with a separate company/,
    "separate membership, separate company, in those words"
  );
  assert.match(html, /Read this before you sign up/, "the block must be labelled and unmissable");
});

test("item 8 — pricing is shown, and shown as a recurring monthly fee", () => {
  assert.match(html, /\$29\.99 every\s+month/, "Build price, stated as monthly");
  assert.match(html, /\$19\.99\s+every month/, "Protect price, stated as monthly");
  assert.match(html, /There is no free trial/, "no trial must be stated");
  assert.match(
    html,
    /charged every month until you cancel/,
    "the consumer must understand the fee repeats"
  );
  assert.doesNotMatch(
    html,
    /membership from \$19\.99/,
    "the old 'from $19.99' line hid the $29.99 plan and never said monthly"
  );
});

test("item 9 — the four SmartCredit documents are named next to the sign-up control", () => {
  for (const doc of ["Service Agreement", "Privacy Policy", "Terms of Use", "Consumer Rights"]) {
    assert.match(html, new RegExp(doc), `${doc} must be named before sign-up`);
  }
  for (const key of ["serviceAgreement", "privacyPolicy", "termsOfUse", "consumerRights"]) {
    assert.match(
      html,
      new RegExp(`data-sc-doc="${key}"`),
      `${key} must be a slot the server can turn into a real link`
    );
  }
  // The four addresses were never given to us. Guessing one is worse than a
  // visible gap, so nothing here may hardcode a smartcredit.com policy path.
  assert.doesNotMatch(
    html,
    /smartcredit\.com\/(terms|privacy|legal|agreement)/i,
    "policy addresses must come from env by name, never be invented in the page"
  );
});

test("item 10 — an agreement checkbox sits by the control and genuinely refuses", () => {
  assert.match(html, /id="sc-agree"/, "the agreement checkbox must exist");
  assert.match(
    html,
    /I have read and agree to the SmartCredit&reg; Service Agreement/,
    "the agreement wording must stay"
  );
  assert.match(
    html,
    /if \(!agree\.checked\) \{\s*\n\s*e\.preventDefault\(\)/,
    "an unticked box must actually stop the click, not just skip saving"
  );
});

test("item 11 — the page says when the SmartCredit membership begins", () => {
  assert.match(
    html,
    /membership starts as soon as you finish the\s+SmartCredit&reg; sign-up screens and your card is accepted/,
    "enrollment start must be stated plainly"
  );
});

test("item 12 — cancelling either product is stated as independent", () => {
  assert.match(html, /Cancelling one does not cancel the other/, "in the SmartCredit block");
  assert.match(
    html,
    /You cancel each one with the company\s+you bought it from/,
    "and the person is told who to cancel with"
  );
});

test("item 7 — the two services are presented in separate blocks, not one package", () => {
  assert.match(html, /class="fhbox"/, "Fundhub's own service needs its own block");
  assert.match(
    html,
    /Our service is separate and you buy it separately\. Signing up for SmartCredit&reg; does\s+not buy it and does not include it\./,
    "the no-bundling sentence must stay"
  );
});

test("the ConsumerDirect widget is mounted the way their spec requires", () => {
  assert.match(html, /"cd-signup-widget"/, "their container id");
  assert.match(html, /"data-clientkey"/, "required attribute");
  assert.match(html, /"data-memberurl"/, "required attribute — they build login and policy links from it");
  assert.match(html, /"data-productname"/, "required attribute");
  assert.match(html, /name: "PID"/, "the hidden PID field is how they credit the signup to us");
  assert.match(html, /s\.type = "module"/, "their file loads as a module");
  assert.match(html, /"cd-signup-prefill"/, "the name and email typed above are handed over");
  assert.match(html, /"cd-memberplans-widget"/, "required unless a custom plan display exists");
  assert.match(html, /"cd-progress-widget"/, "shows where SmartCredit sign-up begins");
  assert.match(html, /"cd-marketing-message-widget"/, "their own approved co-marketing wording");
  assert.match(html, /data-companyname": "Fundhub Credit Solutions LLC"/, "our exact entity name");
});

test("all three ConsumerDirect failure signals are handled, and told apart", () => {
  assert.match(html, /cd-signup-next-step/, "the page must listen for their signal");
  assert.match(html, /step === "ConfirmationStep"/, "success is this and nothing else");
  assert.match(html, /step === "SignupError"/, "the general failure");
  assert.match(html, /step === "SignupErrorOutsideUS"/, "the US-address failure");
  assert.match(html, /step === "SignupErrorBlackbox"/, "the fraud-screen failure");
  assert.match(html, /restartSignup/, "their reset is offered on a recoverable failure");
  // A fraud block must not be retried automatically. showStuck("blackbox") offers
  // the call, never the restart.
  assert.match(
    html,
    /Deliberately no restart button/,
    "the fraud-screen path must stay restart-free"
  );
});

test("the signal's personal data never leaves the page", () => {
  assert.doesNotMatch(html, /customerToken/, "the token names a real person — never read it here");
  assert.doesNotMatch(html, /customerEmail/, "same for the email");
  assert.doesNotMatch(
    html,
    /location\.assign\([^)]*email/i,
    "no personal data may be put in a web address"
  );
});

test("the no-key path is unchanged — production has no key and must keep the link", () => {
  assert.match(
    html,
    /href="https:\/\/smartcredit\.com\/cblp\/\?PID=29056"/,
    "the tracking link stays as the control's address when the widget is dark"
  );
  assert.match(
    html,
    /if \(sc\.affiliateUrl\) go\.setAttribute\("href", sc\.affiliateUrl\)/,
    "and the server can still override it"
  );
  assert.match(
    html,
    /if \(sc\.clientKey && sc\.pid\) \{ widget = sc; return; \}/,
    "the widget only ever arms when BOTH names come back"
  );
});

test("the SMS consent box records what was actually ticked", () => {
  // It used to write `sms_consent: true` no matter what the person did.
  assert.match(html, /sms_consent: sms\.checked === true/, "record the real answer");
  assert.doesNotMatch(html, /sms_consent: true/, "never hardcode consent as given");
});

test("`hidden` actually hides — .btn sets display:block and would beat it", () => {
  // Regression. Without this rule `go.hidden = true` did nothing, so the old
  // off-site tracking link stayed on screen underneath the mounted widget and
  // could pull a person out of the sign-up half way through.
  assert.match(html, /\[hidden\]\{display:none !important\}/, "the [hidden] rule must stay");
});

test("the success state claims nothing ConsumerDirect has not told us", () => {
  assert.doesNotMatch(html, /email you your login/i, "nobody has confirmed they email a login");
  assert.match(
    html,
    /Your monthly SmartCredit® membership has started/,
    "what we can stand behind: the membership started and it repeats"
  );
});
