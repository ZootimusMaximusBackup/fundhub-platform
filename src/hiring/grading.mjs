// The application grading engine.
//
// ══════════════════════════════════════════════════════════════════════════════
// THIS SCORES CANDIDATES. IT NEVER REJECTS ONE.
//
// grade() returns { average, recommendation, flags }. There is no code path here
// that closes an application, sets status to 'rejected', or writes a
// hiring_decisions row. Rejection requires a named human and lives in
// ./pipeline.mjs, because scoring job applicants is a regulated automated
// employment decision — Title VII adverse impact attaches regardless of intent,
// and NYC Local Law 144 requires a bias audit and candidate notice for any tool
// used to screen.
//
// So the recommendations are advisory STRINGS a reviewer reads. Even
// "review_likely_no" is an instruction to a person, not an outcome. If a future
// change makes this module able to reject, that is the bug.
// ══════════════════════════════════════════════════════════════════════════════
//
// DETERMINISTIC, like src/compliance/screen.mjs and for the same reason: a score
// that varies run-to-run for identical answers is not a measurement, and it makes
// a disparate-impact analysis impossible. No LLM, no randomness, no clock.
//
// PROTECTED CHARACTERISTICS ARE NEVER INPUTS. scoreable() filters the answer set
// against a deny-list before anything is read, so a rubric that named `age` or an
// application form that collected `gender` cannot feed the score even by accident.
// This is a filter rather than a convention because the failure is invisible: a
// model scoring on a proxy still produces plausible numbers.

/* Answer keys that must never reach a score, however a rubric is configured.
   Two lists, because one matching rule cannot serve both cases:

   WORDS are matched WHOLE. `age` must catch `age` and `applicant_age` but must NOT
   catch `agency_experience` or `average_deal_size` — a deny-list that also blocks
   the real rubric is one somebody switches off.

   STEMS are matched as PREFIXES, because the protected concept has many endings
   and listing them all is how one gets missed. `pregnan` has to reach `pregnancy`
   and `pregnant`; `convict` has to reach `conviction`, `convictions`, `convicted`.
   Getting this wrong is invisible — the filter reports clean and the score still
   looks plausible. */
const PROTECTED_WORDS = [
  "age", "dob", "date_of_birth", "birthdate", "birthday",
  "race", "color", "colour",
  "sex", "gender", "pronoun", "pronouns",
  "faith", "visa", "spouse", "children", "dependents",
  "national_origin", "family_status", "military_status",
  "credit_score", "salary_history", "criminal_history", "medical", "health"
];

const PROTECTED_STEMS = [
  "ethnic",        // ethnic, ethnicity
  "religio",       // religion, religious
  "national",      // nationality, national origin
  "citizen",       // citizenship
  "immigrat",      // immigration, immigrant
  "disab",         // disability, disabled
  "pregnan",       // pregnancy, pregnant
  "marit", "marriage",
  "veteran",
  "orientation", "sexual",
  "arrest",        // arrest, arrests, arrested
  "convict",       // conviction, convictions, convicted
  "criminal",
  "birth"          // birthplace, place_of_birth
];

const WORD_RE = new RegExp(
  `(^|[^a-z0-9])(${PROTECTED_WORDS.join("|")})([^a-z0-9]|$)`, "i");
// Boundary before, anything after — that is what makes it a prefix match.
const STEM_RE = new RegExp(
  `(^|[^a-z0-9])(${PROTECTED_STEMS.join("|")})`, "i");

/* isProtected(key) — true when a key looks like a protected characteristic.
   Exported so the intake path can refuse to STORE these, not merely refuse to
   score them. Data you never collected cannot leak, be subpoenaed, or be scored
   by a later version of this file. */
export function isProtected(key) {
  const k = String(key ?? "");
  // camelCase is split so `ageRange` and `maritalStatus` are caught alongside
  // their snake_case spellings.
  const normalised = k.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return WORD_RE.test(normalised) || STEM_RE.test(normalised);
}

/* scoreable(answers) → { safe, rejected[] }
   Splits an answer set into what may be scored and what must not be. */
export function scoreable(answers = {}) {
  const safe = {};
  const rejected = [];
  for (const [k, v] of Object.entries(answers || {})) {
    if (isProtected(k)) rejected.push(k);
    else safe[k] = v;
  }
  return { safe, rejected };
}

/* grade({ rubric, categoryScores, answers }) → result

   `categoryScores` is { category_key: 1..4 } as assessed by a reviewer or by an
   upstream mapper. This function does the arithmetic, the banding and the
   flagging — deliberately NOT the assessment of free text, which is a judgement
   and belongs to a person.

   Returns:
     { average, recommendation, label, flags[], categoryScores, rubricVersion,
       missing[], protectedRejected[] } */
