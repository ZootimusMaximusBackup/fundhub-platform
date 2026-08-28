# Why main is red, and the seven things that fix it (2026-08-28)

`main`'s required check — `suite (no database — 358 pg tests skip)` — fails, so
**branch protection blocks every pull request in this repo** and each one has to
be merged with the owner's admin override. Measured 2026-08-28: **main fails 9,
PR #267 fails 7.** The two PR #267 removes are the Apply-door copy test and
`RateLimiter: enforces a floor between requests` (timing-flaky).

These seven are what is left. None of them is one thread's fault and none is
related to the colour-bar work — each is a different thread's unfinished edge.
**Two of them touch money and contract keys**, so they are not safe to guess at,
which is why this is a hand-off and not a fix.

Each row below is a self-contained prompt. One issue per thread.

---

## 1. `src/pulse/registry.test.mjs` — two endpoints nobody registered

Mechanical. The test says exactly what to do.

```bash
Two live API paths are missing from the monitoring registry and it is failing CI on main: campaigns/meta-agency and staff/avatar. The test src/pulse/registry.test.mjs says: "Add each to PULSE_REGISTRY in src/pulse/registry.mjs, or to ALLOWED_UNMONITORED with a written reason (same change as the feature)." Read what each endpoint actually does before choosing which list it belongs in, and if it goes in ALLOWED_UNMONITORED write a real reason, not a placeholder. Run `node --test src/pulse/registry.test.mjs` until green, then push.
```

## 2. `src/http/start-html.test.mjs` — the test is stale, the code is deliberate

`public/start.html` sends people to `apply.fundhub.ai/watch`. The test demands
`/apply`. The code carries a comment saying why it was changed: "Bare
apply.fundhub.ai/ can 302 to the wrong CF theme; /apply headless-bot-skips and
drops query params; /watch keeps a1/ref." **This one needs Chris to confirm the
funnel path before the test is touched** — changing a test to match code is not
a decision an agent makes alone.

```bash
public/start.html sends affiliate traffic to https://apply.fundhub.ai/watch, but src/http/start-html.test.mjs demands https://apply.fundhub.ai/apply, and it is failing CI on main. The page's own comment says /watch was chosen on purpose because /apply drops the a1 and ref query parameters and bot-skips. Confirm with Chris which path is live and correct FIRST — do not change either side until he says. Then make the test and the page agree, keeping whichever path he confirms, and push.
```

## 3. `src/config/offers.test.mjs` — a contract template key is missing

`OFFERS.FUNDING_MASTERY.contractTemplateKey` is `undefined`; the test expects
`FUNDING-MASTERY-AGREEMENT`. **COMPLIANCE REVIEW REQUIRED** — this is contract
template routing.

```bash
src/config/offers.test.mjs fails on main: OFFERS.FUNDING_MASTERY.contractTemplateKey is undefined but the test expects "FUNDING-MASTERY-AGREEMENT". Find out whether the Funding Mastery offer is supposed to have a contract template at all, and whether a template with that key exists in the contracts tables. Do not invent a key to make the test pass — if no such template exists, that absence is the finding and it goes to Chris. This touches contract routing, so flag COMPLIANCE REVIEW REQUIRED at the top of your summary. Push only what you can prove.
```

## 4. `src/dashboard/kpis.test.mjs` — money units, dollars vs cents

The KPI query does `COALESCE(SUM(funded_amount), 0)::bigint AS cents` and the
test asserts that string must NOT appear — i.e. `funded_amount` is dollars and
calling it `cents` is the 100x bug CLAUDE.md §12 warns about. **Possibly a real
money bug on a live dashboard.**

```bash
src/dashboard/kpis.test.mjs fails on main. The query in src/dashboard/kpis.mjs selects COALESCE(SUM(funded_amount), 0)::bigint AS cents, and the test asserts /::bigint AS cents/ must NOT match, because funding_rounds.funded_amount is stored in DOLLARS on this screen while the alias claims cents. Read CLAUDE.md §12 on money first — fromCents returns a string and NULL must survive. Work out which unit funded_amount actually holds by reading the column and its writers, then make the query and its consumers agree. A 100x error on a funded-total tile is the failure mode; prove the number on a real row before pushing.
```

## 5. `src/http/closer-deck-present.test.mjs` — a falsy assertion

```bash
src/http/closer-deck-present.test.mjs fails on main at line 89 with "The expression evaluated to a falsy value: actual false, expected true". Read the test and the Closer Deck present path, work out which behaviour stopped being true and when (git log the files it touches), and fix the side that is actually wrong — do not weaken or delete the test. Run `node --test src/http/closer-deck-present.test.mjs` until green, then push.
```

## 6. `src/underwrite/adapter.test.mjs` — `undefined == false`

```bash
src/underwrite/adapter.test.mjs fails on main at line 242 with "undefined == false" in the test "toBureaus — which bureaus are supplied, and what is recorded missing". Something the adapter used to return is now undefined. Read the adapter and the test, find which field went missing and in which commit, and fix the adapter rather than the expectation unless you can show the expectation was wrong. Run `node --test src/underwrite/adapter.test.mjs` until green, then push.
```

## 7. `scripts/journeys/generate.test.mjs` — routes whose auth gate cannot be traced

```bash
scripts/journeys/generate.test.mjs fails on main at line 146 with "these routes' gates could not be traced from the code". New routes were added without an auth gate the journey generator can follow. Read the test to see which routes it names, then read CLAUDE.md §12 on requireAuth — it ignores a `roles` key, so gates must use requireRole after it. Either give each named route a traceable gate or record why it has none. This is auth, so be certain rather than quick. Run `node --test scripts/journeys/generate.test.mjs` until green, then push.
```

---

## Order

None of the seven depends on another — **all parallel**, seven files, seven
threads. Cap at five at a time per CLAUDE.md §5.

Do #2 and #4 first if you only run a couple: #2 is a live affiliate funnel path
and #4 is a money figure on a dashboard. #1 is the cheapest.

When all seven are green, the required check passes on `main` and pull requests
stop needing an admin override to merge.
