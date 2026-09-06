// Zoho Recruit connector — the pure half. No network, no database, no clock.
//
// EVERYTHING HERE RUNS ON EVERY CI RUN, including the ones with no DATABASE_URL.
// That is deliberate: these are the functions that decide what crosses from an
// outside system into the candidate tables, and a check that only runs when a
// database happens to be present is a check that runs sometimes.
//
// THE TESTS THAT MATTER MOST are the ones that try to get something into an
// applicant record that must not be there — a date of birth, a gender, a Zoho
// pipeline status that would move somebody through our stages with no human
// looking — and the ones that prove a malformed record produces a recordable
// "we could not use this" rather than a thrown error or, worse, a plausible
// half-record.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  normaliseCandidate,
  externalKeyFor,
  jobOpeningPayload,
  windowStart,
  zohoTimestamp,
  apiDomainFor,
  accountsDomainFor,
  DEFAULT_API_DOMAIN,
  OVERLAP_MINUTES,
  COLD_START_DAYS,
  FREE_TIER_MAX_ACTIVE_POSTINGS,
  PER_PAGE
} from "./zoho.mjs";

/* A realistic Zoho Candidates record. Field names and the id shape are taken from
   the v2 response example in the owner-supplied spec (2026-09-05); the values are
   invented and no real person is in here. */
const zohoCandidate = (over = {}) => ({
  id: "4150868000000420069",
  First_Name: "Dana",
  Last_Name: "Reyes",
  Email: "Dana.Reyes@Example.TEST",
  Phone: "602-555-0134",
  City: "Phoenix",
  State: "AZ",
  Country: "United States",
  Experience_in_Years: 4,
  Current_Job_Title: "Inside Sales Rep",
  Skill_Set: ["outbound", "objection handling"],
  Candidate_Status: "Rejected",
  Source: "LinkedIn",
  Created_Time: "2026-09-05T08:12:00-07:00",
  Modified_Time: "2026-09-05T08:40:00-07:00",
  Owner: { name: "Recruiter", id: "4150868000000111111" },
  Is_Locked: false,
  $approved: true,
  ...over
});

describe("normaliseCandidate — what crosses the wire", () => {
  test("maps contact details to apply()'s top-level shape", () => {
    const n = normaliseCandidate(zohoCandidate(), { roleKey: "closer" });
    assert.equal(n.fullName, "Dana Reyes");
    assert.equal(n.phone, "602-555-0134");
    assert.equal(n.source, "zoho");
    assert.equal(n.zohoCandidateId, "4150868000000420069");
  });

  test("lowercases the email, because candidates.email has a CHECK that demands it", () => {
    // 051_hiring.sql: CHECK (email = lower(btrim(email))). A mixed-case address
    // would be rejected by the database at insert time, which surfaces as a
    // constraint violation in a cron job rather than as an applicant.
    const n = normaliseCandidate(zohoCandidate(), { roleKey: "closer" });
    assert.equal(n.email, "dana.reyes@example.test");
  });

  test("carries the answers the applicant actually gave", () => {
    const n = normaliseCandidate(zohoCandidate(), { roleKey: "closer" });
    assert.equal(n.answers.city, "Phoenix");
    assert.equal(n.answers.experience_in_years, "4");
    assert.equal(n.answers.current_job_title, "Inside Sales Rep");
    assert.deepEqual(n.answers.skill_set, ["outbound", "objection handling"]);
  });

  test("does NOT import Zoho's own candidate status", () => {
    // The load-bearing one. Candidate_Status is Zoho's pipeline state. Importing
    // it would let an outside system move a person through OUR stages — including
    // to a rejection — with no human in the loop, which is the single invariant
    // 051_hiring.sql exists to protect.
    const n = normaliseCandidate(zohoCandidate({ Candidate_Status: "Rejected" }), { roleKey: "closer" });
    assert.equal(n.answers.candidate_status, undefined);
    assert.ok(!JSON.stringify(n.answers).toLowerCase().includes("rejected"));
  });

  test("drops Zoho bookkeeping and lookup objects", () => {
    const n = normaliseCandidate(zohoCandidate(), { roleKey: "closer" });
    for (const key of ["owner", "is_locked", "created_time", "modified_time", "id", "source"]) {
      assert.equal(n.answers[key], undefined, `${key} must not become an answer`);
    }
    // Nothing beginning with "$" survives either.
    assert.ok(!Object.keys(n.answers).some((k) => k.includes("approved")));
  });
});