export function grade({ rubric, categoryScores = {}, answers = {} } = {}) {
  if (!rubric || typeof rubric !== "object") {
    throw new Error("grade: a rubric is required — refusing to score against an unspecified standard");
  }

  const categories = parseJson(rubric.categories, []);
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new Error("grade: rubric has no categories");
  }

  const { rejected: protectedRejected } = scoreable(answers);

  // Any protected key present in the SCORES themselves is a hard error, not a
  // filter. A reviewer scoring a category called "age_fit" is a process failure
  // that must surface loudly rather than be quietly dropped.
  const protectedScored = Object.keys(categoryScores).filter(isProtected);
  if (protectedScored.length) {
    throw new Error(
      `grade: refusing to score protected characteristics: ${protectedScored.join(", ")}`);
  }

  const scores = [];
  const missing = [];
  for (const cat of categories) {
    const raw = categoryScores[cat.key];
    if (raw === undefined || raw === null || raw === "") { missing.push(cat.key); continue; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1 || n > 4) {
      throw new Error(`grade: category "${cat.key}" scored ${raw}; the scale is 1-4`);
    }
    // Weighted if the rubric says so, unweighted otherwise. A weight of 0 is
    // honoured (a category kept for the record but excluded from the number).
    const weight = cat.weight === undefined || cat.weight === null ? 1 : Number(cat.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`grade: category "${cat.key}" has an invalid weight ${cat.weight}`);
    }
    scores.push({ key: cat.key, value: n, weight });
  }

  // A PARTIAL RUBRIC PRODUCES NO RECOMMENDATION. Averaging the three categories
  // somebody happened to fill in and banding that as if it were complete is how a
  // candidate gets "below bar" from one answered question.
  if (missing.length) {
    return {
      average: null,
      recommendation: "incomplete",
      label: `Not scored: ${missing.length} of ${categories.length} categories are unrated`,
      flags: [],
      categoryScores,
      rubricVersion: rubric.version ?? null,
      missing,
      protectedRejected
    };
  }

  const totalWeight = scores.reduce((n, s) => n + s.weight, 0);
  const average = totalWeight === 0
    ? null
    : round2(scores.reduce((n, s) => n + s.value * s.weight, 0) / totalWeight);

  const band = bandFor(parseJson(rubric.rating_bands, []), average);

  return {
    average,
    recommendation: band?.recommendation ?? "review",
    label: band?.label ?? "No band matched — human review required",
    flags: flagsFor(rubric, { categoryScores, answers, average }),
    categoryScores,
    rubricVersion: rubric.version ?? null,
    missing: [],
    protectedRejected
  };
}

/* bandFor — the average → recommendation mapping.

   Returns null when nothing matches, and grade() turns that into "human review
   required" rather than into a pass or a fail. An unmatched score is a
   misconfigured rubric, and the safe reading of a misconfiguration in a hiring
   tool is "a person should look at this". */
export function bandFor(bands, average) {
  if (average === null || average === undefined) return null;
  if (!Array.isArray(bands)) return null;
  return bands.find((b) =>
    Number(average) >= Number(b.min) && Number(average) <= Number(b.max)) || null;
}

/* flagsFor — the review flags.

   FLAGS ROUTE TO A HUMAN. They never decide. Each one is a sentence a reviewer
   reads next to the application, which is why the label lives in config rather
   than being generated here. */
export function flagsFor(rubric, { categoryScores = {}, answers = {}, average } = {}) {
  const defined = parseJson(rubric.review_flags, []);
  const out = [];

  for (const flag of Array.isArray(defined) ? defined : []) {
    if (flag.key === "incongruent_answers") {
      // The honesty category scoring at the floor is the signal doc 10 describes
      // as "obvious incongruence in answer quality".
      if (Number(categoryScores.honesty) === 1) out.push(flag);
      continue;
    }
    if (flag.key === "income_goal_mismatch") {
      if (Number(categoryScores.income_goal_fit) === 1) out.push(flag);
      continue;
    }
    // A flag whose condition this module does not implement is surfaced rather
    // than silently ignored: an unevaluated flag in a compliance-relevant tool is
    // a rule everyone believes is running and nothing is checking.
    if (flag.when === undefined) {
      out.push({ ...flag, unevaluated: true });
    }
  }

  // Structural: a wide spread means the reviewer saw a candidate who is excellent
  // at some things and poor at others. The average hides exactly that, so it is
  // flagged for a person rather than resolved by arithmetic.
  const values = Object.values(categoryScores).map(Number).filter(Number.isFinite);
  if (values.length >= 2 && Math.max(...values) - Math.min(...values) >= 3) {
    out.push({
      key: "wide_spread",
      label: "Scores range from 1 to 4 — the average is not describing this candidate; read the detail."
    });
  }

  return out;
}

/* recommendationIsAdvisory — the assertion the tests and the pipeline both use.

   Named and exported so that "no recommendation is a decision" is checkable in
   one place rather than being an invariant nobody can point at. */
export const RECOMMENDATIONS = Object.freeze([
  "incomplete", "review", "review_likely_no", "review_maybe", "advance", "advance_priority"
]);

export function recommendationIsAdvisory(recommendation) {
  // Every recommendation is advisory. This function exists to make that explicit
  // and to fail loudly if somebody adds a terminal-sounding one.
  const terminal = ["reject", "rejected", "auto_reject", "disqualified", "hired"];
  if (terminal.includes(String(recommendation))) {
    throw new Error(
      `"${recommendation}" is a decision, not a recommendation. The grader must not ` +
      `produce outcomes — rejection requires a named human (see 051_hiring.sql).`);
  }
  return true;
}

const round2 = (n) => Math.round(n * 100) / 100;
const parseJson = (v, fallback) => {
  if (v === undefined || v === null) return fallback;
  if (typeof v === "string") { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
};

export default grade;
