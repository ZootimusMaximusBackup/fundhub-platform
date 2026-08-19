**TRUTH REPORT — /tmp/wt-T3, branch `fix/T3-credit-file`, HEAD `c860b8c`**

---

## 1. Files changed vs. owned-file lists

**16 modified tracked + 2 new — every one is owned. No unowned code file was touched.**

| File | Owner |
|---|---|
| `api/consent/capture.mjs`, `src/http/consent-capture.test.mjs`, `src/register-all.mjs`, `src/handlers/contract-consent.mjs` (new), `src/handlers/contract-consent.test.mjs` (new) | Unit A |
| `src/demo/simulate-client.mjs`, `src/underwrite/adapter.mjs`, `src/underwrite/adapter.test.mjs`, `src/underwrite/underwriteiq.pg.test.mjs` | Unit C |
| `src/underwrite/letter-pack.mjs`, `src/underwrite/letter-pack.test.mjs`, `src/finance/crs-tier.test.mjs` | Unit D |
| `public/app/closer-dashboard.html`, `public/app/client-control-panel.html` | Unit E |
| `src/finance/crs-pull.mjs`, `api/finance/crs-pull.mjs`, `src/finance/crs-pull.test.mjs`, `src/http/finance-crs-pull.test.mjs` | Unit F |

**FLAG — three files nobody owned are now dirty, and two of them are mine:**

- **`docs/diagrams/README.md` + `docs/diagrams/event-flow.md` — I changed these.** I ran `npm run diagrams`, which is the exact command the failing test prints. The whole diff is 2 lines: handler count 35→36, and `contract.signed` gains `onContractSignedConsent`. This cleared one red test and simultaneously proved Unit F's claim (its change adds no event/route/handler). Revert with `git checkout -- docs/diagrams/` if you'd rather Unit A's owner do it.
- **`docs/END-TO-END-VERIFICATION.md` — NOT an agent edit. Do not commit it.** `src/verification/e2e-verification.pg.test.mjs` rewrites this tracked file every time the pg phase runs. It now records my scratch DB name (`localhost/fundhub_t3`) and my run's numbers. Pre-existing suite misbehaviour; worth its own finding.
- **`scripts/.t3-live.mjs`, `.t3-walk1/2/3.mjs` — untracked scratch scripts left in `scripts/` by an earlier agent.** Harmless to the suite (`run-suite.mjs` walks for `*.test.mjs` only, verified), but `git add scripts/` would sweep them in. Delete or leave untracked.
- `docs/workflows/fix-2026-08-18/evidence/T3/` — grounding evidence, expected.

**The "someone else is writing into my worktree" alarm raised by Units A, D and F is a false alarm.** Every file each of them saw appear belongs to a sibling T3 unit. Nobody was outside the batch.

---

## 2. Marker + integrity check — all 20 .mjs files pass `node --check`, no half-wiped file

Markers confirmed present, not relayed: `SIM_SCORES/SIM_INQUIRIES/business_age_months: 30` (C); `registerContractConsent()` import **and** call, plus the real `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2` inside `ownsClient` where there was previously no query at all (A); `PACK_REASON.NO_CRS_RESULT/ENGINE_ERROR/NO_ENGINE_RESULT` + `summarySkip` (D); `document.addEventListener("DOMContentLoaded"` replacing the IIFE, `cardUse()` returning `"not measured"`, `pullFailure()`, GHL Contact gone, Raw Report still `disabled` (E); `crs_softview_simulated`, `crs-simulated-bundle:`, `simulation_mismatch`, `hostEnvironment` (F). Both HTML files end `</script></body></html>` intact.

**Adversarial test-weakening sweep — clean.** Only two existing tests were altered, both legitimately:
- `letter-pack.test.mjs`: `assert.equal(pack.reason, "empty_pack")` → `NO_ENGINE_RESULT` + `assert.notEqual(..., EMPTY_PACK)`. Unit D flagged this loudly and correctly. Strengthened, not weakened.
- `adapter.test.mjs`: **Unit C did not mention this.** It edited an existing assertion's *message* string. The assertion itself (`assert.match(neg.effect, /fundable/)`) is byte-identical. Cosmetic, but it was an unreported edit to an existing test.
- `underwriteiq.pg.test.mjs`: the `after()` teardown was *expanded* from one client to a `seeded[]` loop. Broader cleanup, not removed.

No new npm dependency (`package.json`/lock untouched). No new server-side outbound `fetch`; the one added `fetch(` is a same-origin browser call to `/api/consent/capture` in `client-control-panel.html`, matching the 2 already in that file. No secrets in the diff.

---

## 3. `npm run lint`
```
lint: 1322 file(s) and inline script(s) parse clean
```
PASS.

## 4. `npx tsc --noEmit`
Exits **1** and prints the compiler usage banner. There is **no `tsconfig*.json` anywhere in the repo** (`git ls-files | grep tsconfig` → nothing), so tsc receives no inputs and checks nothing. Identical on pristine HEAD. **This gate has never been able to pass and proves nothing.** All five agents reported this honestly — none of them claimed a false green here.

## 5. `DATABASE_URL=…fundhub_t3 npm test`

```
# tests 5923   # suites 439   # pass 5918   # fail 5   # cancelled 0   # skipped 0
```