describe("normaliseCandidate — protected characteristics", () => {
  test("strips them and COUNTS them", () => {
    // Counting is the point. Zero is the expected number; a number that climbs
    // means Zoho's application form started collecting something it should not,
    // and silent stripping would hide exactly that.
    const n = normaliseCandidate(zohoCandidate({
      Date_of_Birth: "1990-04-11",
      Gender: "Female",
      Marital_Status: "Married",
      Ethnicity: "Prefer not to say",
      Criminal_History: "None",
      Salary_History: "72000",
      Disability_Status: "No"
    }), { roleKey: "closer" });

    for (const gone of ["date_of_birth", "gender", "marital_status", "ethnicity",
                        "criminal_history", "salary_history", "disability_status"]) {
      assert.equal(n.answers[gone], undefined, `${gone} must never reach answers`);
    }
    assert.equal(n.droppedProtected.length, 7);
  });

  test("counts a protected field even when its value is blank", () => {
    // "We dropped nothing because it happened to be empty today" is a different
    // finding from "the form does not ask", and only the second one is safe.
    const n = normaliseCandidate(zohoCandidate({ Date_of_Birth: "" }), { roleKey: "closer" });
    assert.deepEqual(n.droppedProtected, ["Date_of_Birth"]);
  });

  test("catches protected concepts however Zoho spells the field", () => {
    const n = normaliseCandidate(zohoCandidate({
      applicantAge: 41,              // camelCase
      Are_You_Pregnant: "no",        // stem, mid-name
      veteranStatus: "yes",          // stem, camelCase
      Place_of_Birth: "Tucson",      // stem
      Citizenship: "US"              // stem
    }), { roleKey: "closer" });
    assert.equal(n.droppedProtected.length, 5);
    assert.equal(n.answers.applicant_age, undefined);
    assert.equal(n.answers.are_you_pregnant, undefined);
  });

  test("does NOT over-block a real rubric field", () => {
    // A deny-list that also blocks the questions we actually score is one somebody
    // switches off. `agency_experience` must survive `age`, `average_deal_size`
    // must survive too, and expected salary is not salary history.
    const n = normaliseCandidate(zohoCandidate({
      Agency_Experience: "3 years",
      Average_Deal_Size: "8500",
      Expected_Salary: "90000",
      Management_Experience: "none"
    }), { roleKey: "closer" });
    assert.equal(n.answers.agency_experience, "3 years");
    assert.equal(n.answers.average_deal_size, "8500");
    assert.equal(n.answers.expected_salary, "90000");
    assert.equal(n.answers.management_experience, "none");
    assert.equal(n.droppedProtected.length, 0);
  });
});

describe("normaliseCandidate — malformed records", () => {
  test("a record with no id is returned unusable, not thrown", () => {
    const n = normaliseCandidate({ First_Name: "Nobody" }, { roleKey: "closer" });
    assert.equal(n.zohoCandidateId, null);
    assert.equal(n.externalApplicationId, null);
  });

  test("a record with no email survives normalisation so it can be RECORDED as skipped", () => {
    // Throwing here would make one bad row abort a whole poll. Returning null
    // lets the caller write a skipped row, which is what makes the loss visible
    // instead of looking like a quiet day.
    const n = normaliseCandidate(zohoCandidate({ Email: null }), { roleKey: "closer" });
    assert.equal(n.email, null);
    assert.equal(n.fullName, "Dana Reyes");
  });

  test("a record with no name at all yields a null name", () => {
    const n = normaliseCandidate(
      zohoCandidate({ First_Name: null, Last_Name: null, Full_Name: null }), { roleKey: "closer" });
    assert.equal(n.fullName, null);
  });

  test("junk input does not throw", () => {
    for (const junk of [null, undefined, "a string", 42, [], true]) {
      const n = normaliseCandidate(junk, { roleKey: "closer" });
      assert.equal(n.zohoCandidateId, null);
      assert.deepEqual(n.answers, {});
      assert.deepEqual(n.droppedProtected, []);
    }
  });

  test("whitespace-only values are dropped rather than stored as empty strings", () => {
    const n = normaliseCandidate(zohoCandidate({ Cover_Note: "   ", Phone: "  " }), { roleKey: "closer" });
    assert.equal(n.answers.cover_note, undefined);
    assert.equal(n.phone, null);
  });
});

describe("externalKeyFor — the idempotency key", () => {
  test("is deterministic for the same candidate and req", () => {
    assert.equal(externalKeyFor("4150868000000420069", "closer"), "zoho:4150868000000420069:closer");
    assert.equal(
      externalKeyFor("4150868000000420069", "closer"),
      externalKeyFor("4150868000000420069", "CLOSER"));
  });

  test("separates two reqs for the same person", () => {
    // (org, external_application_id) is UNIQUE. Keying on the Zoho id alone would
    // let a closer application permanently block the same person's later setter
    // application — the exact case 051's header calls out.
    assert.notEqual(
      externalKeyFor("4150868000000420069", "closer"),
      externalKeyFor("4150868000000420069", "setter"));
  });

  test("is null when either half is missing, so nothing half-keyed is stored", () => {
    assert.equal(externalKeyFor(null, "closer"), null);
    assert.equal(externalKeyFor("415", null), null);
    assert.equal(externalKeyFor("", "closer"), null);
  });

  test("keeps Zoho's id as a string", () => {
    // The id is a 19-digit numeric. Parsing it as a number loses precision and
    // silently merges two different candidates.
    const key = externalKeyFor("4150868000000420069", "closer");
    assert.ok(key.includes("4150868000000420069"));
  });
});

