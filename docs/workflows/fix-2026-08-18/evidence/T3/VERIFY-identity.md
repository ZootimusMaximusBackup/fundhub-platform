No repairs were needed — I did not modify the worktree. Here is the truth report.

# T3 verification — truth report

## 1. PII verdict: CLEAN. No identity data can reach the response.

**Proven twice: by reading the code, then by invoking the real handler against the scratch database with a real stored identity.**

I seeded `pii_identity` for a test client with SSN `987654321`, DOB `1979-03-14`, address `4417 Marigold Terrace, Vandergrift, PA 15690`, and confirmed `readIdentity` really returns all of it (`ssn_last4: "4321"`, full `dob`, full `addresses` array). Then I called the handler as a staff closer and dumped the whole serialized body.

**Every key in the entire response tree:** `approval_link, consent, disclosure, expires_at, history, identity, kind, ok, on_file, reason, status, text, title, unavailable_reason, url, valid, version`.

Value scan over the serialized body — `absent` for all of: full SSN, `4321`, `1979-03-14`, `1979`, `4417 Marigold Terrace`, `Vandergrift`, `15690`, and the literal strings `ssn`/`dob`/`address`/`last4`. `identity` came back as exactly `{"on_file": true}`.

**Does it spread an object it does not control? No.** Two places could have:
- `identityIsOnFile()` (`api/consent/capture.mjs:219-222`) narrows to `!!(identity && identity.ssn_present)` *inside the function*. The PII record is a local that never reaches the response builder, so a field added to `readIdentity` later cannot flow through — there is no spread to flow through.
- `mintApprovalLink()` returns three named fields (`url`, `expires_at`, `unavailable_reason`), not `{...link}`.

**Error paths checked.** The only new one is the caught `secretFromEnv` throw, which returns a fixed sentence naming `DOCUMENT_URL_SECRET` — the name, never the value. No PII on any branch.

Two honest footnotes:
- My raw `\d{9}` probe fired, but the hit is the `exp=1787183742` epoch in the signed URL, not an SSN. The repo's own test uses `\b\d{9}\b`, which correctly cannot match a 10-digit epoch. Not a hole.
- `history` already returns `granted_name`, `captured_ip`, `captured_user_agent` from the consent rows. Pre-existing, unchanged by this work, and not identity-table data — but it means "no personal data leaves this endpoint" would be too strong a sentence. "No *identity* data" is accurate.

The deny-list test (`src/http/consent-capture.test.mjs`) is real, not decorative: it asserts non-vacuity first (`the identity record was never read, so this test proves nothing`), then scans values, then walks every key against `/ssn|social|dob|birth|address|postal|zip|city/i`.

---

## 2. Three things the build agent overstated

**a) The headline suite numbers were measured WITHOUT the database.** Its report says "5932 tests, 5927 pass, 2 fail, 3 skipped". I reproduced that number exactly by running `npm test` with **no** `DATABASE_URL`. With the scratch database it is **5934 / 5931 / 3 fail / 0 skipped**. It missed the third failure (`superuser-guard`) entirely, and its prose implies the run was database-backed. The conclusion (no regression) still holds — but the number it quoted came from the weaker configuration.

**b) "20 of those are new" is really 11.** `src/http/consent-capture.test.mjs` goes 45 → 56 tests. Suite total goes 5923 → 5934, which agrees: +11.

**c) A failing identity read takes the whole consent answer down** — the exact asymmetry it argued against for the signing key. I proved it: make the `pii_identity` read throw and the handler throws out to a 500, so the closer loses the consent line too, not just the identity line. The screen's `.catch()` degrades to "we don't know" and hides the handoff, so it fails *closed* and safe. Low likelihood (an RLS denial returns zero rows, not an error; this needs a timeout, a dead connection, or a missing table). **Reported, not fixed — larger than mechanical.**

---

## 3. Everything else it claimed — verified true

