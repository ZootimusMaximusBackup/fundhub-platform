// test-identity — decide whether an email address belongs to a test run.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS EXISTS
//
// Every automated path in this repo already cleans up after itself: the
// simulator flags its rows, the journey runner rolls its transaction back, and
// the verification harness wipes its clients in a `finally`. None of them leak.
//
// What leaks is a person. Somebody walks the real signup, upload and contract
// screens by hand to check them, and those rows come out of the ordinary
// product code carrying no marker at all. Afterwards nothing can tell them from
// a real customer — same table, same columns, same shape — so they sit in the
// CRM and confuse the next end-to-end walk. Recorded 2026-08-27.
//
// The only moment the difference is knowable is the moment of signup, and the
// only thing that carries the knowledge is the address the tester typed. So the
// rule is: put the tag in the email, and the row is born flagged.
//
//     chris+fhtest@gmail.com        -> is_demo = true
//     chris+fhtest-run4@gmail.com   -> is_demo = true
//     chris@gmail.com               -> ordinary customer, untouched
//
// A plus tag is invisible to mail delivery — every message still lands in the
// same inbox — so a tester gets working magic links and real emails while the
// row stays disposable.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE RISK, STATED PLAINLY
//
// `is_demo = true` is not a label. It removes the client from every CRM list
// (src/demo/exclude-demo.mjs) and makes the row eligible for deletion by
// teardownSimulated(). If a real paying customer ever signed up with the tag in
// their address, their file would vanish from the app and could be destroyed.
//
// Three things keep that from happening, in order:
//
//   1. The tag is matched ONLY inside the local part, ONLY as a whole plus
//      segment. `someone@fhtest.com` and `notfhtest+x@a.com` do not match.
//   2. The default is a made-up word, not a real one. Nobody's address has
//      `+fhtest` in it by accident.
//   3. It is one env var away from being changed or switched off entirely:
//      TEST_EMAIL_TAG="" disables the whole mechanism and no row is ever
//      flagged by this file.
//
// Owner-set 2026-08-27: Chris asked for this after hand-made test rows kept
// polluting the next walk. Default tag `fhtest`, chosen here because he was
// asked for a string and said to finish it.

/** The tag, without its leading `+`. Empty string switches the mechanism off. */
export function testEmailTag(env = process.env) {
  const raw = env.TEST_EMAIL_TAG;
  return raw === undefined ? "fhtest" : String(raw).trim().toLowerCase();
}

/**
 * True when `email` carries the test tag as a plus segment in its local part.
 *
 * Matches the tag exactly, or the tag followed by more characters, so a tester
 * can number their runs: `+fhtest`, `+fhtest2`, `+fhtest-run4` all match while
 * `+fh` and `+testing` do not.
 */
export function isTestEmail(email, { env = process.env } = {}) {
  const tag = testEmailTag(env);
  if (!tag) return false;                       // explicitly disabled
  if (typeof email !== "string") return false;

  const at = email.lastIndexOf("@");
  if (at <= 0) return false;                    // no local part, or no domain
  const local = email.slice(0, at).toLowerCase();

  // Every `+`-delimited segment after the first. `a+b+c` -> ["b", "c"].
  const segments = local.split("+").slice(1);
  return segments.some((s) => s.startsWith(tag));
}

/**
 * The value to write into a `clients.is_demo` column at insert time.
 *
 * A separate name from isTestEmail() on purpose: call sites read as
 * `is_demo = demoFlagForEmail(email)`, which says what the column means rather
 * than what the check does.
 */
export function demoFlagForEmail(email, opts) {
  return isTestEmail(email, opts);
}
