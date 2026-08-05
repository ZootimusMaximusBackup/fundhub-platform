// Verification assertions — PASS / FAIL / SILENTLY-DID-NOTHING / UNVERIFIED.
//
// SILENTLY-DID-NOTHING is the failure mode this harness exists to catch:
// code ran, threw nothing, and left the database unchanged (or wrote zeros
// that look like success). Prefer this over FAIL when the operation returned
// ok/success but persistence proves otherwise.

export const STATUS = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  SILENT: "SILENTLY-DID-NOTHING",
  UNVERIFIED: "UNVERIFIED",
  SKIP: "SKIP"
});

/**
 * @typedef {object} Assertion
 * @property {string} id
 * @property {string} section
 * @property {string} journey
 * @property {string} role
 * @property {string} status
 * @property {string} claim
 * @property {string} [detail]
 * @property {string} [file]
 * @property {number|string} [line]
 * @property {object} [expected]
 * @property {object} [actual]
 * @property {boolean} [p0]
 * @property {boolean} [usableToday]
 */

export function createCollector({ runId = null } = {}) {
  /** @type {Assertion[]} */
  const items = [];
  const startedAt = new Date().toISOString();

  function push(a) {
    items.push({
      id: a.id || `a-${items.length + 1}`,
      section: a.section || "general",
      journey: a.journey || "",
      role: a.role || "",
      status: a.status,
      claim: a.claim,
      detail: a.detail || "",
      file: a.file || "",
      line: a.line ?? "",
      expected: a.expected ?? null,
      actual: a.actual ?? null,
      p0: Boolean(a.p0),
      usableToday: a.usableToday
    });
    return items[items.length - 1];
  }

  return {
    startedAt,
    runId: runId || `verify-${Date.now()}`,
    items,

    pass(partial) {
      return push({ ...partial, status: STATUS.PASS });
    },
    fail(partial) {
      return push({ ...partial, status: STATUS.FAIL });
    },
    silent(partial) {
      return push({ ...partial, status: STATUS.SILENT });
    },
    unverified(partial) {
      return push({ ...partial, status: STATUS.UNVERIFIED });
    },
    skip(partial) {
      return push({ ...partial, status: STATUS.SKIP });
    },

    /** Assert a row count — if op claimed success and count is 0 → SILENT. */
    assertCount({
      section, journey, role, id, claim, count, expected = 1,
      file, line, opReturnedOk = true, p0 = false
    }) {
      if (count === expected) {
        return this.pass({
          section, journey, role, id, claim, file, line,
          expected: { count: expected }, actual: { count }, p0
        });
      }
      if (opReturnedOk && count === 0 && expected > 0) {
        return this.silent({
          section, journey, role, id, claim,
          detail: `Operation returned ok but found ${count} rows (wanted ${expected}).`,
          file, line, expected: { count: expected }, actual: { count }, p0
        });
      }
      return this.fail({
        section, journey, role, id, claim,
        detail: `Expected count ${expected}, got ${count}.`,
        file, line, expected: { count: expected }, actual: { count }, p0
      });
    },

    /** Assert deep equality of a persisted field. */
    assertEq({
      section, journey, role, id, claim, expected, actual, file, line, p0 = false
    }) {
      const ok = Object.is(expected, actual) ||
        (expected != null && actual != null && String(expected) === String(actual));
      if (ok) {
        return this.pass({
          section, journey, role, id, claim, file, line,
          expected: { value: expected }, actual: { value: actual }, p0
        });
      }
      if (actual == null || actual === "" || actual === 0) {
        return this.silent({
          section, journey, role, id, claim,
          detail: `Wanted ${JSON.stringify(expected)}; persisted value is empty/zero: ${JSON.stringify(actual)}.`,
          file, line, expected: { value: expected }, actual: { value: actual }, p0
        });
      }
      return this.fail({
        section, journey, role, id, claim,
        detail: `Wanted ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}.`,
        file, line, expected: { value: expected }, actual: { value: actual }, p0
      });
    },

    summary() {
      const tallies = { PASS: 0, FAIL: 0, "SILENTLY-DID-NOTHING": 0, UNVERIFIED: 0, SKIP: 0 };
      let p0 = 0;
      for (const i of items) {
        tallies[i.status] = (tallies[i.status] || 0) + 1;
        if (i.p0 && i.status !== STATUS.PASS) p0 += 1;
      }
      return { tallies, p0, total: items.length };
    }
  };
}
