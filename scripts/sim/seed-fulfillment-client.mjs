#!/usr/bin/env node
// scripts/sim/seed-fulfillment-client.mjs — stand ONE client up at "they already
// paid", so the walk is fulfilment only and the whole sales funnel is skipped.
//
//   DATABASE_URL=… PII_ENC_KEY=… FANBASIS_CHECKOUT_API_KEY=… \
//     node scripts/sim/seed-fulfillment-client.mjs \
//       --profile funding|repair-full|repair-trial \
//       --email you+walk-01@example.com --first <first> --last <last> \
//       --phone 5555550147 [--confirm]
//
// Three environment values, and it refuses without any of them rather than
// writing half a record: DATABASE_URL, PII_ENC_KEY (the SSN is never stored any
// other way) and a checkout key — FANBASIS_CHECKOUT_API_KEY, or the older
// COMMAS_CHECKOUT_BASE_URL — because the last thing it does is mint a pay link.
// BOTH PII_ENC_KEY and FANBASIS_CHECKOUT_API_KEY are stored on Netlify with
// --secret, so `netlify env:get` hands back asterisks for either one; export the
// real values by hand. Both are mask-checked below, before the first write.
//
// WHAT IT IS FOR. Chris hand-walks three clients through delivery only — one
// buying funding, one buying the full six-round repair, one buying the $200 two
// round trial — with the employee screens open next to the customer portal, to
// see whether the two agree and to test document collection. Nothing here sells
// anything, books anything, or charges anyone. It writes the record a client
// would already have by the time the fulfilment desks pick them up.
//
// IT DOES NOT PAY. It ends by minting ONE OPEN pay link of the right product,
// because push-payment.mjs refuses to post a receipt unless an open link for
// that client already exists, and the only product control that mints one is the
// closer deck's Send pay link button. The receipt itself is still push-payment's
// job — run it after push-credit, see THE ORDER below.
//
// Run it twice and it does NOT mint a second link. Once the receipt has landed,
// that product is paid for, and a second live checkout URL is a second real
// charge waiting to happen. It says so and skips it.
//
// It also refuses, before writing anything, if the email you typed already
// belongs to somebody — that would edit a real client's record in place — and if
// this person previously WITHDREW a consent it needs.
//
// ── THE ORDER. GET THIS WRONG AND NOTHING SAYS SO ────────────────────────────
//   1. this script      — client, identity, consent, state, open pay link
//   2. push-credit.mjs  — the credit file, which is what STAMPS outcome_tier
//   3. push-payment.mjs — the receipt, which is what starts fulfilment
//
// Pay before the credit file is in and the money lands on a board that looks
// right while nothing else runs: F-01 (funding intake), S-06 and C-06 all read
// clients.outcome_tier, find nothing, and return quietly. There is no error, no
// red screen, and no way to tell from the outside. That is why this script sets
// outcome_tier itself, up front, before any money is posted — a belt to
// push-credit's braces. push-credit overwrites it with whatever the REAL tier
// engine decides, which is correct and expected; what matters is that the column
// is never empty at the moment a payment arrives.
//
// ── DRY RUN BY DEFAULT ───────────────────────────────────────────────────────
// The other two sim tools write unless you pass --dry. This one is the other way
// round on purpose: they act on a client that already exists, and this one
// CREATES a person, a login, and a stored Social Security number. It prints
// every row it would write, table by table, and does nothing at all without
// --confirm.
//
// ── THE REAL IDENTITY ────────────────────────────────────────────────────────
// The Social Security number and date of birth are Chris's own, because the
// identity gates on this walk are real and must actually pass. They are read at
// run time from credentials/sim-identity/owner-identity.local.json, which is
// gitignored, and they are NEVER written into this file, a test, a comment or a
// log line. The most this prints is the last four digits.
//
// ── WHAT IT DELIBERATELY DOES NOT SET ────────────────────────────────────────
// custom_fields.synthetic and is_demo stay OFF. Between them they remove both
// halves of this walk: synthetic makes the system refuse to send the texts, and
// is_demo hides the client from the employee screens. Watching the texts arrive
// and the card appear is the whole reason the walk exists.
//
// It does not CLEAR them either. If the email you gave was used on an earlier
// sim run, the record may already be carrying one, and then nothing sends and
// nothing appears — with no error anywhere. So it reads both back and says so,
// loudly, before you type --confirm. Same for an existing client's "do not
// text me" flags: this script reports them and leaves them exactly as they are,
// because turning somebody's do-not-disturb back off is a decision about a
// person. A client it creates from scratch is created able to be texted.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, close } from "../../src/db.mjs";
import { resolveDefaultOrg } from "../../src/auth/org.mjs";
import { withTransaction } from "../../src/db/with-transaction.mjs";
import { storeIdentity } from "../../src/pii/index.mjs";
import { captureConsent, consentStatus } from "../../src/consent/index.mjs";
import { createPaymentLink } from "../../src/payment-links/index.mjs";
import { checkoutConfig, CHECKOUT_API_KEY_ENV } from "../../src/payments/commas-api.mjs";
import { getOffer, formatCents } from "../../src/config/offers.mjs";
import {
  CURRENT_SOFT_PULL_VERSION,
  SOFT_PULL_DISCLOSURES,
  CURRENT_DISPUTE_AUTH_VERSION,
  DISPUTE_AUTH_DISCLOSURES
} from "../../src/consent/disclosures.mjs";
import { hashPassword } from "../../src/auth/hash.mjs";
import { newToken } from "../../src/auth/session.mjs";
import { isFundingPath } from "../../src/config/product-path.mjs";

