// Subscriptions — the pure half of the Client Finance OS foundation slice.
//
// Two jobs, both of which have to be right before anything touches a database:
//
//   1. KEEP CARD NUMBERS OUT. normalizeCardMeta() is the only sanctioned way to
//      build a client_cards write. It refuses a PAN, a CVV, and a "last4" that
//      is longer than four digits, and it refuses them by THROWING rather than
//      by trimming — see below for why trimming would be the dangerous choice.
//
//   2. KEEP UNKNOWNS UNKNOWN. Every value this module cannot establish comes
//      back null and stays null. Nothing here defaults a missing number to zero.
//
// Pure and I/O-free. The database half is store.mjs, so these rules stay
// testable without Postgres — and so the same rules can run at the edge of an
// HTTP handler later without dragging a connection in.
//
// Money crosses this module as INTEGER CENTS via src/commissions/money.mjs.
// Note the deliberate asymmetry with that module: toCents(null) returns 0 there,
// which is correct for "no payments yet" and WRONG for "nobody recorded this
// price". priceToCents() below is the null-preserving wrapper, and it exists
// specifically so that an unrecorded subscription price never lands in the
// database as a free plan.

import { toCents, fromCents } from "../commissions/money.mjs";

// ---------------------------------------------------------------------------
// 1. Card data that must never arrive
// ---------------------------------------------------------------------------

/* The field names processors and SDKs use for the values we will not store. A
   caller passing any of these is holding raw card data, and the correct outcome
   is a loud failure at the boundary rather than a quiet drop — a quiet drop
   leaves them believing the number was saved, and it means the number was in
   this process's memory and nobody said so. */
const FORBIDDEN_CARD_FIELDS = [
  "pan", "card_number", "cardNumber", "number", "account_number", "accountNumber",
  "cvv", "cvv2", "cvc", "cvc2", "security_code", "securityCode", "csc",
  "encrypted_pan", "full_pan", "track_data", "magstripe"
];

/**
 * looksLikeCardNumber — the same shape test as the client_cards_token_not_pan
 * CHECK in migration 076: 12 to 19 digits once spaces and dashes are removed.
 *
 * A SHAPE TEST, NOT PROOF. It catches the mistake that actually happens — the
 * raw number passed straight into the field labelled "token", because both are
 * strings and it worked against the sandbox. It cannot catch an encoded PAN and
 * does not pretend to. The database repeats the check so a writer that skips
 * this module still cannot get one in.
 */
export function looksLikeCardNumber(value) {
  if (value == null) return false;
  const bare = String(value).replace(/[\s-]/g, "");
  return /^[0-9]{12,19}$/.test(bare);
}

/**
 * assertNoCardData — throws if an object carries a PAN, a CVV, or anything
 * shaped like one. Exported because it is the check an HTTP handler would want
 * on its request body before it ever reaches storage.
 */
export function assertNoCardData(input, where = "input") {
  if (!input || typeof input !== "object") return;
  for (const field of FORBIDDEN_CARD_FIELDS) {
    if (input[field] !== undefined) {
      throw new TypeError(
        `${where}: field "${field}" must never be sent — this system stores a processor token only, never a card number or security code`
      );
    }
  }
}

function readExpMonth(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 12) {
    throw new RangeError(`normalizeCardMeta: exp_month must be 1-12, got ${JSON.stringify(value)}`);
  }
  return n;
}

/* A FOUR-DIGIT YEAR OR NOTHING, and a two-digit year is refused rather than
   expanded. "29" is unambiguous to a human and ambiguous to code — the same
   expansion rule that reads 29 as 2029 reads 99 as 2099, and a card is not
   valid for seventy years. The column takes 2000-2100 (076) and this refuses
   earlier so the caller learns which value was wrong. */
function readExpYear(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2000 || n > 2100) {
    throw new RangeError(
      `normalizeCardMeta: exp_year must be a four-digit year between 2000 and 2100, got ${JSON.stringify(value)}`
    );
  }
  return n;
}

/* last4 is either exactly four digits or absent.
 *
 * THE SLICE THAT IS NOT HERE. The obvious kindness is to accept a long number
 * and keep its last four. That kindness is the breach: it accepts a full card
 * number, holds it in memory, and reports success — so nothing upstream ever
 * learns it sent one, and the next caller sends one too. Refusing is the only
 * behaviour that makes the mistake visible. */
function readLast4(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!/^[0-9]{4}$/.test(s)) {
    throw new TypeError(
      `normalizeCardMeta: last4 must be exactly four digits — a longer value looks like a card number and is refused, never truncated`
    );
  }
  return s;
}

/**
 * normalizeCardMeta — caller input → the exact row `client_cards` accepts.
 *
 * Accepts snake_case or camelCase for the metadata fields, because both shapes
 * arrive in this repo (webhook payloads are snake, JS callers are camel).
 * Unknown metadata stays null; only the token is required.
 */
export function normalizeCardMeta(input) {
  if (!input || typeof input !== "object") {
    throw new TypeError("normalizeCardMeta: an object is required");
  }
  assertNoCardData(input, "normalizeCardMeta");

  const token = input.provider_token ?? input.providerToken ?? input.token ?? null;
  if (token == null || String(token).trim() === "") {
    throw new TypeError("normalizeCardMeta: provider_token is required — there is nothing else to charge with");
  }
  const provider_token = String(token).trim();
  if (looksLikeCardNumber(provider_token)) {
    throw new TypeError(
      "normalizeCardMeta: that token is shaped like a card number and is refused — pass the processor's token, never the PAN"
    );
  }

  const brand = input.brand == null || String(input.brand).trim() === "" ? null : String(input.brand).trim();

  return {
    provider: input.provider == null || String(input.provider).trim() === ""
      ? "commas"
      : String(input.provider).trim(),
    provider_token,
    brand,
    last4: readLast4(input.last4 ?? input.lastFour ?? null),
    exp_month: readExpMonth(input.exp_month ?? input.expMonth ?? null),
    exp_year: readExpYear(input.exp_year ?? input.expYear ?? null)
  };
}

