// Password hashing — scrypt (RFC 7914) from node:crypto.
//
// WHY SCRYPT AND NOT ARGON2/BCRYPT: both are native npm modules, and this
// package depends on `pg` and nothing else. scrypt is memory-hard, built in,
// and needs no build toolchain on Vercel. The stored format is PHC-style and
// carries its own algorithm id and parameters, so argon2id can be added later
// as a second branch in verifyPassword() — existing hashes keep verifying and
// nobody is forced to reset a password. needsRehash() marks the upgrade path.
//
// Stored form:  $scrypt$N=32768,r=8,p=1$<salt-b64url>$<dk-b64url>
//
// Nothing in this module logs, throws, or returns a password or a hash.

import crypto from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(crypto.scrypt);

// N=2^15, r=8, p=1 — ~32 MiB and ~100ms per hash on the target runtime. That is
// the cost an attacker pays per guess, and the cost a staff member pays once per
// login. maxmem must clear 128*N*r (32 MiB) with headroom or Node throws.
export const PARAMS = { N: 32768, r: 8, p: 1, keylen: 32, saltlen: 16, maxmem: 96 * 1024 * 1024 };

export const MIN_PASSWORD_LENGTH = 12;
// Upper bound so a huge body cannot turn one request into a memory-hard DoS.
export const MAX_PASSWORD_LENGTH = 1024;

const b64 = (buf) => buf.toString("base64url");

// validatePassword — returns null if acceptable, else a human-readable reason.
// The reason never quotes the password back.
export function validatePassword(password) {
  if (typeof password !== "string") return "password must be a string";
  if (password.length < MIN_PASSWORD_LENGTH) return `password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `password must be at most ${MAX_PASSWORD_LENGTH} characters`;
  if (password.trim().length === 0) return "password must not be blank";
  return null;
}

// hashPassword(password) → PHC string. Throws on a password that fails policy,
// with a message that contains the rule, never the input.
export async function hashPassword(password) {
  const bad = validatePassword(password);
  if (bad) throw new Error(bad);
  const salt = crypto.randomBytes(PARAMS.saltlen);
  const dk = await scrypt(normalize(password), salt, PARAMS.keylen, {
    N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: PARAMS.maxmem
  });
  return `$scrypt$N=${PARAMS.N},r=${PARAMS.r},p=${PARAMS.p}$${b64(salt)}$${b64(dk)}`;
}

// parse — PHC string → {algo, N, r, p, salt, dk} or null if unparseable.
function parse(stored) {
  if (typeof stored !== "string") return null;
  const parts = stored.split("$");
  // ["", algo, params, salt, dk]
  if (parts.length !== 5 || parts[0] !== "") return null;
  const [, algo, paramStr, saltB64, dkB64] = parts;
  if (algo !== "scrypt") return null;
  const p = {};
  for (const kv of paramStr.split(",")) {
    const [k, v] = kv.split("=");
    const n = Number(v);
    if (!k || !Number.isInteger(n) || n <= 0) return null;
    p[k] = n;
  }
  if (!p.N || !p.r || !p.p) return null;
  try {
    const salt = Buffer.from(saltB64, "base64url");
    const dk = Buffer.from(dkB64, "base64url");
    if (salt.length === 0 || dk.length === 0) return null;
    return { algo, N: p.N, r: p.r, p: p.p, salt, dk };
  } catch {
    return null;
  }
}

// verifyPassword(password, stored) → boolean. Constant-time comparison of the
// derived key. Never throws: a malformed or missing hash is simply `false`, so
// a staff row with no credential cannot become an accidental bypass.
export async function verifyPassword(password, stored) {
  const parsed = parse(stored);
  if (!parsed) return false;
  if (typeof password !== "string" || password.length === 0) return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;
  let dk;
  try {
    dk = await scrypt(normalize(password), parsed.salt, parsed.dk.length, {
      N: parsed.N, r: parsed.r, p: parsed.p, maxmem: PARAMS.maxmem
    });
  } catch {
    return false;
  }
  // Lengths are equal by construction (keylen taken from the stored dk), but
  // timingSafeEqual throws on a mismatch, so guard rather than let it escape.
  if (dk.length !== parsed.dk.length) return false;
  return crypto.timingSafeEqual(dk, parsed.dk);
}

// needsRehash(stored) → true when the stored hash is not at current parameters.
// Call after a successful verify; rehash with the plaintext you already have.
export function needsRehash(stored) {
  const parsed = parse(stored);
  if (!parsed) return true;
  return parsed.N !== PARAMS.N || parsed.r !== PARAMS.r || parsed.p !== PARAMS.p
      || parsed.dk.length !== PARAMS.keylen;
}

// A hash of an unguessable value, used to burn the same CPU when the email does
// not exist. Without it, "no such staff" returns in ~0ms while a real account
// takes ~100ms, and that difference enumerates the staff list.
let _decoy = null;
export async function verifyDecoy(password) {
  if (!_decoy) _decoy = await hashPassword(crypto.randomBytes(32).toString("base64url"));
  return verifyPassword(typeof password === "string" ? password : "", _decoy);
}

// Unicode normalisation so a password typed on a different keyboard/IME still
// matches. NFKC is what WebAuthn/OWASP recommend for password comparison.
function normalize(password) {
  return Buffer.from(password.normalize("NFKC"), "utf8");
}