```
not ok 33   - the extraction is faithful to the code
not ok 1675 - registration
not ok 1765 - the known-unfixed list is still true
not ok 2248 - an endpoint excused from the org filter still passes the session's org to its store
not ok 3358 - the app's database role holds no superuser-level privilege
```

**Before my diagram regen it was 6 fails; the sixth was `docs/diagrams is in sync with the code`.**

**PRE-EXISTING (3 of 3 baseline failures, content verified identical on a `git archive HEAD` pristine copy):**
- `scripts/journeys/generate.test.mjs:96` — child names `finance/crs-pull` **and** `gifts/message-blaster`. Pristine names the same two. **Unit F's claim that its crs-pull change did not cause this is CONFIRMED.**
- `src/http/read-endpoints-org-scope.test.mjs:184` — names `company-brain-affiliate.mjs`. Matches baseline.
- `src/security/superuser-guard.test.mjs:185` — fails on pristine too with `DATABASE_URL` set. Expected local-superuser condition.

**OURS (2 new, both confirmed passing on pristine):**

| File / test | Cause |
|---|---|
| `src/handlers/contract-signed.test.mjs:200` — "registration" | **Unit A.** `assert.equal(handlers.length, 1)`, actual `2`. Unit A's second `contract.signed` listener is deliberate. Fix is one line, in a file Unit A does not own. |
| `src/http/calendar-paint.test.mjs:589` — "the known-unfixed list is still true" | **Unit E.** Message: `closer-dashboard.html (T3) is fixed — delete its line from KNOWN_UNFIXED`. The test is designed to fail on success. Delete the `"closer-dashboard.html"` entry at lines 79–81. |

I did **not** fix either — both require accepting a deliberate behaviour change, not a mechanical repair, and `KNOWN_UNFIXED` also holds T4's and T11's lines, so one owner should do all three.

## 6. Delta

**3 fail → 5 fail. Two new, both ours, both in files no unit owned, both one-line clerical fixes.** (It was 3 → 6; I cleared the diagrams one by running `npm run diagrams`.)

Test count **5845 → 5923 (+78), pass 5842 → 5918 (+76), skipped 0 → 0.** No test lost.

---

## 7. The pg phase — 442 tests that `npm test` NEVER RUNS

**Unit C is right and this is the most important finding here.** `scripts/run-suite.mjs:69` — `if (code !== 0) process.exit(code)` — exits after the unit phase. Because main already has 3 unit failures, `npm test` has **never reached the pg phase on this tree**. My run confirms it: the output contains only `[run-suite] unit: 392 files`, never a `pg` line. **`# skipped 0` does not mean the pg tests ran — it means they never started.** BASELINE.md's claim that the run "really did exercise the 442 `.pg.test.mjs` tests" is false.

So I ran all 109 pg files by hand at `--test-concurrency=1`, on the dirty tree and on a pristine `git archive HEAD` copy, same scratch DB:

```
dirty    : # tests 1649  # pass 1523  # fail 59  # cancelled 67
pristine : # tests 1648  # pass 1521  # fail 60  # cancelled 67
```

Compared **failure-by-failure, not by count** — top-level suites and nested subtests both:
- **dirty-only failures: ZERO.** At every level.
- pristine-only: one (`updated_at triggers fire on the new tables`) — cross-file DB pollution, not caused by anything.

**No pg regression from any of the five units.** The +1 test is Unit C's new one, and it passes: `ok 661 - the RAW seed — no emit step — is readable as a real bureau pull`, alongside `ok 660 - UnderwriteIQ chain`. Unit D's report of that file failing was a mid-flight snapshot of Unit C's work in progress and is **stale — it now passes.** Unit C's headline numbers are genuinely asserted in code (`underwriteiq.pg.test.mjs:256` score `731`, `:271` `total_combined_funding 939500`, `:274` `fundable true`).

The 59/60 baseline pg failures and 67 cancellations are pre-existing and dominated by cross-file shared-database pollution.

---

## 8. Accuracy audit of the five reports

**Nobody claimed a green they did not see. No unit overstated a pass.** Every one correctly refused to call `tsc` green.

- **Unit F — most accurate.** Its 6 failures match my pre-regen measurement exactly, and both of its hard claims (crs-pull journeys failure pre-existing; diagrams staleness not its doing) verified true.
- **Unit C — accurate on substance**, isolated-copy method was sound, but it omitted an existing-test assertion-message edit in `adapter.test.mjs`.
- **Unit A — stale numbers** (5921/5913/5 fail/3 skipped; actual 5923/5918/5/0), measured mid-flight without `DATABASE_URL`. Its two blockers are real and correctly diagnosed.
- **Unit D — stale and undercounted** (5848/5843/2 fail): measured before siblings landed, and its report of a red `underwriteiq.pg.test.mjs` is now obsolete.
- **Unit E — claims verified.** Its diff is exactly the DOMContentLoaded wrapper plus the comment; nothing extra.

## 9. Two open gaps neither I nor any unit closed

- **`npm run journeys:check` → "docs/journeys is up to date (9 files)."** Units C and E both said journeys need regenerating; **they do not** — the generator disagrees with them.
- **`docs/journeys/CHANGELOG.md` has no T3 line in this worktree.** CLAUDE.md §4/§6 require it in the same commit. Still outstanding.

**COMPLIANCE REVIEW REQUIRED** carries forward from Unit A (consent capture) and Unit F (credit-pull type), per §7.