const SOFT_PULL_KIND = "soft_pull_consent";
const DISPUTE_AUTH_KIND = "dispute_authorization";

/* The three ways in. `offerKey` is the catalogue entry (src/config/offers.mjs),
   which owns the price, the products.code and the pay-link purpose — none of
   those numbers are retyped here, so a price change in the catalogue moves this
   script with it.

   `outcomeTier` is the tier this client must be carrying BEFORE money arrives.
   `tierAlreadyRight` is what makes a re-run safe: once push-credit has stamped
   the real engine result, that result is usually a DIFFERENT string on the same
   side of the line (PREMIUM_STACK rather than FULL_FUNDING, say), and clobbering
   it back would throw away the real answer. So the test is which side of the
   line the tier is on, not which exact word it is.

   `creditProfile` is the push-credit profile that goes with this path, and it is
   printed verbatim into the command Chris pastes at the end of this script. It
   is live routing, not a note: whatever string is written here is the credit
   file he ends up walking.

   ONE PROFILE PER PATH. There are three walks and there are now three credit
   files, one shaped for each:

     funding       → `fundable`      clean, high scores, funding tier
     repair-full   → `repair-full`   two collections, a charge-off, a late
     repair-trial  → `repair-trial`  one collection, a charge-off, lighter

   This line used to read `repair` on BOTH repair paths, which resolves through
   push-credit's PROFILE_ALIASES to `repair-full`. So the $200 trial walk — the
   whole point of which is lighter damage and a shorter letter run — was handed
   the six-round file, and nothing said so. The old note argued that more bad
   items meant more for Chris to look at; that is the full programme's job. The
   trial walk exists to show what the smaller package looks like, and it cannot
   do that on the big file.

   MEASURED 2026-09-05 by running the real tier engine over each built payload
   (no database): `fundable` comes out PREMIUM_STACK, `repair-full` and
   `repair-trial` both come out REPAIR_ONLY. Both repair files therefore satisfy
   the repair gate below. The older note in this spot recorded FULL_FUNDING for
   the clean file and named profiles (`funding`, `blueprint`, `academy`) that are
   now only aliases — both were true before the 2026-09-05 rebuild of the
   profiles and are not any more.

   `needsDisputeAuth` is the one that decides whether letters happen at all. The
   letter engine has TWO gates and they are not the same gate. The first asks
   "may we prepare letters for this person?" and answers yes only for a SIGNED
   repair agreement or a live `dispute_authorization` consent — a soft-pull
   consent does not count. Miss it and analyzeAndGenerate returns
   `no_authorization`, writes nothing, and says nothing: the money still lands,
   the card still appears on the Specialist desk, the portal still looks right,
   and the letters simply never exist. The second gate ("is this client on the
   repair path?") is the one outcome_tier answers, and REPAIR_ONLY satisfies it.
   So both repair paths capture the dispute authorization here, in Chris's own
   name, because on this walk Chris IS the client whose file is being worked.
   The funding path does not — nobody is disputing anything for them. */
const PROFILES = Object.freeze({
  funding: {
    note: "Bought funding. Deposit paid, funding desk picks them up.",
    offerKey: "FUNDING_DFY",
    outcomeTier: "FULL_FUNDING",
    tierAlreadyRight: (tier) => isFundingPath(tier),
    creditProfile: "fundable",
    needsDisputeAuth: false
  },
  "repair-full": {
    note: "Bought the full six-round credit repair. Specialist desk picks them up.",
    offerKey: "REPAIR_DFY",
    outcomeTier: "REPAIR_ONLY",
    tierAlreadyRight: (tier) => String(tier) === "REPAIR_ONLY",
    creditProfile: "repair-full",
    needsDisputeAuth: true
  },
  "repair-trial": {
    /* The $200 test run. How many rounds it buys is NOT settled in this repo —
       migration 181 records the owner saying one round, and nothing in the
       schema counts rounds either way — so this line does not claim a number. */
    note: "Bought the $200 repair test run. Same desk as the full programme, smaller package.",
    offerKey: "REPAIR_TRIAL",
    outcomeTier: "REPAIR_ONLY",
    tierAlreadyRight: (tier) => String(tier) === "REPAIR_ONLY",
    creditProfile: "repair-trial",
    needsDisputeAuth: true
  }
});

const DEFAULT_IDENTITY_FILE = "credentials/sim-identity/owner-identity.local.json";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}

/* looksMasked — is this value Netlify's redaction rather than the key itself?
   Same guard, and the same reason, as push-payment.mjs. A var stored with
   --secret comes back from `netlify env:get` as a short run of asterisks.
   PII_ENC_KEY is one of those. Handing the mask to the encrypter produces a
   "must be 32 bytes base64" complaint that reads like a broken key rather than
   an unread one, and that cost an afternoon once already (F26). */
export function looksMasked(value) {
  const v = String(value || "");
  return (v.match(/\*/g) || []).length >= 4;
}

/* E.164-ish, so the number on the record is one Twilio can actually dial. Same
   shape as normalizePhone() in src/messaging/providers/bland-voice.mjs, written
   out here rather than imported: that module is the voice provider and can place
   calls, and a seeding script has no business importing a dialer. */
