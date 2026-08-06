"use strict";

/**
 * client-sex.js — infer likely sex from a first name for gendered voice
 * selection, and pick the Bland voice for a given sex.
 *
 * Deterministic, no network / no dependency. Returns "M" | "F" | "unknown".
 * "unknown" whenever the name is unrecognized OR commonly used for both sexes —
 * the caller then falls back to the neutral/default voice. This is a best-effort
 * convenience; a stored client_sex value (PII_IDENTITY) always wins over inference.
 *
 * Voice IDs are env-configured (BLAND_VOICE_MALE / BLAND_VOICE_FEMALE), so the
 * female voice activates only once Chris supplies the Bland voice id. Until then
 * every path falls back to BLAND_VOICE / "mason" — no behavior change.
 */

// Common US first names. Not exhaustive — covers the bulk; anything unknown
// safely returns "unknown" → neutral voice.
const MALE = new Set([
  "james","john","robert","michael","william","david","richard","joseph","thomas","charles",
  "christopher","daniel","matthew","anthony","mark","donald","steven","paul","andrew","joshua",
  "kenneth","kevin","brian","george","timothy","ronald","edward","jason","jeffrey","ryan",
  "jacob","gary","nicholas","eric","jonathan","stephen","larry","justin","scott","brandon",
  "benjamin","samuel","gregory","frank","alexander","raymond","patrick","jack","dennis","jerry",
  "tyler","aaron","jose","adam","henry","nathan","douglas","zachary","peter","kyle",
  "walter","ethan","jeremy","harold","carl","keith","roger","gerald","aaron","dylan",
  "bryan","jordan","juan","luis","carlos","miguel","victor","hector","alan","albert",
  "austin","noah","gabriel","logan","liam","mason","elijah","oliver","lucas","caleb",
  "isaac","jesse","marcus","cory","travis","shawn","derek","corey","chad","wesley",
  "roberto","antonio","javier","cody","curtis","luke","evan","seth","hunter","cole"
]);

const FEMALE = new Set([
  "mary","patricia","jennifer","linda","elizabeth","barbara","susan","jessica","sarah","karen",
  "nancy","lisa","margaret","betty","sandra","ashley","kimberly","emily","donna","michelle",
  "carol","amanda","dorothy","melissa","deborah","stephanie","rebecca","sharon","laura","cynthia",
  "kathleen","amy","angela","shirley","anna","brenda","pamela","emma","nicole","helen",
  "samantha","katherine","christine","debra","rachel","carolyn","janet","catherine","maria","heather",
  "diane","olivia","julie","joyce","victoria","kelly","christina","joan","evelyn","lauren",
  "judith","megan","cheryl","andrea","hannah","martha","jacqueline","frances","gloria","ann",
  "teresa","kathryn","sophia","grace","alice","judy","isabella","julia","abigail","denise",
  "beverly","amber","danielle","brittany","diana","natalie","sara","kayla","alexis","lori",
  "tiffany","crystal","gabrielle","jasmine","destiny","vanessa","monica","erin","cassandra","chloe",
  "sophie","madison","ava","mia","ella","aria","lily","zoe","claire","paige"
]);

// Names commonly used for both sexes → treat as unknown (don't guess).
const AMBIGUOUS = new Set([
  "jordan","taylor","alex","casey","jamie","morgan","riley","cameron","avery","jessie",
  "dakota","skyler","quinn","reese","rowan","sage","hayden","peyton","charlie","finley",
  "emerson","angel","kai","phoenix","remy","robin","sam","chris","pat","lee","jean","kim"
]);

function inferSex(firstName) {
  if (!firstName) return "unknown";
  const n = String(firstName).trim().toLowerCase().split(/[\s-]/)[0];
  if (!n) return "unknown";
  if (AMBIGUOUS.has(n)) return "unknown";
  if (MALE.has(n)) return "M";
  if (FEMALE.has(n)) return "F";
  return "unknown";
}

// Normalize a stored client_sex value (male/female/M/F/…) to "M" | "F" | "unknown".
function normalizeSex(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "m" || s === "male") return "M";
  if (s === "f" || s === "female") return "F";
  return "unknown";
}

// Resolve sex: a stored value wins; otherwise infer from the first name.
function resolveSex(storedSex, firstName) {
  const stored = normalizeSex(storedSex);
  return stored !== "unknown" ? stored : inferSex(firstName);
}

// Pick the Bland voice for a sex. Unknown → neutral default. Female/male ids are
// env-configured; both fall back to BLAND_VOICE / "mason" until set (no regression).
function pickVoice(sex) {
  const s = normalizeSex(sex) !== "unknown" ? normalizeSex(sex) : inferSex(sex);
  const dflt = process.env.BLAND_VOICE || "mason";
  if (s === "F") return process.env.BLAND_VOICE_FEMALE || dflt;
  if (s === "M") return process.env.BLAND_VOICE_MALE || dflt;
  return dflt;
}

module.exports = { inferSex, normalizeSex, resolveSex, pickVoice };