| Check | Result |
|---|---|
| `git status --porcelain` | Exactly the 4 named files. No fifth source file. |
| No new route | `netlify/functions/api.mjs` diff is **0 bytes**. No new handler file. `"consent/capture"` already in `ROUTES` at line 689. |
| Org check survives | `ownsClient` is org-scoped (`WHERE id = $1 AND org_id = $2`) and **awaited at both sites** — `capture.mjs:145` (GET) and `:302` (POST). |
| Pull gates untouched | `src/finance/crs-pull.mjs` diff is **0 lines**. Consent gate and the `identity_required` gate are unmodified. |
| No SSN field on staff screen | Zero `ssn`/`dob`/`social`/`birth` inputs. The diff adds exactly **one** `<input>`: a readonly text box holding the link. |
| No new surface | `shell.js`, `data.js`, `sidebar.fragment.html` all untouched. No new page, tab or sidebar row. |
| Both HTML files whole | `client-control-panel.html`: 9/9 `<script>`, 135/135 `<div>`, ends `</html>`. `soft-pull-approve.html`: 1/1, 18/18, ends `</html>`. |
| `npm run lint` | `lint: 1318 file(s) and inline script(s) parse clean` — and `scripts/lint.mjs:55` confirms it parses inline `<script>` in `.html`, so this covers both files. |
| `publicBaseUrl` copy | `diff` of `closer-deck.mjs:331-336` vs `capture.mjs:245-250` → **byte-identical**. |
| Cited line numbers | All correct: `soft-pull-approve.mjs:178-188` (address_required), `:132-136` (forwards version/text/bullets, no title), `pii/index.mjs:138` (`addresses = EXCLUDED.addresses`, no COALESCE), `:155` (readIdentity). |
| Board items | Accurate. `disclosures.mjs:50` does carry `title: "Soft Pull Authorization"`; `bullets` exists nowhere in that file, so `disclosure.bullets \|\| null` is always null. |
| No new dependency / no new server fetch | `package.json` unchanged; zero added `fetch(` in `api/` or `src/`. |
| Client gets no bearer link | Code is `isSoftPull && principal.kind === "staff"`; the test asserts `body.approval_link === null` for a client session. Confirmed live: non-soft-pull kind returns `identity:null, approval_link:null`; no identity row returns `{"on_file": false}`. |
| Link TTL | 6 hours, confirmed live (minted 17:55Z → `expires_at` 23:55Z). |

---

## 4. Test results

**`DATABASE_URL=…/fundhub_t3 npm test`** — 5934 tests / 5931 pass / **3 fail** / 0 skipped. Exit 1.

Every `not ok`:
```
not ok 33   - the extraction is faithful to the code
              scripts/journeys/generate.test.mjs:96
              subtest: "no route's gate is left unverified" (generate.test.mjs:146)
              untraced gates: finance/crs-pull, gifts/message-blaster
not ok 2251 - an endpoint excused from the org filter still passes the session's org to its store
              src/http/read-endpoints-org-scope.test.mjs:198
not ok 3361 - the app's database role holds no superuser-level privilege
              src/security/superuser-guard.test.mjs:185
```

All three are the named pre-existing failures, at the stated line numbers. I specifically chased #1 because it checks route gates and this change edits a routed handler — the two untraced gates are `finance/crs-pull` and `gifts/message-blaster`. **`consent/capture` is not among them.** Not ours.

Directly relevant: `src/http/consent-capture.test.mjs` alone is **56 pass / 0 fail**.

## 5. Delta

**3 fail → 3 fail, no regression.** (+11 tests, +11 passing.)

---

## 6. Two things the lead needs that were not in the report

**`npm test` never ran the database tests, and this is confirmed, not suspected.** `scripts/run-suite.mjs:68-69` is `if (code !== 0) process.exit(code);` after the unit phase. Unit tests fail on this branch, so the pg phase is skipped every time. My run's log shows only `[run-suite] unit: 392 files` and no pg line. **Any `npm test` result quoted on this branch — mine included — is unit tests only.**

So I ran the pg phase by hand: **1649 tests / 1524 pass / 58 fail / 0 skipped** against `fundhub_t3`. (CLAUDE.md §12's "442 pg tests" is stale by a lot.) **None of the 58 is attributable to this change**: no `*.pg.test.mjs` file anywhere in the repo references `consent/capture`, `client-control-panel` or `soft-pull-approve`, and the five pg files that do cover this area — `src/consent/consent.pg.test.mjs`, `src/finance/soft-pulls.pg.test.mjs`, `src/http/finance-soft-pull.pg.test.mjs`, `src/http/pii.pg.test.mjs`, `src/pii/reveal-transaction.pg.test.mjs` — are **110 pass / 0 fail**, exactly as claimed. The 58 are the previously-unmeasured pg baseline (this scratch database connects as a Postgres superuser, which is why `superuser-guard` fails and why the isolation tests are expected to be red here).

**Four untracked files the report did not list.** `docs/workflows/fix-2026-08-18/evidence/T3/preview/` (README.md, preview.json, 2 PNGs). Timestamps put it at 10:24, before this agent's 10:43 screenshots, so it belongs to an **earlier** unit in this thread, not this one — not a red flag against the build agent, but it is uncommitted work sitting in a shared-hazard checkout and the lead should decide whether it ships.

`docs/END-TO-END-VERIFICATION.md` now shows modified. That is my own test runs regenerating it, as expected.

## 7. Minor, report-only

- The client page now hardcodes the heading `"Soft pull authorization"` while `src/consent/disclosures.mjs:50` holds `"Soft Pull Authorization"`. A third copy of the wording, with different capitalization. Defensible (that thread does not own `api/soft-pull-approve.mjs`) but worth a board line, since `/api/consent/capture` *does* already return `title` — the fix could have been to plumb it rather than retype it.
- The approval link is a bearer credential rendered into a readonly text box on a staff screen. That is inherent to the flow Chris chose; it expires in 6 hours and is re-minted per load. Noting it, not objecting.

**Repairs made: none.** Nothing mechanical was broken, and every other concern above is larger than a typo, so I reported rather than touched. The worktree is exactly as the build agent left it.