export function toE164(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const digits = s.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits.length >= 8 ? digits : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/* readIdentityFile — the real SSN, date of birth and home address, off disk.
 *
 * NOTHING IS DEFAULTED AND NOTHING IS GUESSED. A missing or malformed field
 * stops the run, because the whole point of this walk is that the identity gates
 * are satisfied by a real identity; a half-filled one would pass the schema and
 * fail the gate later, on a call, with Chris watching.
 *
 * SIM_IDENTITY_FILE overrides the path so the values can live somewhere else
 * entirely on a machine that keeps them elsewhere. */
export function readIdentityFile(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `no identity file at ${file} — it holds the real SSN and date of birth and is gitignored, ` +
      `so it never arrives with a clone. Point --identity or SIM_IDENTITY_FILE at it.`
    );
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${file} is not readable JSON: ${e.message}`);
  }

  const ssn = String(json.ssn ?? "").replace(/\D/g, "");
  if (ssn.length !== 9) throw new Error(`${file}: "ssn" must be 9 digits`);

  const dob = String(json.dob ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) throw new Error(`${file}: "dob" must be YYYY-MM-DD`);

  const addr = json.current_address && typeof json.current_address === "object" ? json.current_address : {};
  const line1 = String(addr.line1 ?? "").trim();
  const city = String(addr.city ?? "").trim();
  const state = String(addr.state ?? "").trim().toUpperCase();
  const postalCode = String(addr.postal_code ?? "").trim();
  /* The state is required and is NEVER filled in for you. It is the one address
     field the lender screen actually decides on: src/lenders/match.mjs keeps a
     lender when the client's state is empty (an unknown state is treated as "do
     not invent a block"), and drops the ones that do not serve the state when it
     is set. So a state guessed here does not produce a blank screen Chris would
     notice — it produces a confident, wrong list of lenders that looks exactly
     like a right one. An empty state stops the run instead, the same as a
     missing street or a missing ZIP. */
  if (!line1 || !city || !state || !postalCode) {
    throw new Error(`${file}: "current_address" needs line1, city, state and postal_code`);
  }
  if (!/^[A-Z]{2}$/.test(state)) throw new Error(`${file}: "current_address.state" must be two letters`);

  const legalName = [json.legal_first_name, json.legal_last_name]
    .map((v) => String(v ?? "").trim()).filter(Boolean).join(" ");
  if (legalName.length < 2) throw new Error(`${file}: needs legal_first_name and legal_last_name`);

  return { ssn, dob, legalName, address: { line1, city, state, postalCode } };
}

/* ensureClientAccount — the portal login the consent row has to point at.
 *
 * client_consents refuses a client-granted consent that names no account
 * (099's client_consents_granter_ck), and it is right to: a consent nobody can
 * be identified as having given is not evidence of anything. This mirrors
 * provisionClientAccount() in api/soft-pull-approve.mjs — same table, same
 * columns, same throwaway password — copied rather than imported because that
 * one is a private helper inside an HTTP handler.
 *
 * The password is 32 random bytes nobody keeps, including us. Chris signs in
 * with scripts/sim/set-client-password.mjs afterwards. */
async function ensureClientAccount(db, { orgId, clientId, email, name }) {
  const existing = await db.query(
    `SELECT id FROM accounts WHERE client_id = $1 AND kind = 'client' ORDER BY created_at LIMIT 1`,
    [clientId]
  );
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };

  await db.query(
    `INSERT INTO accounts (org_id, kind, email, name, password_hash, status, client_id, activated_at)
     VALUES ($1,'client',$2,$3,$4,'active',$5, now())
     ON CONFLICT DO NOTHING`,
    [orgId, email, name || null, await hashPassword(newToken()), clientId]
  );

  const again = await db.query(
    `SELECT id FROM accounts WHERE client_id = $1 AND kind = 'client' ORDER BY created_at LIMIT 1`,
    [clientId]
  );
  if (!again.rows[0]) throw new Error("could not open a portal login to attribute the consent to");
  return { id: again.rows[0].id, created: true };
}

function money(cents) {
  return formatCents(cents) || `$${(Number(cents) / 100).toFixed(2)}`;
}

/* mergeAddresses — keep every address already on file, and put ours at the front.

   storeIdentity protects the SSN and the date of birth with COALESCE, but writes
   the address list with a bare `addresses = EXCLUDED.addresses` — the whole array
   is replaced. Passing one address therefore ERASES a person's address history,
   silently. Measured 2026-09-05 on a scratch database: a client with two
   addresses came back with one, and the plan line said only "one home address",
   which reads like "storing one", not "deleting the others".

   That history is used, not decoration. The credit pull sends every entry to the
   bureau (src/finance/crs-client.mjs:301) and the letter pack builds its address
   list from all of them (src/underwrite/letter-pack.mjs:173). On a NEW sim client
   there is nothing to lose, but this script can be pointed at an existing record
   with --allow-existing, and that record may belong to a real person. */
async function mergeAddresses(tx, clientId, ours) {
  const res = await tx.query(
    "SELECT addresses FROM pii_identity WHERE client_id = $1",
    [clientId]
  );
  const existing = Array.isArray(res.rows[0]?.addresses) ? res.rows[0].addresses : [];
  // Same street and same ZIP is the same address, however the keys are spelled.
  const key = (a) => [
    String(a?.addressLine1 ?? a?.address_line1 ?? "").trim().toLowerCase(),
    String(a?.postalCode ?? a?.zip ?? a?.postal_code ?? "").trim()
  ].join("|");
  const mine = key(ours);
  return [ours, ...existing.filter((a) => key(a) !== mine)];
}

async function main() {
  const profileKey = String(arg("profile", "")).trim();
  const email = String(arg("email", "")).trim().toLowerCase();
  const first = String(arg("first", "")).trim();
  const last = String(arg("last", "")).trim();
  const phoneRaw = String(arg("phone", "")).trim();
  const confirm = process.argv.includes("--confirm");
  /* --allow-existing: yes, I know this email already belongs to somebody, and I
     mean to overwrite their name, phone and tier. See the refusal below. */
  const allowExisting = process.argv.includes("--allow-existing");
  const identityFile = path.resolve(
    arg("identity", process.env.SIM_IDENTITY_FILE || DEFAULT_IDENTITY_FILE)
  );

  const profile = PROFILES[profileKey];
  if (!profile || !email || !first || !last || !phoneRaw) {
    console.error(
      "usage: node scripts/sim/seed-fulfillment-client.mjs --profile funding|repair-full|repair-trial \\\n" +
      "         --email <email> --first <first name> --last <last name> --phone <phone> \\\n" +
      "         [--identity <path>] [--allow-existing] [--confirm]\n" +
      "\n" +
      "  Prints what it would write and changes NOTHING unless --confirm is given."
    );
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(2); }

  /* PII_ENC_KEY has to be real BEFORE anything is written. Without it
     storeIdentity returns 503 and refuses to store the SSN in the clear — which
     is correct, but it would happen halfway through, after the client row
     existed. Checked here so the run stops before it starts. */
  const encKey = String(process.env.PII_ENC_KEY || "");
  if (!encKey) {
    console.error("PII_ENC_KEY is not set — the SSN cannot be encrypted, and it is never stored any other way.");
    process.exit(2);
  }
  if (looksMasked(encKey)) {
    console.error("PII_ENC_KEY came back MASKED (mostly asterisks) — that is Netlify's redaction, not the key.");
    console.error("Export the real value by hand, then run again.");
    process.exit(2);
  }
  if (Buffer.from(encKey, "base64").length !== 32) {
    console.error("PII_ENC_KEY is not 32 bytes of base64 — the SSN cannot be encrypted with it.");
    process.exit(2);
  }

  /* Same trap, second key. The checkout key is stored with --secret too, so
     `netlify env:get` hands back asterisks for it exactly the way it does for
     PII_ENC_KEY — and the usage block at the top of this file tells you to fetch
     it that way. A mask is a non-empty string, so the "is a checkout
     configured?" check further down says yes, the plan prints, the client, the
     login, the encrypted SSN and the consent all COMMIT, and only then does
     minting the pay link fail with "checkout_unreachable: fetch failed" — which
     names neither the cause nor the four rows already written, and leaves a
     client push-payment will refuse to pay because it has no open link.
     Caught here, where the answer is still "nothing has been written". */
  const checkoutKey = String(process.env[CHECKOUT_API_KEY_ENV] || "");
  if (checkoutKey && looksMasked(checkoutKey)) {
    console.error(`${CHECKOUT_API_KEY_ENV} came back MASKED (mostly asterisks) — that is Netlify's redaction, not the key.`);
    console.error("Export the real value by hand, then run again.");
    process.exit(2);
  }

  const phone = toE164(phoneRaw);
  if (!phone) {
    console.error(`--phone ${phoneRaw} is not a number that can be dialled or texted. Give 10 digits, or +country digits.`);
    process.exit(2);
  }

  const identity = readIdentityFile(identityFile);
  const offer = getOffer(profile.offerKey);
  if (!offer) { console.error(`offer ${profile.offerKey} is not in the catalogue`); process.exit(1); }
  /* Every consent this path needs on file, in the order it gets captured. The
     words are always the server's own approved disclosure, never anything typed
     here: a caller that writes its own consent text is a caller with no consent.
     `why` is what breaks if it is missing — it prints in the plan so the reason
     for each row is visible before --confirm. */
  const requiredConsents = [
    {
      kind: SOFT_PULL_KIND,
      version: CURRENT_SOFT_PULL_VERSION,
      text: SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text,
      why: "without it the credit pull cannot run",
      status: { valid: false, reason: "none_on_file" }
    }
  ];
  if (profile.needsDisputeAuth) {
    requiredConsents.push({
      kind: DISPUTE_AUTH_KIND,
      version: CURRENT_DISPUTE_AUTH_VERSION,
      text: DISPUTE_AUTH_DISCLOSURES[CURRENT_DISPUTE_AUTH_VERSION].text,
      why: "without it the letter run returns no_authorization and writes NO letters, silently",
      status: { valid: false, reason: "none_on_file" }
    });
  }

  const db = pool();
  const orgId = await resolveDefaultOrg(db);

  const product = (await db.query(
    `SELECT id, code, name, category FROM products WHERE org_id = $1 AND lower(code) = lower($2) LIMIT 1`,
    [orgId, offer.productCode]
  )).rows[0];
  if (!product) {
    console.error(`product ${offer.productCode} is not in this company's catalogue — run the migrations first`);
    process.exit(1);
  }

  // ── What is already there ──────────────────────────────────────────────────
  /* The contact flags and is_demo are read, not just written. On an existing
     client this script leaves both alone (see the UPDATE), so the only way Chris
     finds out that this record cannot be texted is if the plan says so. */
  const client = (await db.query(
    `SELECT id, first_name, last_name, phone, outcome_tier, custom_fields,
            consent_sms, dnd_sms, dnd_email, dnd_voice, is_demo
       FROM clients WHERE org_id = $1 AND lower(email) = $2 ORDER BY created_at DESC LIMIT 1`,
    [orgId, email]
  )).rows[0] || null;

  let account = null;
  let identityRow = null;
  let matchingLink = null;
  let paidLink = null;
  let otherOpenLinks = [];
  if (client) {
    account = (await db.query(
      `SELECT id, status FROM accounts WHERE client_id = $1 AND kind = 'client' ORDER BY created_at LIMIT 1`,
      [client.id]
    )).rows[0] || null;
    identityRow = (await db.query(
      `SELECT id, dob IS NOT NULL AS has_dob, ssn_enc IS NOT NULL AS has_ssn
         FROM pii_identity WHERE client_id = $1`,
      [client.id]
    )).rows[0] || null;
    for (const c of requiredConsents) {
      c.status = await consentStatus(db, { orgId, clientId: client.id, kind: c.kind });
    }
    /* 'paid' is in this list on purpose, and it is the difference between a safe
       re-run and a real one. Posting the receipt flips the link to 'paid', so a
       lookup that only asked for open links found nothing on the second run and
       minted a SECOND live, payable checkout for the same product — a real $3,000
       or $1,000 URL. push-payment then takes the newest open link when no --ref
       is given, and the client is recorded as having paid twice on one sale.
       Minting a payable URL is the one step in this script that cannot be undone,
       so a product that is already paid for gets no second link. */
    const links = (await db.query(
      `SELECT pl.id, pl.link_ref, pl.purpose, pl.amount_cents, pl.status, pl.product_id,
              pl.paid_at, p.code AS product_code
         FROM payment_links pl LEFT JOIN products p ON p.id = pl.product_id
        WHERE pl.org_id = $1 AND pl.client_id = $2 AND pl.status IN ('created','sent','paid')
        ORDER BY pl.created_at DESC`,
      [orgId, client.id]
    )).rows;
    const forThisProduct = links.filter((l) => String(l.product_id) === String(product.id));
    matchingLink = forThisProduct.find((l) => l.status !== "paid") || null;
    paidLink = forThisProduct.find((l) => l.status === "paid") || null;
    otherOpenLinks = links.filter((l) => l.status !== "paid" && String(l.product_id) !== String(product.id));
  }

  const tierIsAlreadyRight = client ? profile.tierAlreadyRight(client.outcome_tier) : false;
  const cf = (client?.custom_fields && typeof client.custom_fields === "object") ? client.custom_fields : {};

  /* The two markers that quietly turn this walk into nothing. They do DIFFERENT
     damage and it is worth keeping them apart:
       * `custom_fields.synthetic` is the one that stops the texts.
         src/messaging/live-fence.mjs refuses the send on it (line 87/141).
       * `clients.is_demo` is the one that hides the person. The dashboards and
         read endpoints filter demo rows out through src/demo/exclude-demo.mjs
         (db/migrations/094), so the card never reaches the desk. It does not
         touch the messaging path.
     An email reused from an earlier sim run can be carrying either, and between
     them they remove the exact two things Chris is sitting there to watch.

     The two readers in the codebase do not agree on what the marker looks like:
     live-fence wants the boolean `true` and nothing else, while the inquiry call
     scheduler reads it as text (`custom_fields->>'synthetic' = 'true'`), which
     also matches the string. So this reports on either spelling — a record that
     trips only one of them is still a record that behaves oddly, and Chris
     should be told.

     NOTHING IS CLEARED HERE. On a live database this row may be a real person
     somebody marked on purpose, and un-hiding a client is not a seeding script's
     call to make. It says so, loudly, and leaves the decision with Chris. */
  const syntheticStrict = cf.synthetic === true;
  const syntheticLoose = syntheticStrict || String(cf.synthetic ?? "") === "true";
  const isDemo = !!client?.is_demo;
  const flaggedFromAnEarlierRun = !!client && (isDemo || syntheticLoose);
  /* The contact preferences on the client row. BE PRECISE ABOUT THESE: they do
     NOT stop a send. `opt_outs` is the authoritative opt-out store — 008 says so
     in as many words, and clients.dnd_* is called a mirror field there — and
     this script never touches `opt_outs`. What the three dnd flags DO reach is
     src/agents/context.mjs, which reads them straight into the picture the AI
     agent has of this person. So a record carrying them is a record where the
     agent thinks it has been asked to back off, whatever the sending code does. */
  const contactFlagsSayLeaveAlone = !!client && (!client.consent_sms || client.dnd_sms || client.dnd_email || client.dnd_voice);
  const yn = (v) => (v === null || v === undefined ? "(not set)" : v ? "true" : "false");

  // ── The plan, table by table ───────────────────────────────────────────────
  const name = [first, last].filter(Boolean).join(" ");
  console.log("");
  console.log(`profile   ${profileKey} — ${profile.note}`);
  console.log(`buys      ${offer.name} · ${money(offer.priceCents)} · product ${product.code} (${product.category})`);
  console.log(`identity  ${identityFile} — SSN ending ${identity.ssn.slice(-4)}, date of birth on file, home address on file`);
  console.log(`company   ${orgId}`);
  console.log("");

  /* Only ONE row can ever match this email — clients_org_email_uniq is unique
     per company on lower(email) — so an existing match is not "a similar
     client", it is THE person who owns that address, and the update below
     replaces their name, their phone and their tier in place. On a live
     database that could be a real paying customer, and a typo is enough. Print
     who they are today, next to what they would become, before anything is
     written. The refusal is further down. */
  if (client) {
    console.log("ALREADY ON FILE — this email belongs to a client who exists right now:");
    console.log(`  today    ${client.first_name || "(no first name)"} ${client.last_name || ""}`.trimEnd() +
      ` · ${client.phone || "(no phone)"} · outcome_tier ${client.outcome_tier || "(none)"}`);
    console.log(`  becomes  ${name} · ${phone} · outcome_tier ${tierIsAlreadyRight ? client.outcome_tier : profile.outcomeTier}`);
    console.log("  If that is not the person you meant, stop here — the email is the only thing matched on.");
    console.log("");
  }

  console.log("WOULD WRITE");
  console.log(`  clients          ${client ? `UPDATE ${client.id}` : "INSERT"} — ${name} <${email}> ${phone}`);
  console.log(`                   outcome_tier ${tierIsAlreadyRight
    ? `left as ${client.outcome_tier} (already on the right side of the line)`
    : `${client?.outcome_tier ? `${client.outcome_tier} -> ` : ""}${profile.outcomeTier}`}`);
  console.log(`                   custom_fields home_state=${identity.address.state} business_state=${identity.address.state}` +
    `${cf.home_state ? ` (was ${cf.home_state})` : ""}`);
  if (client) {
    /* An existing person's contact preferences are theirs. This run does not
       flip them on — it reads them back, so a record that is going to behave
       oddly on the walk is visible before --confirm rather than after an hour
       of watching a screen and wondering. */
    console.log(`                   contact flags LEFT AS THEY ARE — consent_sms ${yn(client.consent_sms)} ·` +
      ` dnd_sms ${yn(client.dnd_sms)} · dnd_email ${yn(client.dnd_email)} · dnd_voice ${yn(client.dnd_voice)}`);
    console.log(`                   (a brand new client is created able to be texted; an existing one keeps what they have)`);
    console.log(`                   test markers on this record — is_demo ${yn(client.is_demo)} · custom_fields.synthetic ${cf.synthetic === undefined ? "(not set)" : JSON.stringify(cf.synthetic)}`);
  } else {
    console.log(`                   consent_sms true · dnd_sms/email/voice false — Chris is testing the texts`);
    console.log(`                   NOT set: synthetic, is_demo. Either one would silence the texts and hide the card.`);
  }
  console.log(`  accounts         ${account ? `keep ${account.id} (${account.status})` : "INSERT a client login, random password nobody keeps"}`);
  console.log(`  pii_identity     ${identityRow ? "UPDATE" : "INSERT"} — SSN encrypted, date of birth, one home address`);
  for (const c of requiredConsents) {
    let line;
    if (c.status.valid) line = `keep the live ${c.kind} already on file`;
    else if (c.status.reason === "revoked") line = `${c.kind} was WITHDRAWN by this person — see the refusal below`;
    else if (c.status.reason === "expired") line = `INSERT ${c.kind} ${c.version}, typed — the one on file EXPIRED · ${c.why}`;
    else if (c.status.reason === "not_yet_effective") line = `INSERT ${c.kind} ${c.version}, typed — the one on file is not effective yet · ${c.why}`;
    else line = `INSERT ${c.kind} ${c.version}, typed, granted by the client's own login · ${c.why}`;
    console.log(`  client_consents  ${line}`);
  }
  console.log(`  payment_links    ${matchingLink
    ? `keep the open ${matchingLink.product_code} link ${matchingLink.link_ref} (${matchingLink.status})`
    : paidLink
      ? `NOTHING — ${offer.name} is ALREADY PAID on ${paidLink.link_ref}. No second live checkout is minted.`
      : `INSERT one OPEN ${offer.paymentPurpose} link for ${money(offer.priceCents)} — push-payment refuses without it`}`);
  if (otherOpenLinks.length) {
    console.log("");
    console.log(`  heads up — ${otherOpenLinks.length} other open pay link(s) on this client: ` +
      otherOpenLinks.map((l) => `${l.product_code || l.purpose} ${l.link_ref}`).join(", "));
    console.log("  push-payment takes the NEWEST open link when no --ref is given, so use the --ref printed below.");
  }
  console.log("");

  /* Said as loudly as a terminal allows, because both of these fail QUIETLY.
     Nothing errors, no screen turns red — the texts simply never arrive and the
     card simply never appears, and the natural reading of that is "the feature
     is broken", which is the wrong conclusion and an expensive one. */
  if (flaggedFromAnEarlierRun) {
    console.log(`!! THIS RECORD IS FLAGGED AS A TEST ROW — ${syntheticLoose && isDemo
      ? "THE TEXTS WILL NOT SEND AND THE CARD IS HIDDEN"
      : syntheticLoose ? "THE TEXTS WILL NOT SEND" : "THE CARD IS HIDDEN FROM THE DESKS"} !!`);
    if (isDemo) {
      console.log("   clients.is_demo is true. The client is hidden from the employee lists, so the card");
      console.log("   you are waiting to see on the desk will not appear there at all.");
    }
    if (syntheticLoose) {
      console.log(`   custom_fields.synthetic is ${JSON.stringify(cf.synthetic)}. Outbound messages are refused for this`);
      console.log("   client before they are ever handed to a phone network.");
      if (!syntheticStrict) {
        console.log("   (it is the STRING, not the true/false value — the message fence ignores it but the");
        console.log("    inquiry call scheduler does not, so this record behaves inconsistently either way.)");
      }
    }
    console.log("   This script does NOT clear either one — on a live database that row might be marked");
    console.log("   on purpose, and un-hiding somebody is your call, not a seeding script's.");
    console.log("   Either clear it by hand first, or use a fresh --email for this walk.");
    console.log("");
  }
  if (contactFlagsSayLeaveAlone) {
    console.log("!! THIS CLIENT IS MARKED 'LEAVE ME ALONE' — AND THIS RUN LEAVES THAT MARK ALONE TOO !!");
    console.log(`   consent_sms ${yn(client.consent_sms)} · dnd_sms ${yn(client.dnd_sms)} · dnd_email ${yn(client.dnd_email)} · dnd_voice ${yn(client.dnd_voice)}`);
    console.log("   These flags do not by themselves stop a message going out — a real opt-out lives in a");
    console.log("   separate table this script never touches. What they DO change is the AI agent: it reads");
    console.log("   them and believes this person asked to be left alone, so it will behave that way on the walk.");
    console.log("   Turning somebody's do-not-disturb back off is a decision about a person, not a seed value,");
    console.log("   so it is not done here. Clear them by hand, or use a fresh --email.");
    console.log("");
  }

  /* Everything below refuses BEFORE the first row is written. Three ways this
     run can be the wrong run, and all three are cheap to say no to now and
     expensive to discover afterwards. */
  if (client && !allowExisting) {
    console.log("REFUSING — that email is already somebody's, and this run would edit their record in place.");
    console.log("Read the two lines under ALREADY ON FILE above. If that really is the person you mean,");
    console.log("run it again with --allow-existing. If it is a typo, change --email.");
    await close();
    process.exit(1);
  }

  /* A consent that was WITHDRAWN is not a gap to be filled in. The person took
     permission back, and re-granting it is their decision, not a seeding
     script's. Expired is different — that is a lapse, and re-capturing is the
     normal answer — so only revoked stops the run. */
  const withdrawn = requiredConsents.filter((c) => c.status.reason === "revoked");
  if (withdrawn.length) {
    console.log(`REFUSING — this person WITHDREW ${withdrawn.map((c) => c.kind).join(" and ")}.`);
    console.log("Taking permission back is something they did on purpose. A script does not undo it.");
    console.log("If they have since agreed again, capture it the way the product does — in the portal, by them.");
    await close();
    process.exit(1);
  }

  /* The checkout has to be reachable BEFORE the first row is written. Minting
     the link is the last step and the only one that leaves the building, so a
     missing checkout key would otherwise be discovered after the client, the
     login and the stored SSN already existed — a half-built record and a
     confusing error. Checked here, where the answer is still "run nothing".
     A MASKED key gets past this check because a mask is a non-empty string;
     that is why it is caught up top, next to PII_ENC_KEY. */
  const checkoutReady = checkoutConfig(process.env).ok
    || !!String(process.env.COMMAS_CHECKOUT_BASE_URL || "").trim();
  if (!matchingLink && !paidLink && !checkoutReady) {
    console.log("REFUSING — no checkout is configured, so no pay link can be minted.");
    console.log("Set FANBASIS_CHECKOUT_API_KEY (or COMMAS_CHECKOUT_BASE_URL) and run again.");
    console.log("Without an open pay link, push-payment.mjs has nothing to post a receipt against.");
    await close();
    process.exit(1);
  }

  if (!confirm) {
    console.log("dry run — nothing written. Add --confirm to write it.");
    await close();
    return;
  }

  // ── The write ──────────────────────────────────────────────────────────────
  /* One transaction for everything the schema lets us hold together. The pay
     link is the exception and it is deliberately LAST: createPaymentLink calls
     out to the checkout provider to mint a real URL, and a rollback cannot
     un-mint that. Doing it last means a failure anywhere else never leaves a
     stray checkout behind, and a stray checkout that nobody is ever sent costs
     nothing. */
  const written = await withTransaction(db, async (tx) => {
    let clientId = client?.id || null;
    if (clientId) {
      /* consent_sms and the three do-not-disturb flags are NOT in this UPDATE,
         and that is the point. A brand new client is created able to receive the
         texts (see the INSERT below), which is fine — nobody has said otherwise
         about a person who did not exist a second ago. An existing person has
         said something, and turning "do not text me" back off is a decision
         about a human being, not a seed value.

         It would not have bypassed a real opt-out — `opt_outs` is the record
         that actually decides, and this script never touches it — but
         src/agents/context.mjs reads these three flags straight into what the AI
         agent believes about the person, so overwriting them handed the agent a
         false picture of somebody who had asked to be left alone. The plan above
         prints what they currently say instead. */
      await tx.query(
        `UPDATE clients
            SET first_name = $2, last_name = $3, phone = $4,
                outcome_tier = $5,
                custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $6::jsonb
          WHERE id = $1`,
        [
          clientId, first, last, phone,
          tierIsAlreadyRight ? client.outcome_tier : profile.outcomeTier,
          JSON.stringify({ home_state: identity.address.state, business_state: identity.address.state })
        ]
      );
    } else {
      clientId = (await tx.query(
        `INSERT INTO clients (org_id, first_name, last_name, email, phone, outcome_tier,
                              custom_fields, consent_sms, dnd_sms, dnd_email, dnd_voice)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,true,false,false,false)
         RETURNING id`,
        [
          orgId, first, last, email, phone, profile.outcomeTier,
          JSON.stringify({ home_state: identity.address.state, business_state: identity.address.state })
        ]
      )).rows[0].id;
    }

    const acct = await ensureClientAccount(tx, { orgId, clientId, email, name });

    await storeIdentity(tx, {
      orgId,
      clientId,
      ssn: identity.ssn,
      dob: identity.dob,
      /* The same address shape api/soft-pull-approve.mjs writes. resolveHomeState
         reads this list when the person fields are empty, so the home state
         survives even if somebody clears the custom field.

         THE ZIP IS WRITTEN TWICE, UNDER TWO NAMES, AND BOTH ARE NEEDED. The
         credit pull, the tier engine and the letter pack read `postalCode`. The
         code that builds the client's RETURN ADDRESS on a mailed dispute letter
         reads address_zip, zip, zip5 or postal — and `postalCode` is not one of
         them, so the letter goes out reading "Phoenix, AZ" with no ZIP and
         nothing anywhere reports it. Adding `zip` here makes both readers happy.
         The tidier one-word fix is in the shared reader, but that is a
         compliance path used by real clients and belongs to its own change. */
      addresses: await mergeAddresses(tx, clientId, {
        addressLine1: identity.address.line1,
        city: identity.address.city,
        state: identity.address.state,
        postalCode: identity.address.postalCode,
        zip: identity.address.postalCode
      }),
      env: process.env
    });

    /* captureConsent is deliberately NOT idempotent — two consents a minute
       apart are two things a person did. So the duplicate check happens here,
       before the call, rather than being asked of a module that is right to
       refuse to collapse them. */
    const consents = [];
    for (const c of requiredConsents) {
      if (c.status.valid) continue;
      const row = await captureConsent(tx, {
        orgId,
        clientId,
        kind: c.kind,
        /* The server's own approved words, never anything typed here. Same rule
           the live endpoint follows: a caller that chooses its own consent text
           is a caller with no consent. */
        consentText: c.text,
        consentVersion: c.version,
        captureMethod: "typed",
        grantedName: identity.legalName,
        grantedBy: { kind: "client", id: acct.id }
      });
      consents.push({ kind: c.kind, id: row.id });
    }

    return { clientId, accountId: acct.id, accountCreated: acct.created, consents };
  });

  /* paidLink short-circuits this. A product that has already been paid for does
     not get a second payable URL — see the lookup above. */
  let link = matchingLink;
  if (!link && !paidLink) {
    link = await createPaymentLink(db, {
      orgId,
      clientId: written.clientId,
      purpose: offer.paymentPurpose,
      description: offer.name,
      commasProductTitle: offer.commasProductTitle,
      amountCents: offer.priceCents,
      /* The product code is the whole reason this link exists. A repair card only
         reaches the Specialist desk when an ACTIVE sale joins a repair-category
         product, and that sale is only created because the receipt arrives
         carrying a link whose product_id is the repair product. A link with no
         product identity pays money into nothing. */
      productCode: offer.productCode,
      checkoutBaseUrl: process.env.COMMAS_CHECKOUT_BASE_URL,
      env: process.env
    });
  }

  const finalTier = (await db.query(`SELECT outcome_tier FROM clients WHERE id = $1`, [written.clientId])).rows[0]?.outcome_tier;

  console.log("WROTE");
  console.log(`  client        ${written.clientId} · ${name} <${email}> · outcome_tier ${finalTier}`);
  console.log(`  login         ${written.accountId}${written.accountCreated ? " (new)" : " (already existed)"}`);
  console.log(`  identity      SSN ending ${identity.ssn.slice(-4)} encrypted · date of birth and ${identity.address.state} address stored`);
  console.log(`  consent       ${written.consents.length
    ? written.consents.map((c) => `${c.kind} ${c.id}`).join(" · ")
    : "already on file, left alone"}`);
  console.log(`  pay link      ${link
    ? `${link.link_ref} · ${money(link.amount_cents)} · ${link.status} · product ${product.code}`
    : `none minted — ${offer.name} was already paid on ${paidLink.link_ref}`}`);
  /* Repeated after the write, not only before it. The plan scrolls off the top
     of the screen while the rows are going in, and this is the one thing that
     makes everything after it look broken when it is not. */
  if (flaggedFromAnEarlierRun || contactFlagsSayLeaveAlone) {
    console.log("");
    console.log("!! REMINDER — this record carries a test marker or a leave-me-alone flag. Scroll up for");
    console.log("   which one. Some of what you are about to watch for will not happen, and nothing will");
    console.log("   say why. Clear it by hand, or re-run on a fresh --email.");
  }
  console.log("");
  console.log("NEXT, IN THIS ORDER — credit first, then the receipt:");
  console.log("");
  console.log(`  scripts/sim/with-prod-env.sh push-credit  --email ${email} --profile ${profile.creditProfile}`);
  if (link) {
    console.log(`  scripts/sim/with-prod-env.sh push-payment --email ${email} --ref ${link.link_ref}`);
  } else {
    console.log(`  push-payment — SKIP IT. ${offer.name} is already paid (${paidLink.link_ref}).`);
    console.log("  Running it again would record a second payment against the same sale.");
  }
  console.log("");
  console.log("  Then, so Chris can sign in as this client and watch the portal:");
  /* SIM_CLIENT_PASSWORD comes FIRST because set-client-password.mjs refuses to
     run without it — it reads the password from the environment on purpose, so
     it never lands in shell history or in `ps`. The old version of this line
     printed only DATABASE_URL, so pasting it got a flat refusal. */
  console.log(`  SIM_CLIENT_PASSWORD='…' DATABASE_URL=… node scripts/sim/set-client-password.mjs --email ${email}`);
  console.log("  (the password must be in the environment, not on the command line — that script refuses otherwise)");
  console.log("");
  console.log("  The receipt is drained by the inbox sweeper, which runs every minute.");
  console.log("  Give the screens about 60 seconds before deciding something is broken.");
  if (profile.needsDisputeAuth) {
    console.log("");
    console.log("  ABOUT THE LETTERS. The dispute authorization above is what lets the system");
    console.log("  prepare them at all; without it the letter run finds nothing wrong and says");
    console.log("  nothing about why. A signed repair agreement does the same job, so if you want");
    console.log(`  the paper on this walk too, send ${offer.contractTemplateKey || "the repair agreement"} and sign it in the portal.`);
  }
  await close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(async (e) => { console.error(String(e?.message || e)); try { await close(); } catch { /* noop */ } process.exit(1); });
}