describe("jobOpeningPayload — nothing is invented", () => {
  test("wraps nothing itself but produces the record Zoho's data[] takes", () => {
    const { record } = jobOpeningPayload({
      roleName: "Sales Closer",
      brief: "Close inbound calls for funding clients.",
      location: { city: "Phoenix", state: "AZ", country: "United States" }
    });
    assert.equal(record.Job_Title, "Sales Closer");
    assert.equal(record.Job_Description, "Close inbound calls for funding clients.");
    assert.equal(record.Publish, true);
    assert.equal(record.City, "Phoenix");
  });

  test("refuses to build a payload with no job description", () => {
    // An invented job description becomes something a real person is judged
    // against, and later, evidence.
    assert.throws(
      () => jobOpeningPayload({ roleName: "Sales Closer", brief: null }),
      /never post an invented description/);
    assert.throws(
      () => jobOpeningPayload({ roleName: "Sales Closer", brief: "   " }),
      /never post an invented description/);
  });

  test("omits what it does not know instead of guessing, and says what it omitted", () => {
    const { record, omitted } = jobOpeningPayload({
      roleName: "Sales Closer", brief: "Close inbound calls.",
      location: { city: "Phoenix", country: "United States" }
    });
    assert.equal(record.Salary, undefined);
    assert.equal(record.State, undefined);
    assert.ok(omitted.includes("Salary"));
    assert.ok(omitted.includes("State"));
    assert.ok(!omitted.includes("City"));
  });
});

describe("time — the hazard that shifts a window by hours with no error", () => {
  test("timestamps always carry an explicit offset", () => {
    // A bare local time is read by Zoho in whatever zone it likes. toISOString
    // always ends in Z, which IS an explicit offset.
    const t = zohoTimestamp(new Date("2026-09-05T08:00:00-07:00"));
    assert.match(t, /Z$/);
    assert.equal(t, "2026-09-05T15:00:00.000Z");
  });

  test("an Arizona wall-clock string round-trips to the right instant", () => {
    // Arizona is America/Phoenix and does not observe daylight saving, so -07:00
    // is correct all year. See docs/workflows/arizona-time-2026-08-28.md.
    assert.equal(zohoTimestamp("2026-01-15T08:00:00-07:00"), "2026-01-15T15:00:00.000Z");
    assert.equal(zohoTimestamp("2026-07-15T08:00:00-07:00"), "2026-07-15T15:00:00.000Z");
  });

  test("rejects an unreadable date rather than sending garbage", () => {
    assert.throws(() => zohoTimestamp("not a date"), /invalid date/);
  });

  test("the poll window starts BEFORE the cursor, on purpose", () => {
    // greater_equal on the exact last-run instant loses anything created in the
    // same second, and clock skew widens the hole. Duplicates are free; gaps are
    // invisible.
    const cursor = new Date("2026-09-05T15:00:00.000Z");
    const start = windowStart({ cursor });
    assert.equal(start.toISOString(), "2026-09-05T14:55:00.000Z");
    assert.equal((cursor - start) / 60000, OVERLAP_MINUTES);
  });

  test("with no cursor it reaches back far enough to find an existing pipeline", () => {
    const now = new Date("2026-09-05T15:00:00.000Z");
    const start = windowStart({ cursor: null, now });
    assert.equal(Math.round((now - start) / 86400000), COLD_START_DAYS);
  });

  test("an unreadable cursor falls back to the cold start rather than to zero", () => {
    // Falling back to the epoch would ask Zoho for every candidate ever, which on
    // a 500-call-a-day budget is a self-inflicted outage.
    const now = new Date("2026-09-05T15:00:00.000Z");
    const start = windowStart({ cursor: "garbage", now });
    assert.equal(Math.round((now - start) / 86400000), COLD_START_DAYS);
  });
});

describe("data centre — the silent auth failure", () => {
  test("defaults to the US host when nothing was recorded", () => {
    assert.equal(apiDomainFor({}), DEFAULT_API_DOMAIN);
    assert.equal(apiDomainFor({ api_domain: null }), DEFAULT_API_DOMAIN);
  });

  test("uses the stored host, trailing slash or not", () => {
    assert.equal(apiDomainFor({ api_domain: "https://www.zohoapis.eu/" }), "https://www.zohoapis.eu");
  });

  test("pairs each API host with its own accounts host", () => {
    assert.equal(accountsDomainFor({ api_domain: "https://www.zohoapis.eu" }), "https://accounts.zoho.eu");
    assert.equal(accountsDomainFor({}), "https://accounts.zoho.com");
  });

  test("throws on an unknown region instead of refreshing against the wrong one", () => {
    // A refresh sent to the wrong region does not error usefully — it just never
    // works. Better to fail here, by name.
    assert.throws(
      () => accountsDomainFor({ api_domain: "https://www.zohoapis.example" }),
      /unrecognised api_domain/);
  });
});

describe("plan limits are named, not buried", () => {
  test("the free-tier active-job limit is one", () => {
    assert.equal(FREE_TIER_MAX_ACTIVE_POSTINGS, 1);
  });

  test("page size matches Zoho's documented maximum", () => {
    assert.equal(PER_PAGE, 200);
  });
});