// ---------------------------------------------------------------------------
// 2. Money
// ---------------------------------------------------------------------------

/**
 * priceToCents — a decimal price → integer cents, PRESERVING NULL.
 *
 * money.toCents() maps null to 0 on purpose ("no payments yet" is a real zero).
 * A subscription price is the opposite case: null means nobody has recorded
 * what this tier costs, and there is no tier price row anywhere in this
 * repository yet (see 075's header). Storing 0 for that would create a
 * subscription that reads as free — a decision nobody made, indistinguishable
 * from one somebody did.
 */
export function priceToCents(value) {
  if (value === null || value === undefined || value === "") return null;
  return toCents(value);
}

/** formatPrice — integer cents → a fixed 2dp STRING (money.fromCents), or null.
 *  It is a string, not a number: 19.90 as a float is not 19.90. */
export function formatPrice(cents) {
  if (cents === null || cents === undefined) return null;
  return fromCents(Number(cents));
}

/** assertPriceCents — the guard on every write path. null passes through; a
 *  float, a numeric string or a negative does not. Floats are refused rather
 *  than rounded, because a caller passing 19.99 meant dollars and rounding it
 *  to 20 cents would bill them 20 cents. */
export function assertPriceCents(value, where = "price_cents") {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value)) {
    throw new TypeError(`${where}: money is integer cents — got ${JSON.stringify(value)}. Use priceToCents() at the boundary.`);
  }
  if (value < 0) throw new RangeError(`${where}: must not be negative — got ${value}`);
  return value;
}

// ---------------------------------------------------------------------------
// 3. Effective-dated rows
// ---------------------------------------------------------------------------

function asTime(value, where) {
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(t)) throw new TypeError(`${where}: not a date: ${JSON.stringify(value)}`);
  return t;
}

/**
 * isLiveAt — was this version in force at `at`?
 *
 * Half-open [effective_from, effective_to), matching the '[)' range in the
 * subscriptions_no_overlap constraint. The instant a version closes is the
 * instant its successor opens, and exactly one of them covers it.
 *
 * A cancelled row can still be live: cancelled_at records when the client asked
 * to stop, effective_to records when it actually stopped, and between the two
 * the arrangement is still in force. Answering "not live" here would hide a
 * period the client has already paid for.
 */
export function isLiveAt(row, at = new Date()) {
  if (!row || row.effective_from == null) return false;
  const t = asTime(at, "isLiveAt");
  if (asTime(row.effective_from, "isLiveAt: effective_from") > t) return false;
  if (row.effective_to == null) return true;
  return asTime(row.effective_to, "isLiveAt: effective_to") > t;
}

/**
 * planChange — validate a tier/price change and return the terms of the row it
 * opens. It does NOT return the whole new row: the bindings that carry forward
 * unchanged (the card, the processor reference) are copied from the row being
 * closed inside one SQL statement, so they cannot go stale between a read here
 * and a write there. See changeTier in store.mjs.
 *
 * Everything this refuses is something the database would either accept
 * silently or reject with a constraint name nobody can act on:
 *
 *   * no live row          — there is nothing to change; the caller wants
 *                            startSubscription.
 *   * already closed       — the caller is holding a historical version and
 *                            about to fork the chain.
 *   * at <= effective_from — a zero-length or reversed window. The exclusion
 *                            constraint rejects the overlap with a constraint
 *                            name; this says which date is wrong.
 *   * identical terms      — a change that changes nothing writes a new version
 *                            of the same price and makes the history lie about
 *                            when something happened. Moving a card or
 *                            cancelling are their own calls.
 */
export function planChange(current, next = {}, at = new Date()) {
  if (!current) {
    throw new TypeError("planChange: no live subscription to change — use startSubscription");
  }
  if (current.effective_to != null) {
    throw new TypeError(`planChange: subscription ${current.id ?? ""} is already closed — a closed version cannot be changed`.trim());
  }

  const atTime = asTime(at, "planChange: at");
  if (atTime <= asTime(current.effective_from, "planChange: current.effective_from")) {
    throw new RangeError("planChange: the change must fall after the current version started");
  }

  const tier = next.tier == null || String(next.tier).trim() === ""
    ? String(current.tier)
    : String(next.tier).trim();

  const price_cents = next.price_cents === undefined
    ? (current.price_cents == null ? null : Number(current.price_cents))
    : assertPriceCents(next.price_cents, "planChange: price_cents");

  const currency = next.currency == null || String(next.currency).trim() === ""
    ? String(current.currency ?? "USD")
    : String(next.currency).trim();

  const samePrice = (current.price_cents == null ? null : Number(current.price_cents)) === price_cents;
  if (tier === String(current.tier) && samePrice && currency === String(current.currency ?? "USD")) {
    throw new TypeError(
      "planChange: tier, price and currency are unchanged — opening a version that changes nothing would put a date on an event that did not happen"
    );
  }

  return { tier, price_cents, currency, effective_from: new Date(atTime).toISOString() };
}
